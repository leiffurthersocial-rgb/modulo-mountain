#!/usr/bin/env python3
"""Build the multi-resolution height tile pyramid for a mountain preset.

    npm run build-tiles -- --preset matterhorn         (runs: python3.12 scripts/pipeline/build_tiles.py)

Inputs : data/mountains.json, data/sources.json, .dem-cache/<preset>/sources.json (from fetch-dem).
Outputs: public/tiles/<preset>/<datasetVersion>/{manifest.json, <L>/<tx>/<ty>.mmh}
         assets/LICENSES.json (data entries for the sources used)

Steps (see RESEARCH.md §3.4 and §7):
  1. Warp every source into the preset's local transverse Mercator frame (GDAL/PROJ):
     the core grid (finest core level, e.g. 2 m) and the far-field grid (e.g. 16 m).
  2. Blend sources by priority. A higher-priority source fades in over `featherM` metres from
     the edge of its valid data and from the edge of the core square, so seams are smooth and
     the core meets the far field continuously.
  3. Build coarser levels with a centred [1 2 1]/4 decimation filter so every level is derived
     from the same blended surface (consistent LODs, no cracks from mismatched sources).
  4. Cut 256-cell tiles with a 1-sample apron, quantise (2 cm or finer), encode as .mmh.
Requires GDAL Python bindings + NumPy (Ubuntu: /usr/bin/python3.12 with python3-gdal).
"""
import argparse
import gzip
import json
import math
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np
from osgeo import gdal

gdal.UseExceptions()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.dirname(__file__))
from mmh import encode_tile  # noqa: E402

TILE_CELLS = 256
APRON = 1
TILE_SAMPLES = TILE_CELLS + 1 + 2 * APRON


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Grid:
    """Heights sampled at x = (i0 + i) * s (east), y = (j0 + j) * s (north). a[j, i], j=0 south."""

    def __init__(self, a, i0, j0, s):
        self.a, self.i0, self.j0, self.s = a, i0, j0, s

    @property
    def n(self):
        return self.a.shape[1], self.a.shape[0]

    def x(self, i):
        return (self.i0 + i) * self.s


def empty_grid(half_extent, s, margin):
    """Grid covering [-half, half]^2 plus `margin` samples on each side."""
    k = int(round(half_extent / s))
    i0 = -k - margin
    n = 2 * k + 1 + 2 * margin
    return Grid(np.full((n, n), np.nan, np.float32), i0, i0, s)


def warp_to_grid(files, grid, proj, resample, src_nodata=None):
    """Warp source files into the grid's sample positions (pixel centres = samples)."""
    s = grid.s
    nx, ny = grid.n
    xmin = grid.i0 * s - s / 2
    ymin = grid.j0 * s - s / 2
    vrt = gdal.BuildVRT("", files, srcNodata=src_nodata) if len(files) > 1 else files[0]
    opts = dict(
        format="MEM",
        dstSRS=proj,
        outputBounds=(xmin, ymin, xmin + nx * s, ymin + ny * s),
        width=nx,
        height=ny,
        resampleAlg=resample,
        outputType=gdal.GDT_Float32,
        dstNodata=float("nan"),
        multithread=True,
        warpMemoryLimit=1024,
    )
    if src_nodata is not None:
        opts["srcNodata"] = src_nodata
    ds = gdal.Warp("", vrt, **opts)
    a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
    a[(a < -1000) | (a > 10000)] = np.nan  # nodata sentinels such as 3.4e38 / -9999
    return np.flipud(a)  # GDAL rows run north->south; ours south->north


def proximity_to_invalid(valid, s):
    """Distance (m) from each valid sample to the nearest invalid one (GDAL ComputeProximity)."""
    ny, nx = valid.shape
    drv = gdal.GetDriverByName("MEM")
    src = drv.Create("", nx, ny, 1, gdal.GDT_Byte)
    src.SetGeoTransform((0, s, 0, 0, 0, s))
    src.GetRasterBand(1).WriteArray(valid.astype(np.uint8))
    dst = drv.Create("", nx, ny, 1, gdal.GDT_Float32)
    dst.SetGeoTransform((0, s, 0, 0, 0, s))
    if valid.all():
        return np.full(valid.shape, np.inf, np.float32)
    gdal.ComputeProximity(src.GetRasterBand(1), dst.GetRasterBand(1), ["VALUES=0", "DISTUNITS=GEO"])
    return dst.GetRasterBand(1).ReadAsArray()


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def decimate(g):
    """Centred [1 2 1]/4 separable filter + 2x downsample. Coarse sample K sits at fine 2K."""
    a = g.a.astype(np.float64)

    def dec_axis(arr, off, axis):
        n = arr.shape[axis]
        # fine index f = global G - off; coarse global K needs fine globals 2K-1..2K+1
        k_lo = math.ceil((off + 1) / 2)
        k_hi = math.floor((off + n - 2) / 2)
        ks = np.arange(k_lo, k_hi + 1)
        c = 2 * ks - off
        take = lambda idx: np.take(arr, idx, axis=axis)  # noqa: E731
        return (take(c - 1) + 2 * take(c) + take(c + 1)) / 4.0, k_lo

    b, i0 = dec_axis(a, g.i0, 1)
    b, j0 = dec_axis(b, g.j0, 0)
    return Grid(b.astype(np.float32), i0, j0, g.s * 2)


def blend_sources(grid_template, layers, proj, core_half, feather_default):
    """layers: list of (source cfg, files, resample, catalog). Highest priority applied last."""
    H = None
    weights = {}
    s = grid_template.s
    nx, ny = grid_template.n
    xs = (grid_template.i0 + np.arange(nx)) * s
    ys = (grid_template.j0 + np.arange(ny)) * s
    edge = core_half - np.maximum(np.abs(xs)[None, :], np.abs(ys)[:, None])  # >0 inside core
    for src, files, resample, cat in sorted(layers, key=lambda l: -l[0]["priority"]):
        t0 = time.time()
        a = warp_to_grid(files, grid_template, proj, resample)
        valid = np.isfinite(a)
        log(f"  warped {src['id']} ({len(files)} files, {resample}) valid {valid.mean():.3f} in {time.time()-t0:.0f}s")
        if H is None:
            if not valid.all():
                missing = (~valid).mean()
                if missing > 0.001:
                    raise SystemExit(f"base source {src['id']} leaves {missing:.2%} of the grid empty")
                a = fill_nans(a)
            H = a.astype(np.float64)
            weights[src["id"]] = np.ones_like(a, dtype=np.float32)
            continue
        feather = src.get("featherM", feather_default)
        dist = proximity_to_invalid(valid, s)
        if src["region"] == "core":
            dist = np.minimum(dist, edge)
        w = smoothstep(dist / max(feather, 1e-6)).astype(np.float32)
        w[~valid] = 0
        a = np.where(valid, a, 0)
        diff = np.abs(a - H)[w >= 0.999]
        if diff.size:
            log(f"  {src['id']} vs lower layers where fully weighted: median |d| {np.median(diff):.2f} m, p99 {np.percentile(diff, 99):.1f} m, max {diff.max():.1f} m")
        H = H + w * (a - H)
        weights[src["id"]] = w
    return H.astype(np.float32), weights


def fill_nans(a):
    """Fill a few isolated NaNs by iterative neighbour averaging."""
    a = a.copy()
    for _ in range(50):
        m = ~np.isfinite(a)
        if not m.any():
            return a
        p = np.pad(a, 1, mode="edge")
        stack = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
        with np.errstate(invalid="ignore"):
            mean = np.nanmean(stack, axis=0)
        a[m] = mean[m]
    a[~np.isfinite(a)] = np.nanmean(a)
    return a


def resample_for(native, target):
    if native < target * 0.75:
        return "average"
    if native > target * 1.5:
        return "cubicspline"
    return "bilinear"


def tile_slice(grid, x0, y0, s):
    """259x259 samples of the tile whose SW corner is (x0, y0)."""
    gi = int(round(x0 / s)) - APRON - grid.i0
    gj = int(round(y0 / s)) - APRON - grid.j0
    nx, ny = grid.n
    if gi < 0 or gj < 0 or gi + TILE_SAMPLES > nx or gj + TILE_SAMPLES > ny:
        raise ValueError(f"tile at ({x0},{y0}) outside grid")
    return grid.a[gj:gj + TILE_SAMPLES, gi:gi + TILE_SAMPLES]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", default="matterhorn")
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "tiles"))
    args = ap.parse_args()

    presets = json.load(open(os.path.join(ROOT, "data", "mountains.json"), encoding="utf8"))
    preset = next(p for p in presets["presets"] if p["id"] == args.preset)
    catalog = json.load(open(os.path.join(ROOT, "data", "sources.json"), encoding="utf8"))
    listing_path = os.path.join(ROOT, ".dem-cache", args.preset, "sources.json")
    if not os.path.exists(listing_path):
        raise SystemExit(f"{listing_path} missing: run `npm run fetch-dem -- --preset {args.preset}` first")
    files = json.load(open(listing_path))["files"]

    lat0, lon0 = preset["origin"]["lat"], preset["origin"]["lon"]
    proj = f"+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
    R = preset["extent"]["rootSizeM"]
    C = preset["extent"]["coreHalfSizeM"]
    L_far = preset["farFieldMaxLevel"]
    srcs = preset["sources"]
    L_max = max([L_far] + [s["maxLevel"] for s in srcs])
    spacing = lambda L: R / 2**L / TILE_CELLS  # noqa: E731
    out_dir = os.path.join(args.out, preset["id"], preset["tiles"]["datasetVersion"])
    os.makedirs(out_dir, exist_ok=True)
    log(f"preset {preset['id']}: root {R} m, core ±{C} m, levels 0..{L_max} (far field ≤ {L_far})")

    # ---- core grid (finest level) -------------------------------------------------------
    core_levels = {}
    if L_max > L_far:
        s_c = spacing(L_max)
        d = L_max - L_far
        margin = 2 ** (d + 1)
        tmpl = empty_grid(C, s_c, margin)
        log(f"core grid {tmpl.n[0]}x{tmpl.n[1]} @ {s_c} m")
        layers = [(s, files[s["id"]], resample_for(catalog[s["id"]]["nativeResolutionM"], s_c), catalog[s["id"]]) for s in srcs]
        H, weights = blend_sources(tmpl, layers, proj, C, 150.0)
        g = Grid(H, tmpl.i0, tmpl.j0, s_c)
        core_levels[L_max] = g
        # per-source coverage (weight > 0) on the finest grid, for tile emission
        cover = {sid: Grid((w > 0).astype(np.float32), tmpl.i0, tmpl.j0, s_c) for sid, w in weights.items()}
        for L in range(L_max - 1, L_far - 1, -1):
            g = decimate(g)
            core_levels[L] = g
        summit_grid = core_levels[L_max]
    # ---- far-field grid -----------------------------------------------------------------
    s_f = spacing(L_far)
    tmpl_f = empty_grid(R / 2, s_f, 2 ** (L_far + 1))
    log(f"far grid {tmpl_f.n[0]}x{tmpl_f.n[1]} @ {s_f} m")
    far_layers = [(s, files[s["id"]], resample_for(catalog[s["id"]]["nativeResolutionM"], s_f), catalog[s["id"]]) for s in srcs if s["region"] == "all"]
    Hf, _ = blend_sources(tmpl_f, far_layers, proj, C, 150.0)
    far = Grid(Hf, tmpl_f.i0, tmpl_f.j0, s_f)
    if L_far in core_levels:
        cg = core_levels[L_far]
        k = int(round(C / s_f))
        # paste the core-derived surface over [-C, C] (shared samples are identical by construction)
        ci = -k - cg.i0
        fi = -k - far.i0
        sub = cg.a[ci:ci + 2 * k + 1, ci:ci + 2 * k + 1]
        before = far.a[fi:fi + 2 * k + 1, fi:fi + 2 * k + 1]
        log(f"core->far paste: median |core-far| {np.median(np.abs(sub - before)):.2f} m on the {s_f} m grid")
        far.a[fi:fi + 2 * k + 1, fi:fi + 2 * k + 1] = sub
    else:
        summit_grid = far
    levels = {L_far: far}
    g = far
    for L in range(L_far - 1, -1, -1):
        g = decimate(g)
        levels[L] = g
    for L, cg in core_levels.items():
        if L > L_far:
            levels[L] = cg

    # ---- tiles ------------------------------------------------------------------------
    manifest_levels = []
    total_bytes = 0
    total_tiles = 0
    src_ids = [s["id"] for s in srcs]
    for L in range(0, L_max + 1):
        g = levels[L]
        s = spacing(L)
        size = R / 2**L
        n = 2**L
        tiles = []
        if L <= L_far:
            cand = [(tx, ty) for ty in range(n) for tx in range(n)]
        else:
            lo = int(round((R / 2 - C) / size))
            hi = int(round((R / 2 + C) / size))
            cand = [(tx, ty) for ty in range(lo, hi) for tx in range(lo, hi)]
        for tx, ty in cand:
            x0 = -R / 2 + tx * size
            y0 = -R / 2 + ty * size
            mask = 0
            emit = L <= L_far
            for bit, sc in enumerate(srcs):
                if L > L_far and sc["maxLevel"] < L:
                    continue
                if L > L_far:
                    cv = cover[sc["id"]]
                    sl = tile_slice(cv, x0, y0, cv.s) if cv.s == s else None
                    if sl is None:
                        # coverage lives on the finest grid: test the tile footprint there
                        f = int(round(s / cv.s))
                        gi = int(round(x0 / cv.s)) - cv.i0
                        gj = int(round(y0 / cv.s)) - cv.j0
                        sl = cv.a[gj:gj + TILE_CELLS * f + 1, gi:gi + TILE_CELLS * f + 1]
                    if sl.max() > 0:
                        mask |= 1 << bit
                        emit = True
                elif sc["region"] == "all" or (x0 < C and x0 + size > -C and y0 < C and y0 + size > -C):
                    mask |= 1 << bit
            if not emit:
                continue
            h = tile_slice(g, x0, y0, s)
            if not np.isfinite(h).all():
                raise SystemExit(f"NaN in tile {L}/{tx}/{ty}")
            data, hmin, hmax = encode_tile(h)
            path = os.path.join(out_dir, str(L), str(tx), f"{ty}.mmh")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(data)
            total_bytes += len(data)
            tiles.append([tx, ty, round(float(hmin), 2), round(float(hmax), 2), mask])
        total_tiles += len(tiles)
        manifest_levels.append({"level": L, "spacingM": s, "tileSizeM": size, "tiles": tiles})
        log(f"L{L}: {len(tiles)} tiles @ {s} m")

    # ---- summit check -----------------------------------------------------------------
    sm = preset["summit"]
    from osgeo import osr  # noqa: E402

    src = osr.SpatialReference()
    src.ImportFromEPSG(4326)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst = osr.SpatialReference()
    dst.ImportFromProj4(proj)
    sx, sy, _ = osr.CoordinateTransformation(src, dst).TransformPoint(sm["lon"], sm["lat"])
    sg = summit_grid
    r = int(math.ceil(sm["searchRadiusM"] / sg.s))
    ci = int(round(sx / sg.s)) - sg.i0
    cj = int(round(sy / sg.s)) - sg.j0
    win = sg.a[cj - r:cj + r + 1, ci - r:ci + r + 1]
    jj, ii = np.unravel_index(np.argmax(win), win.shape)
    summit = {
        "maxHeightM": round(float(win.max()), 2),
        "x": round(float((sg.i0 + ci - r + ii) * sg.s), 2),
        "y": round(float((sg.j0 + cj - r + jj) * sg.s), 2),
        "referenceM": sm["elevationM"],
        "gridSpacingM": sg.s,
    }
    log(f"summit: data max {summit['maxHeightM']} m at ({summit['x']}, {summit['y']}) vs reference {sm['elevationM']} m")

    manifest = {
        "format": "mmh1",
        "preset": preset["id"],
        "datasetVersion": preset["tiles"]["datasetVersion"],
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "frame": {"proj": proj, "lat0": lat0, "lon0": lon0, "k0": 1, "axes": "x=east, y=north (metres)"},
        "heights": "metres above sea level as delivered by the sources (see sources[].verticalDatum)",
        "rootSizeM": R,
        "coreHalfSizeM": C,
        "tileCells": TILE_CELLS,
        "apron": APRON,
        "farFieldMaxLevel": L_far,
        "maxLevel": L_max,
        "sources": [
            {"id": s["id"], "bit": i, "maxLevel": s["maxLevel"], "region": s["region"], "verticalDatum": catalog[s["id"]]["verticalDatum"], "nativeResolutionM": catalog[s["id"]]["nativeResolutionM"]}
            for i, s in enumerate(srcs)
        ],
        "summit": summit,
        "stats": {"tiles": total_tiles, "bytes": total_bytes},
        "levels": manifest_levels,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf8") as fh:
        json.dump(manifest, fh, separators=(",", ":"))
    log(f"wrote {total_tiles} tiles, {total_bytes/1e6:.1f} MB -> {out_dir}")
    update_licenses(preset, srcs, catalog)


def update_licenses(preset, srcs, catalog):
    path = os.path.join(ROOT, "assets", "LICENSES.json")
    lic = json.load(open(path, encoding="utf8")) if os.path.exists(path) else {"entries": []}
    by_id = {e["id"]: e for e in lic["entries"]}
    for s in srcs:
        c = catalog[s["id"]]
        e = by_id.get(s["id"]) or {"id": s["id"], "kind": "data", "usedBy": []}
        e.update({
            "name": c["name"],
            "producer": c["producer"],
            "license": c["license"],
            "licenseUrl": c["licenseUrl"],
            "attribution": c["attribution"],
            "url": c["url"],
        })
        if "disclaimer" in c:
            e["disclaimer"] = c["disclaimer"]
        if preset["id"] not in e["usedBy"]:
            e["usedBy"] = sorted(e["usedBy"] + [preset["id"]])
        by_id[s["id"]] = e
    lic["entries"] = sorted(by_id.values(), key=lambda e: (e["kind"], e["id"]))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as fh:
        json.dump(lic, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


if __name__ == "__main__":
    main()

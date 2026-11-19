/**
 * Accuracy and integrity checks on the generated tile pyramids (public/tiles/<preset>/<version>).
 * Presets whose tiles are not built (or only present as Git LFS pointers) are skipped.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { geodesicInverse } from '../../src/geo/geodesic';
import { TransverseMercator } from '../../src/geo/tmerc';
import { HeightSampler } from '../../src/terrain/heightSampler';
import { APRON, TILE_CELLS, TILE_SAMPLES } from '../../src/terrain/tileMath';
import { DiskTiles, hasTiles, loadManifest, presets, ROOT } from '../helpers/diskTiles';
import type { MountainPreset } from '../../src/config/presets';

function maxNear(
  s: HeightSampler,
  x: number,
  y: number,
  r: number,
  step = 1,
): { h: number; x: number; y: number } {
  let best = { h: -Infinity, x, y };
  for (let dy = -r; dy <= r; dy += step)
    for (let dx = -r; dx <= r; dx += step) {
      if (dx * dx + dy * dy > r * r) continue;
      const h = s.height(x + dx, y + dy);
      if (h !== null && h > best.h) best = { h, x: x + dx, y: y + dy };
    }
  return best;
}

for (const p of presets()) {
  const built = hasTiles(p);
  describe.skipIf(!built)(`tiles: ${p.id}`, () => {
    const tiles = built ? new DiskTiles(p) : (undefined as unknown as DiskTiles);
    const m = built ? loadManifest(p) : (undefined as never);
    const tm = new TransverseMercator({ lat0: p.origin.lat, lon0: p.origin.lon });
    const sampler = built
      ? new HeightSampler(m.rootSizeM, m.maxLevel, tiles)
      : (undefined as never);

    it('manifest is consistent with the preset', () => {
      expect(m.preset).toBe(p.id);
      expect(m.rootSizeM).toBe(p.extent.rootSizeM);
      expect(m.levels.map((l) => l.level)).toEqual([...Array(m.maxLevel + 1).keys()]);
      for (const l of m.levels.filter((x) => x.level <= m.farFieldMaxLevel))
        expect(l.tiles.length).toBe(4 ** l.level);
      expect(m.levels.reduce((a, l) => a + l.tiles.length, 0)).toBe(m.stats.tiles);
    });

    it('every tile decodes with sane, finite heights', () => {
      for (const t of tiles.index.tiles.values()) {
        const d = tiles.get(t.id)!;
        expect(d.samples).toBe(TILE_SAMPLES);
        expect(Number.isFinite(d.minHeight) && d.step > 0 && d.step < 1).toBe(true);
        let mx = 0;
        for (const q of d.q) mx = Math.max(mx, q);
        const top = d.minHeight + mx * d.step;
        expect(top).toBeLessThan(9000);
        expect(Math.abs(top - t.maxH)).toBeLessThan(0.05);
        expect(Math.abs(d.minHeight - t.minH)).toBeLessThan(0.05);
      }
    });

    it('tile borders are continuous (shared edge + apron samples match their neighbours)', () => {
      let checked = 0;
      let worst = 0;
      for (const t of tiles.index.tiles.values()) {
        const a = tiles.get(t.id)!;
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          const nId = { level: t.id.level, tx: t.id.tx + dx, ty: t.id.ty + dy };
          const b = tiles.get(nId);
          if (!b) continue;
          const tol = (a.step + b.step) / 2 + 1e-4; // quantisation of both tiles + float32 source rounding
          for (let k = 0; k < TILE_SAMPLES; k++) {
            // a's samples at offsets TILE_CELLS-1..TILE_CELLS+1 equal b's at -1..+1 (apron, shared edge, apron)
            for (let o = -1; o <= 1; o++) {
              const ia = dx ? APRON + TILE_CELLS + o : k;
              const ja = dx ? k : APRON + TILE_CELLS + o;
              const ib = dx ? APRON + o : k;
              const jb = dx ? k : APRON + o;
              const ha = a.minHeight + (a.q[ja * a.samples + ia] as number) * a.step;
              const hb = b.minHeight + (b.q[jb * b.samples + ib] as number) * b.step;
              const d = Math.abs(ha - hb);
              worst = Math.max(worst, d);
              expect(d).toBeLessThanOrEqual(tol);
            }
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
      console.log(`${p.id}: ${checked} tile borders checked, worst mismatch ${worst.toFixed(4)} m`);
    });

    it(`summit height matches ${p.summit.elevationM} m within ±${p.summit.toleranceM} m (${p.summit.datum})`, () => {
      const [x, y] = tm.forward(p.summit.lat, p.summit.lon);
      const best = maxNear(sampler, x, y, p.summit.searchRadiusM);
      console.log(
        `${p.id}: summit data ${best.h.toFixed(2)} m at (${best.x}, ${best.y}), reference ${p.summit.elevationM} m`,
      );
      expect(Math.abs(best.h - p.summit.elevationM)).toBeLessThanOrEqual(p.summit.toleranceM);
    });

    it(`data is georeferenced: highest point within ${p.summit.positionToleranceM} m of the published summit`, () => {
      const [x, y] = tm.forward(p.summit.lat, p.summit.lon);
      const best = maxNear(sampler, x, y, Math.max(p.summit.searchRadiusM, 100), 2);
      expect(Math.hypot(best.x - x, best.y - y)).toBeLessThan(p.summit.positionToleranceM);
    });

    for (const l of p.landmarks.filter((x) => x.elevationM !== undefined)) {
      it(`landmark ${l.name}: ${l.elevationM} m ±${l.toleranceM ?? 3} m`, () => {
        const [x, y] = tm.forward(l.lat, l.lon);
        const h = l.searchRadiusM
          ? maxNear(sampler, x, y, l.searchRadiusM, 2).h
          : sampler.height(x, y)!;
        console.log(`${p.id}: ${l.name} data ${h.toFixed(1)} m vs ${l.elevationM} m`);
        expect(Math.abs(h - l.elevationM!)).toBeLessThanOrEqual(l.toleranceM ?? 3);
      });
    }
  });

  describe(`local frame distances: ${p.id}`, () => {
    const tm = new TransverseMercator({ lat0: p.origin.lat, lon0: p.origin.lon });
    const pts = [{ name: 'summit', lat: p.summit.lat, lon: p.summit.lon }, ...p.landmarks];
    it('horizontal distances between landmarks match WGS84 geodesics within 0.1%', () => {
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i]!;
          const b = pts[j]!;
          const g = geodesicInverse(a.lat, a.lon, b.lat, b.lon).distanceM;
          if (g < 1) continue;
          const [ax, ay] = tm.forward(a.lat, a.lon);
          const [bx, by] = tm.forward(b.lat, b.lon);
          const local = Math.hypot(bx - ax, by - ay);
          expect(Math.abs(local - g) / g, `${a.name} - ${b.name}`).toBeLessThan(1e-3);
        }
    });
  });
}

describe('assets/LICENSES.json', () => {
  const lic = JSON.parse(readFileSync(resolve(ROOT, 'assets/LICENSES.json'), 'utf8')) as {
    entries: {
      id: string;
      kind: string;
      license: string;
      attribution: string;
      usedBy?: string[];
    }[];
  };
  it('every entry has a licence and an attribution', () => {
    for (const e of lic.entries) {
      expect(e.license, e.id).toBeTruthy();
      expect(e.attribution, e.id).toBeTruthy();
    }
  });
  it('every data source of every built preset has a licence entry that lists the preset', () => {
    for (const p of presets().filter((x: MountainPreset) => hasTiles(x)))
      for (const s of p.sources) {
        const e = lic.entries.find((x) => x.id === s.id);
        expect(e, `${p.id}/${s.id}`).toBeDefined();
        expect(e!.usedBy).toContain(p.id);
      }
  });
  it('three.js (bundled code) is credited', () => {
    expect(lic.entries.find((e) => e.id === 'three')).toBeDefined();
  });
});

# PLAN.md — Modulo: Mountain

Status: **awaiting your OK.** No Phase 1 code is written yet. Steps 0 and 1 are done (ENVIRONMENT.md, SETUP.md, RESEARCH.md); the hello-world scaffold and CI are green on GitHub Actions.

Things I need from you are collected in **"Decisions I need from you"** at the bottom.

---

## 0. What changed from your brief because of the research

1. **Data sources.** The brief suggested swissALTI3D + Copernicus/Terrarium. Measured on real data, Copernicus and Terrarium cut the Matterhorn summit by 149 m and 124 m. Instead:
   - **swissALTI3D 2024 (2 m)** covers the whole Matterhorn pyramid. Its 2024 tiles include the Italian south face (coverage reaches ~1.7 km south of the summit).
   - **swissALTIRegio (10 m)**, swisstopo's own mosaic that includes TINITALY data for Italy, covers the rest. It reads 4477.0 m at the summit and agrees with swissALTI3D to a median of 0.08 m.
   - Copernicus GLO-30 stays as the fallback source for presets outside Swiss coverage (Everest).
2. **A far field is needed.** A 16×16 km box ends 8 km from the summit, but you asked for ≥ 20 km visibility. I add a 64×64 km far field at 16–256 m resolution (+16 MB) so Monte Rosa, Weisshorn, Dom and Dent Blanche stand on the horizon. The 16 km core keeps full resolution.
3. **No pointer lock on iPad Safari** (MDN compat data). iPad gets drag-to-look with mouse/trackpad, plus the touch joysticks.
4. **Normals computed client-side** in the tile worker instead of downloaded. This halves the bytes; an offline bake stays available as a flag (see decisions).

---

## 1. Budgets (Matterhorn preset)

| Item                    | Budget                                                      | Basis                                         |
| ----------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| First meaningful render | **≈ 4.5 MB** (manifest + 85 coarse tiles + JS)              | measured tile sizes, measured bundle          |
| Sharp first view        | **< 10 MB**                                                 | + ~60–120 fine tiles near the camera          |
| Total streamed dataset  | **≈ 61 MB** (~1,290 tiles), optional summit 1 m level +3 MB | coverage map × 48 KiB/tile                    |
| Height precision        | 2 cm quantisation (source accuracy 1–3 m above 2,000 m)     | swisstopo spec                                |
| GPU memory              | desktop ≤ 600 MB, **iPad ≤ 400 MB** (your ceiling: 1 GB)    | RESEARCH.md §8                                |
| Frame rate              | 60 fps desktop, 30 fps iPad profile, ≥ 20 km visibility     | your targets; measured later on real hardware |

---

## 2. Hosting the tiles

The dataset is about 61 MB in about 1,300 files, so it fits the Vercel static deployment easily via Git integration. The CLI limit (100 MB / 15,000 files on Hobby) does not apply to Git-integration builds.

**Proposal:** commit the generated tiles under `public/tiles/<preset>/<datasetVersion>/` **with Git LFS**, and enable LFS in the Vercel project (Vercel supports it). The app loads tiles from `config.tileBaseUrl` (default `/tiles/`), so moving to Cloudflare R2 or Vercel Blob later is a config change.

**Alternative:** plain git without LFS. Simpler, and fine for one or two presets, but every dataset regeneration adds ~60 MB to the history permanently.

---

## 3. Phase 1 — milestones (each = one commit or more, screenshots, then the next)

### M1.1 Data pipeline + presets

- `data/mountains.json`: three presets.
  - **matterhorn** (default): centre 45.97639 N 7.65861 E, reference 4,478 m (LN02 heights; 1999 GPS survey 4,477.54 m).
  - **eiger-moench-jungfrau**: Eiger 3,967 m, Mönch 4,110 m, Jungfrau 4,158 m, all on swissALTI3D.
  - **everest** (placeholder): Copernicus GLO-30 only.
  - Each preset has: bounding boxes (core and far field), source priority list, summit, reference elevation with its datum and source, landmarks for the tests, camera bookmarks, and a tile-level policy.
- Schema in `src/config/presetSchema.ts`, validated by a hand-written type guard (no runtime dependency).
- `scripts/fetch-dem.ts` (Node + tsx):
  - Queries the swisstopo STAC API for swissALTI3D items in the core box (newest edition per tile).
  - Downloads them into `.dem-cache/` with checksums, a polite rate limit and resume.
  - Fetches the swissALTIRegio window via GDAL `/vsicurl/` (no full 12 GB download).
  - Fetches Copernicus tiles when the preset needs them.
- `scripts/build-tiles.ts` + `scripts/gdal/*.sh`:
  - VRT mosaics → `gdalwarp` to the preset's local transverse Mercator → priority blend with feathered seams → spike filter → pyramid levels.
  - Writes 256-cell tiles (+2-sample apron, shared edges) in the `.mmh` format (2 cm, predictor + zig-zag + gzip), `manifest.json`, and `assets/LICENSES.json` with verbatim attribution strings.
- Unit tests: tile math, coordinate conversions (against GDAL/PROJ reference points generated once and stored as fixtures), `.mmh` round trip, manifest and licence validation.

### M1.2 Terrain engine (greybox)

- Worker decode → R16UI height and RG8 normal texture arrays → CDLOD quadtree with 3D-distance LOD, morph ranges, frustum culling and an LRU byte-budget cache.
- Instanced drawing, camera-relative positions, reversed-Z with a float depth target (with a fallback).
- Includes the **depth spike**: screenshots at near = 0.1 m on the summit, plus a distant ridge, to show no z-fighting.
- Greybox shading: hillshade from an adjustable sun, hypsometric tint, slope shading, shader contour lines (10/50/100 m), 100 m grid overlay.

### M1.3 Flight + HUD + scale aids

- Flight controller (WASD/QE, Shift boost, wheel speed on a log scale 1–3,000 m/s, FOV slider):
  - Pointer lock where available, drag-to-look otherwise.
  - Terrain-aware clearance by default, no-clip toggle.
  - Orbit mode; touch joysticks; remappable keys.
- Camera bookmarks with smooth fly-to.
- HUD: altitude above sea level and above ground, speed, distance to summit, local x/z + lat/lon, heading, fps.
- Scale objects (1.8 m human, 100 m and 300 m towers, football pitch), ruler tool, debug overlay (F3) with LOD-distance and vertical-exaggeration sliders (with a warning when ≠ 1.0), credits screen.

### M1.4 Verification + deploy

- Accuracy tests:
  - Summit height within tolerance.
  - Landmark distances vs. WGS84 geodesics.
  - Tile-border continuity and no NaNs across all tiles.
- Playwright: every bookmark × {desktop, iPad}, no console errors, scripted flight path with NaN and hitch checks.
- Deployed to Vercel, with a summary, screenshots, sizes and open issues.

### Accuracy tolerances (proposed)

- **Summit:** the sampled maximum within 10 m of the summit must be within **±1.5 m of 4,478 m**. The data reads 4477.22 m. LN02 heights vs. the published value; tolerance from the swisstopo 1–3 m σ above 2,000 m.
- **Everest:** tolerance ±150 m, with a visible "low-resolution data" note. Copernicus reads 8,732 m vs. 8,848.86 m; this is a data limit, not a bug.
- **Landmarks:** horizontal distances between published coordinates must match the in-game local-grid distance within **0.1%**. Spot heights within ±3 m (e.g. Hörnli Hut 3,260 m; data reads 3261.5 m).

### Camera bookmarks (Matterhorn; final positions picked in M1.3 from the real terrain)

| Bookmark       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `summit`       | Just above the summit ridge, looking north-east to Zermatt |
| `summit-close` | 3 m above the rock, for the precision/jitter test          |
| `hornli-hut`   | 45.982083 N 7.677083 E                                     |
| `hornli-ridge` | Mid-ridge, the main climbing route                         |
| `zermatt`      | Valley floor at 46.017 N 7.750 E, looking up the valley    |
| `north-face`   | High viewpoint ~3 km north at ~3,800 m, looking south      |
| `glacier`      | Matterhorn/Zmutt glacier area west of the north face       |
| `italian-side` | Above Rifugio Carrel (45.9727 N 7.6477 E), looking north   |
| `far-view`     | From the Breithorn (45.94111 N 7.74722 E), looking west    |

---

## 4. Phases 2–5 (unchanged from your brief, notes only)

- **Phase 2:** ambientCG is reachable through its API from the new environment. `toktx` is not available in the cloud container; see the decisions below.
- **Phase 3:** heightfield-raymarched sun visibility baked per tile when the sun moves; Preetham sky for Low tiers, Bruneton-style LUT sky + aerial perspective for higher tiers.
- **Phase 4:** presets as briefed; the benchmark route reuses the Phase 1 flight path.
- **Phase 5:** design doc only, after your approval. The hooks (`TerrainQuery`, `InputController`) are built in Phase 1.

---

## 5. Decisions I need from you

1. **Approve the data plan:** swissALTI3D 2 m + swissALTIRegio 10 m core, 64 km swissALTIRegio far field, Copernicus only as a fallback for other presets.
2. **Tile hosting:** Git LFS (recommended) or plain git? Either way, please import the repo into Vercel once (SETUP.md §5); I have no Vercel credentials.
3. **Normals:** client-side in the worker (recommended, halves the download) or baked offline into the tiles as you originally specified?
4. **Summit 1 m level** from the 0.5 m data (+3 MB, modest visual gain): build it in Phase 1, or decide after the screenshots?
5. **Phase 2 texture encoding:** run `scripts/process-assets.ts` on your machine with KTX-Software, or should I try a WASM Basis encoder from npm first?
6. **Environment:** I created a personal cloud environment `modulo-mountain` with the hosts this project needs (listed in ENVIRONMENT.md). Keep using it for this repo?

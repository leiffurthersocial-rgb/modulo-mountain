# RESEARCH.md — Step 1

How large real-scale terrain is rendered on the web, and what I decided because of it.

Conventions:

- **[S#]** cites a page I actually opened (list at the end).
- **Measured** marks numbers I produced myself with real data in this container. The scripts are in `scripts/research/`.
- **Reasoning** marks engineering judgement with no external source behind it.

---

## 1. Terrain LOD

### What the references say

- **Geometry clipmaps** (Losasso & Hoppe 2004; GPU version in GPU Gems 2, ch. 2) cache an n×n window of each level of a height pyramid as nested regular grids centred on the viewer. Finer levels cover smaller areas, only the finest level is drawn as a full square and the others as hollow rings, windows are updated toroidally as the viewer moves, and a transition region at the outer edge of each level morphs geometry toward the next coarser level to hide seams and popping. The GPU version samples heights from vertex textures; the chapter reports a 20-billion-sample grid of the United States in 355 MB at ~90 fps [S14].
- **CDLOD** (Strugar 2010) also draws directly from the heightmap but organises regular grids in a **quadtree**. Its LOD function is the precise 3D distance from the observer, the same everywhere on the mesh, and a vertex-shader morph between levels gives smooth transitions with "no need for stitching meshes" [S13].
- **Cesium quantized-mesh** is a quadtree pyramid of irregular, pre-simplified meshes. Vertices overlap their neighbours at tile edges; u/v/height are quantised to 0–32767 within each tile's bounds and stored as zig-zag-encoded deltas. Tiles also store edge-vertex index lists (west/south/east/north), which a client can use for skirts [S12].
- **Raster DEM tiles for the web**: Mapzen/AWS _Terrarium_ packs height into RGB as `(R·256 + G + B/256) − 32768`, i.e. 1/256 m resolution, in Web-Mercator 256/512 px PNG tiles [S8]. Mapbox _Terrain-RGB_ uses `−10000 + (R·65536 + G·256 + B)·0.1`, i.e. 0.1 m steps, with data up to zoom 15 [S11].

### Decision

**CDLOD-style quadtree** over a **raster height pyramid**, with **vertex-shader displacement** from height textures and **geomorphing** (no skirts needed, though I'll keep skirts as a cheap fallback flag in case of rare T-junction cracks).

Why not the alternatives:

- **Clipmaps** assume a dense, fully populated pyramid around the viewer. Our data is irregular: 2 m only where swissALTI3D exists, 10 m elsewhere. A quadtree simply stops refining where finer data does not exist; a clipmap would have to fill finer rings with upsampled data.
- **Quantized-mesh** needs per-tile mesh simplification offline and gives irregular triangles. That is good for global streaming, but for a 64 km scene a regular grid with GPU displacement is simpler, needs less data (heights only), and makes "height at any (x, z)" trivial for the future walking mode.

Borrowed ideas:

- From quantized-mesh: shared edge samples, per-tile min/max quantisation, delta + zig-zag coding.
- From clipmaps: per-level transition morph regions.
- From CDLOD: 3D-distance LOD selection and morphing.

**Culling and streaming** (Reasoning):

- Frustum-cull quadtree nodes using per-tile min/max height bounding boxes.
- Request tiles in priority order: coarse first, then by screen-space error and distance.
- Keep an LRU cache with a byte budget; a node is drawn with its nearest loaded ancestor's data until its own tile arrives. This is the "coarse first, then refine" behaviour.
- Decoding runs in a Web Worker.

---

## 2. Numerical precision at 10+ km with 4,000+ m heights

### What the references say

- Cesium's renderer applies **GPU RTE (relative to eye)**: positions are split into high and low parts on the CPU so the shader works with eye-relative coordinates [S16].
- Cesium's original multi-frustum split was 1 m–1 km, 1 km–1000 km and 1000 km–1,000,000 km. It moved to a hybrid with a **logarithmic depth buffer**. Log depth must be written per fragment for large triangles, and **writing fragment depth disables the GPU's early depth test** [S15].
- three.js `WebGLRenderer` has `reversedDepthBuffer`, enabled only when `EXT_clip_control` is present; otherwise it warns and falls back. `logarithmicDepthBuffer` is ignored when reversed depth is active [S17].
- three.js allocates `DEPTH_COMPONENT32F` for float depth textures [S17].
- MDN browser-compat-data lists **EXT_clip_control in Safari 17.4 / iOS 17.4, Chrome 122, Firefox 159** [S20].

### Decision

1. **Local metric frame.** A transverse Mercator projection centred on the preset's summit (k = 1 at the centre; Reasoning: scale error stays tiny within ±32 km). All CPU-side positions are float64 (JS numbers).
2. **Camera-relative rendering.** Each frame I compute `tileOrigin − cameraPosition` in float64 on the CPU and pass it to the shader as a float32 uniform. Vertex positions inside a tile are small local offsets. Computed: float32 spacing is 0.98 mm at 8 km and 3.9 mm at 32 km from the origin. Building world positions in float32 on the GPU at those distances causes visible jitter when the camera is close to the ground. Camera-relative rendering removes the issue.
3. **Depth: reversed-Z with a float32 depth target** where `EXT_clip_control` exists, which is all target browsers per [S20]. Reasoning: reversed-Z only pays off with a _floating-point_ depth buffer, so the scene renders into an offscreen target with a `FloatType` depth texture. We need that target anyway for the Phase 3 post-processing chain.
4. **Fallback:** logarithmic depth (it costs early-Z [S15]), or a two-frustum split.
5. **Near/far planes:** near ≈ 0.1 m (the 1.8 m human silhouette must not clip), far ≈ 60 km.
6. **Verification:** an early Phase 1 spike will check for z-fighting at the summit and on distant ridges with screenshots at near = 0.1 m.

---

## 3. Elevation data

### 3.1 Sources

| Source                            | Type / resolution                                                                                                                                                                                                                                              | Datum                                                                       | Coverage around the Matterhorn                                                                                                                                                                    | Licence / attribution                                                                                                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **swissALTI3D** (swisstopo)       | DTM (no vegetation or buildings), 0.5 m and 2 m grids in 1 km² COG tiles, updated every 6 years [S1]                                                                                                                                                           | LV95 / LN02 [S1]                                                            | Measured: 165 of the 256 km² in the 16×16 km core. **The 2024 tiles are fully filled, including the Italian side of border tiles**: the summit tile is 100% valid, whereas 2019 left 42.5% empty. | Free OGD: use, distribute, modify, commercial use allowed; source reference mandatory, e.g. "© swisstopo" [S2]                                                                                                                                                                             |
| **swissALTIRegio** (swisstopo)    | DTM, 10 m, one COG (~12 GB). Sources: swissALTI3D (CH), **TINITALY (Italy)**, RGEALTI (France), DGM (Austria/Bavaria), EU-DEM (Baden-Württemberg). Coverage reaches at least 100 km beyond the Swiss border. Precision 1.5 m (1σ) in and near Switzerland [S3] | LV95, LN02 in Switzerland; foreign heights **not** transformed to LN02 [S3] | Measured: a 72×64 km window is 100% valid                                                                                                                                                         | Same terms, but swisstopo prescribes a specific multi-source attribution string (copied verbatim into `assets/LICENSES.json` in Phase 1) [S3]                                                                                                                                              |
| **Copernicus GLO-30**             | **DSM** (includes buildings and vegetation), 1″ grid (~30 m), TanDEM-X data acquired 2011–2015 [S6]. Absolute vertical accuracy < 4 m (90% linear error) [S6]                                                                                                  | EGM2008 (EPSG:3855) [S6]                                                    | Global                                                                                                                                                                                            | Free licence; notice required: "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved", a "produced using Copernicus WorldDEM-30 …" variant for modified data, plus a no-liability sentence [S7] |
| **AWS Terrain Tiles** (Terrarium) | Composite of 3DEP, SRTM, EU-DEM, GMTED and others; Web Mercator [S8, S9]                                                                                                                                                                                       | Mixed                                                                       | Global                                                                                                                                                                                            | Per-source attributions; Europe: "produced using Copernicus data and information funded by the European Union - EU-DEM layers" [S10]                                                                                                                                                       |
| SRTM                              | ~30 m, WGS84/EGM96 [S8]                                                                                                                                                                                                                                        | EGM96                                                                       | Global to ±60°                                                                                                                                                                                    | Public domain, credit requested [S10]                                                                                                                                                                                                                                                      |

### 3.2 Measured quality at the Matterhorn

Published summit height: 4,478 m; a 1999 GPS survey gave 4,477.54 m [S28].

| Source                  | Max height within ±10–30 m of the summit | Comparison with swissALTI3D 2024, per 1 km tile (165 tiles)                                                                     |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| swissALTI3D 2024, 2 m   | **4477.22 m** (2019 edition: 4477.39 m)  | —                                                                                                                               |
| swissALTI3D 2019, 0.5 m | 4477.40 m                                | vs. cubic-upsampled 2 m: rms 0.35 m, p99 0.87 m. The 0.5 m grid has 1.9× the curvature energy, so some real extra micro-relief. |
| swissALTIRegio, 10 m    | **4477.0 m**                             | median offset **+0.08 m**, median rms **1.33 m**, p90 rms 2.2 m; worst tiles are vertical cliffs near the summit (rms 5 m)      |
| Copernicus GLO-30       | **4329.1 m** (149 m low)                 | median offset +1.9 m, median rms **13.9 m**, p90 rms 34 m, summit tile rms 88 m                                                 |
| Terrarium z12–z15       | **4354.5 m** (124 m low)                 | not tiled-compared; the tiles' source header names EU-DEM                                                                       |

Other measured facts:

- **Copernicus differs on glaciers.** At matched 30 m resolution, a stable rock/meadow tile agrees with swissALTI3D to a median of 1.1 m (rms 2.7 m), but glacier tiles differ by 5–19 m. This is consistent with TanDEM-X acquisition in 2011–2015 [S6] and glacier change since then, but I have not separated the causes.
- **Landmark check.** At the Hörnli Hut (45.982083 N, 7.677083 E [S28]) swissALTI3D gives **3261.5 m**, against a published 3,260 m [S28]. The summit-to-hut horizontal distance is 1565.4 m in the LV95 plane and 1561.5 m by spherical haversine. A proper WGS84 geodesic will be the reference in the Phase 1 tests.
- **Above 2,000 m swissALTI3D comes from stereo correlation** with 1–3 m accuracy (1σ) [S1]. A 2 cm height quantisation is therefore far below the noise floor.

### 3.3 Decision

1. **Core (16×16 km around the summit):** swissALTI3D 2024 at 2 m wherever it exists (165 km², including the whole Matterhorn pyramid and its south face). The remaining ~91 km² in the south-west (Valtournenche / Breuil-Cervinia) uses swissALTIRegio at 10 m.
2. **Far field (64×64 km):** swissALTIRegio at 10 m, downsampled to 16 m and coarser. This puts Monte Rosa, Weisshorn, Dom and Dent Blanche on the horizon. Without it, the "≥20 km visibility" requirement would show the edge of the data from the summit.
3. **Copernicus GLO-30 is a fallback only**, for presets outside swissALTIRegio's coverage (Everest). Terrarium and SRTM are rejected: peaks are cut by more than 100 m and quality is worse than Copernicus in every test I ran.
4. **Optional summit detail:** a 1 m level within ~1 km of the summit, built from the 0.5 m data. It adds little (rms 0.35 m), so it is a Phase 1 stretch, decided after viewing screenshots.

### 3.4 Datums, coordinate systems and seams

- **Heights:** swissALTI3D and swissALTIRegio are LN02 (Switzerland). The Italian part of swissALTIRegio keeps Italy's original height system [S3]. Copernicus uses EGM2008 [S6]. All of these are geoid- or levelling-based "above sea level" heights, not ellipsoidal heights. We store and display them as "metres above sea level" and record the datum per source in the manifest. Everest will be EGM2008 via Copernicus.
- **Measured datum agreement:** swissALTIRegio vs. swissALTI3D median +0.08 m, so no correction is needed. Copernicus vs. swissALTI3D on stable terrain is about 1 m. Copernicus is not used in the Matterhorn preset.
- **Horizontal:** sources come in LV95 (EPSG:2056) or WGS84 lat/lon. `gdalwarp` reprojects everything into the preset's local transverse Mercator frame: `+proj=tmerc +lat_0=<summit> +lon_0=<summit> +k=1 +x_0=0 +y_0=0 +ellps=WGS84`. In-game x = east, z = −north, y = height.
- **Seams between resolutions:**
  - The fine source wins.
  - Within a feather band (~150 m inside the fine data's footprint), heights blend linearly from fine to coarse. Because the coarse-level tiles are built _from the same blended mosaic_, levels stay consistent.
  - The quality mask (fine/coarse/blend) is stored per tile so the renderer and tests know which source applies where.
  - When a coarse source has a systematic local offset (Copernicus on glaciers), the offset along the seam is estimated and diffused into the coarse side before feathering. Reasoning; it is only needed for Copernicus-based presets.

---

## 4. iPad Safari specifics

| Topic                         | Finding                                                                                                                                                                                                                                                               | Consequence                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Float32 linear filtering      | MDN BCD lists `OES_texture_float_linear` for Safari iOS with the note "Only supported on iPadOS" [S20]                                                                                                                                                                | Not relied on anyway: heights are read with `texelFetch` (no filtering needed, because CDLOD vertices align with texels), and normals live in filterable RG8 textures.                                                   |
| 16-bit textures               | `R16UI` is core WebGL2; `EXT_texture_norm16` exists in Safari/iOS 16+ [S20]                                                                                                                                                                                           | Heights uploaded as **R16UI** with per-tile `min` and `scale` uniforms.                                                                                                                                                  |
| Height encoding over the wire | Measured on 256² tiles of real 2 m data (`encoding_benchmark.py`): Terrarium PNG 98 KiB, Terrarium WebP-lossless 73–75 KiB, **16-bit at 2 cm + 2D predictor + zig-zag + byte planes + gzip 46–50 KiB** (max error 1 cm), same with xz 44–49 KiB, 16-bit PNG 68–70 KiB | Custom `.mmh` tile = small header + gzip payload, decoded in a worker with `DecompressionStream` (Safari 16.4+ [S20]). Half the size of Terrarium and it never passes through colour-managed image decoding.             |
| Compressed textures           | ASTC in Safari/iOS 12+, ETC in 13.1+, S3TC listed from Safari 8 [S20]; KTX2 + Basis Universal transcodes one file to the GPU's native format [S19, S23]                                                                                                               | Phase 2 textures as KTX2 (UASTC for normals and detail, ETC1S for macro colour), transcoded by three.js `KTX2Loader`.                                                                                                    |
| Pointer Lock                  | **Not supported in Safari on iOS/iPadOS** (`requestPointerLock`: `safari_ios: false`) [S20]                                                                                                                                                                           | On iPad, mouse/trackpad look uses **drag-to-look** (pointer events) instead of pointer lock. Touch joysticks are offered on touch devices.                                                                               |
| WebGPU                        | Shipping in Safari 26.0 on macOS, iOS, iPadOS and visionOS; three.js is named as working [S22]; BCD lists Safari/iOS 26 [S20]                                                                                                                                         | Viable on current iPads. WebGL2 stays the baseline (older iPadOS, Firefox); the renderer sits behind `RenderBackend` (already in the scaffold). A WebGPU backend means porting GLSL to TSL/WGSL; earliest after Phase 4. |
| Memory                        | WebGL offers no VRAM query; budget conservatively, handle context loss, prefer `texStorage` because some drivers allocate full mip chains [S19]                                                                                                                       | Explicit byte-counted caches; immutable texture arrays; `webglcontextlost` handling. I found no authoritative iPad Safari memory limit, so the ~1 GB target is your budget, and I plan for ≤ 400 MB (see budgets).       |
| Depth formats                 | On Apple GPUs a 24-bit depth format may be stored as 32-bit float; request stencil only if used [S19]                                                                                                                                                                 | No stencil buffer; float depth target (see §2).                                                                                                                                                                          |
| Texture size                  | Not researched to an authoritative per-device number                                                                                                                                                                                                                  | Query `MAX_TEXTURE_SIZE` and `MAX_ARRAY_TEXTURE_LAYERS` at runtime; tiles are 260², arrays ≤ 256 layers.                                                                                                                 |

---

## 5. Terrain texturing (Phase 2)

### Sources

- Mikkelsen's _Practical Real-Time Hex-Tiling_ (JCGT 2022) adapts Heitz & Neyret's by-example noise. Each hexagonal region samples at a random offset; it drops histogram preservation in favour of a blend that samples the original texture, adds a weight metric to diffuse hex transitions, and applies a contrast function to colour weights. It works especially well for normal maps [S24].
- KTX2 with Basis Universal offers ETC1S (small) and UASTC (higher quality) [S23].
- MDN notes that compressed formats are generally only acceptable for colours, not normals [S19]. Reasoning: UASTC normals are commonly fine, but I will check normal quality in the `/lab` route rather than assume it.

### Planned material system (Reasoning, to be validated in `/lab`)

- **Weights:** layer weights from slope (normal.y), altitude, curvature (Laplacian of the heights, available per tile) and, later, snow.
- **Height-based blending** between layers using each material's height/displacement map.
- **Triplanar** sampling only where slope exceeds ~50°, to limit the 3× sample cost.
- **World-space scales in metres;** detail textures fade into a macro colour/variation layer with distance. Hex-tiling for repetition on rock and ground; a cheaper 2-tap variant in Battery Saver.
- **Normals:** whiteout/UDN-style blending of detail normals onto the terrain normal. Mipmaps plus anisotropy (`EXT_texture_filter_anisotropic`, capped per quality preset).
- **Texture arrays:** one per map type (albedo, normal, ORM), same size per tier. Arrays avoid atlas bleeding and work with hex-tiling's random offsets.
- **Tooling gap:** `toktx` cannot be downloaded in this container (GitHub release assets are blocked). Options for Phase 2: (a) run `scripts/process-assets.ts` on your machine with KTX-Software installed; (b) find a WASM Basis encoder on npm and evaluate it; (c) commit pre-encoded KTX2 files.

---

## 6. Terrain shading (Phase 3)

- **Normals:** derived from heights per tile in the decode worker. Central differences need the 2-sample apron included in each tile. Stored as RG8 octahedral-encoded or (x, z) components, filterable. This saves downloading a second texture per tile (Reasoning: an 8-bit normal map has much less inter-sample correlation than heights, so it would likely add as many bytes as the heights themselves; not measured). If you prefer offline-baked normals in the pipeline, it is a flag.
- **Sky:** three.js ships a Preetham analytic sky (`Sky.js`) [S18]. Bruneton's precomputed atmospheric scattering has a BSD-licensed reference implementation [S25].
  - Plan: Preetham-style analytic sky for Low/Battery Saver.
  - A Bruneton-style precomputed LUT (transmittance + scattering), evaluated per pixel for sky _and_ aerial perspective on terrain, for Medium and up.
  - Hosek-Wilkie: not reviewed; no source opened.
- **Shadows (Reasoning):** cascaded shadow maps fit a 64 km scene poorly. The mountain casts shadows kilometres long at low sun, and cascades would need very large far splits.
  - Plan: **heightfield ray-marching** against a coarse global height texture (≤ 64 m) plus the local tile heights. The result is computed into a per-tile R8 "sun visibility" texture whenever the sun moves by more than ~0.25°. Time of day changes slowly, so this costs nothing per frame and doubles as the baked shadow for Battery Saver.
  - Contact shadows at close range: a short screen-space or fine-heightfield march.
- **AO (Reasoning):** horizon-based AO from the heightfield, a few azimuths sampled at 2–3 radii, baked per tile at decode time (static terrain).
- **Clouds and fog (Reasoning):** 2–3 layered noise planes with height-fog density for valleys. Snow plumes as GPU particles in Phase 3.
- **Snow (Reasoning):** coverage = f(altitude − snow line, slope, aspect relative to the sun/wind direction, curvature, noise). Glaciers could come from swisstopo/open glacier outlines later (stretch).

---

## 7. Recommended architecture (one page)

```
data/mountains.json ──► scripts/fetch-dem.ts ──► .dem-cache/ (raw COG tiles, VRTs)
                         scripts/build-tiles.ts (+ gdal_*.sh)
                           1. gdalwarp each source -> local tmerc, per level resolution
                           2. blend sources by priority with feathered masks
                           3. cut 256-cell tiles (+2 apron, shared edges), quantise 2 cm,
                              predictor + zig-zag + gzip -> /tiles/<preset>/<ver>/<L>/<x>/<y>.mmh
                           4. manifest.json (levels, bounds, min/max per tile, sources, datum)
                           5. assets/LICENSES.json entries

Browser
 ├─ main thread
 │   ├─ Preset/Manifest loader ─ TerrainQuadtree (CDLOD select, frustum cull, morph ranges)
 │   ├─ TileCache (LRU, byte budget) ◄── TileStreamer (priority queue, N parallel fetches)
 │   ├─ TerrainRenderer: 1 instanced draw per LOD band; per-instance
 │   │      {layer, tileOrigin-camera (f32), scale, morph}; height R16UI + normal RG8 arrays
 │   ├─ CameraRig (float64): FlightController | OrbitController | (later) WalkController
 │   │      via InputController interface; TerrainQuery.heightAt(x,z), normalAt(x,z)
 │   ├─ HUD / Debug overlay (F3) / Scale objects / Ruler / Credits
 │   └─ RenderBackend (WebGL2 now; WebGPU later) -> offscreen RT (float depth, reversed-Z)
 │                                               -> post (tone map; Phase 3 adds more)
 └─ worker(s): fetch -> DecompressionStream -> unquantise -> normals/AO/curvature
               -> transferable buffers back to main
```

Key properties:

- **One code path for every preset;** a new mountain is data only.
- **TerrainQuery** answers height, normal and material at any (x, z) from the loaded tiles (best available level). It is the hook for walking and collision.
- **Determinism:** screenshot mode waits until "all tiles needed for this view are resident" before signalling ready.

---

## 8. Data and memory budgets

Tile pyramid: root 65,536 m; 256 cells per tile; level spacing 256 / 128 / 64 / 32 / 16 / 8 / 4 / 2 (/1) m for L0–L7 (L8). Per-tile size is measured at 44–57 KiB; I use 48 KiB as the average.

| Level            | Spacing  | Extent covered             | Tiles               | ≈ MB          |
| ---------------- | -------- | -------------------------- | ------------------- | ------------- |
| L0–L4            | 256–16 m | 64×64 km far field         | 1+4+16+64+256 = 341 | 16            |
| L5               | 8 m      | 16 km core (all)           | 64                  | 3             |
| L6               | 4 m      | core where 2 m data exists | ~186                | 9             |
| L7               | 2 m      | core where 2 m data exists | ~695                | 33            |
| _(L8, optional)_ | 1 m      | ~2×2 km summit             | 64                  | 3             |
| **Total**        |          |                            | **~1,290 (+64)**    | **≈ 61 (+3)** |

Tile counts for L5–L7 are computed from the measured coverage map. The 64×64 km far-field size is a design choice (8 km core half-width + 20 km visibility + margin).

- **First meaningful render:** manifest + L0–L3 (85 tiles ≈ 4 MB) + JS (measured: the current hello-world bundle is 534 KB minified / 131 KB gzip, mostly three.js) ≈ **4.5 MB**. A typical first view then refines with ~60–120 L4–L7 tiles (3–6 MB). Target **< 10 MB to a sharp view**, well under the suggested 15 MB.
- **Total streamed dataset:** **≈ 61 MB** for the Matterhorn preset, far under the suggested 300 MB.
- **Source download cache** (not deployed): swissALTI3D 2 m ≈ 176 MB (measured) + a swissALTIRegio window ≈ 100–200 MB.

GPU memory (Reasoning, from texture sizes):

- Per resident tile: height R16UI 260² ≈ 135 KB + normal RG8 ≈ 135 KB + optional AO/shadow R8 ≈ 68 KB ≈ **0.34 MB**.
- Desktop cache 512 tiles ≈ 175 MB; iPad 256 tiles ≈ 87 MB.
- Phase 2 textures (2k tier, 4 materials × albedo/normal/ORM in UASTC ≈ 1 byte/texel incl. mips ≈ 5.6 MB each) ≈ 70 MB; 1k tier ≈ 18 MB.
- Render targets at 2360×1640 (iPad Air native) with a float depth target and an HDR colour buffer ≈ 80 MB.
- **iPad total target ≤ 400 MB GPU + ≤ 150 MB JS heap**, well under the 1 GB ceiling.

---

## 9. Risks

| Risk                                                                                      | Likelihood                                                                    | Impact                                     | Mitigation                                                                                         |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Reversed-Z / float depth behaves differently on real Safari                               | medium                                                                        | z-fighting or flicker at distance          | Early depth spike; log-depth fallback; adaptive near plane                                         |
| SwiftShader CI cannot measure performance                                                 | certain                                                                       | fps claims unverifiable in CI              | In-app benchmark route; you run it on real hardware; numbers labelled by device                    |
| No WebKit browser in Playwright here                                                      | certain                                                                       | iPad-only bugs missed                      | iPad profile emulates viewport/touch only; I'll provide a manual iPad checklist                    |
| Pointer Lock missing on iPadOS [S20]                                                      | certain                                                                       | mouse-look differs on iPad                 | Drag-to-look fallback, tested via pointer-event emulation                                          |
| swissALTI3D stereo-correlation artefacts above 2,000 m (1–3 m σ [S1])                     | medium                                                                        | spikes or noise on faces                   | Spike filter in the pipeline (compare with the 10 m data, clamp outliers) and screenshots          |
| Glacier/time differences between sources at seams                                         | low for the Matterhorn (same producer, +0.08 m) / high for Copernicus presets | visible step at the seam                   | Feathered blend with local offset diffusion; tests for border continuity                           |
| Tile hosting in git (≈ 61 MB, ~1,300 files) bloats history if regenerated often           | medium                                                                        | slow clones                                | Versioned dataset directory; Git LFS (Vercel supports it [S27]) or R2/Blob later via `tileBaseUrl` |
| Vercel CLI limits (100 MB Hobby uploads, 15,000 files [S26])                              | low (Git integration used)                                                    | deploy failure                             | Git-integration deploys; tiles can move to object storage                                          |
| KTX2 tooling blocked here                                                                 | certain for Phase 2                                                           | can't encode textures in the cloud session | Run the encode step locally, or a WASM encoder                                                     |
| Licence obligations (Copernicus no-liability sentence, swissALTIRegio attribution string) | low                                                                           | non-compliance                             | `LICENSES.json` with verbatim strings + a Vitest check + credits screen                            |
| Upstream data changes (new swissALTI3D edition)                                           | low                                                                           | accuracy tests drift                       | Pin the edition/year in the manifest; cache source checksums                                       |

---

## Sources (all opened during this research)

- [S1] swisstopo, swissALTI3D product page — https://www.swisstopo.admin.ch/en/height-model-swissalti3d
- [S2] swisstopo, Terms of use for free geodata and geoservices (OGD) — https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices
- [S3] swisstopo, swissALTIRegio product page — https://www.swisstopo.admin.ch/en/height-model-swissaltiregio
- [S4] swisstopo STAC API (collections `ch.swisstopo.swissalti3d`, `ch.swisstopo.swissaltiregio`) — https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d
- [S5] Copernicus DEM on AWS, readme — https://copernicus-dem-30m.s3.amazonaws.com/readme.html
- [S6] Copernicus Data Space Ecosystem, Copernicus DEM collection description — https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- [S7] Licence for Copernicus DEM GLO-30 (PDF) — https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf
- [S8] tilezen/joerd, Terrain tile formats — https://raw.githubusercontent.com/tilezen/joerd/master/docs/formats.md
- [S9] tilezen/joerd, Data sources — https://raw.githubusercontent.com/tilezen/joerd/master/docs/data-sources.md
- [S10] tilezen/joerd, Attribution — https://raw.githubusercontent.com/tilezen/joerd/master/docs/attribution.md
- [S11] Mapbox Terrain-RGB v1 reference — https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/
- [S12] Cesium quantized-mesh-1.0 specification — https://raw.githubusercontent.com/CesiumGS/quantized-mesh/main/README.md
- [S13] F. Strugar, CDLOD README — https://raw.githubusercontent.com/fstrugar/CDLOD/master/README.md
- [S14] GPU Gems 2, ch. 2, Terrain Rendering Using GPU-Based Geometry Clipmaps — https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry
- [S15] Cesium blog, Hybrid Multi-Frustum Logarithmic Depth Buffer — https://cesium.com/blog/2018/05/24/logarithmic-depth/
- [S16] Cesium blog, Graphics Tech in Cesium — The Graphics Stack — https://cesium.com/blog/2015/05/26/graphics-tech-in-cesium-stack
- [S17] three.js source: `WebGLRenderer.js`, `webgl/WebGLCapabilities.js`, `webgl/WebGLTextures.js` — https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/WebGLRenderer.js
- [S18] three.js source: `examples/jsm/objects/Sky.js` — https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/objects/Sky.js
- [S19] MDN, WebGL best practices — https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- [S20] MDN browser-compat-data (api/EXT_clip_control, OES_texture_float_linear, EXT_color_buffer_float, EXT_color_buffer_half_float, EXT_texture_norm16, WEBGL_compressed_texture_astc/etc/s3tc, GPU, DecompressionStream, OffscreenCanvas, Element.requestPointerLock) — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/
- [S21] MDN, OES_texture_float_linear and Pointer Lock API pages — https://developer.mozilla.org/en-US/docs/Web/API/OES_texture_float_linear , https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API
- [S22] WebKit blog, WebKit Features in Safari 26.0 — https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- [S23] Khronos, KTX overview — https://www.khronos.org/ktx/
- [S24] M. S. Mikkelsen, Practical Real-Time Hex-Tiling, JCGT 11(2), 2022 — https://jcgt.org/published/0011/03/05/
- [S25] E. Bruneton, Precomputed Atmospheric Scattering (README) — https://raw.githubusercontent.com/ebruneton/precomputed_atmospheric_scattering/master/README.md
- [S26] Vercel, Limits — https://vercel.com/docs/limits
- [S27] Vercel, Git settings (Git LFS) — https://vercel.com/docs/project-configuration/git-settings
- [S28] Wikipedia: Matterhorn, Hörnli Hut, Swiss coordinate system, Breithorn, Eiger, Mönch, Jungfrau, Mount Everest — https://en.wikipedia.org/wiki/Matterhorn (and sibling pages)

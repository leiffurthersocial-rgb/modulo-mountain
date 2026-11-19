# DECISIONS.md

Each entry: what, why, alternatives rejected. Status is **Proposed** until you approve PLAN.md.

## D1 — Tooling: Vite 8 + TypeScript 6 (strict) + three.js r187, Vitest 5, Playwright 1.63 — Accepted (Step 0)

- **Why:** as briefed. TypeScript is pinned to 6.0.3 because `typescript-eslint` 8.73 supports `<6.1`. Playwright is pinned to 1.63.0 to match the Chromium build pre-installed in the cloud container. All versions are exact in `package.json`.
- **Rejected:** TypeScript 7.0 (not supported by the lint toolchain yet).

## D2 — Renderer: WebGL2 baseline behind a `RenderBackend` interface — Accepted (Step 0)

- **Why:** WebGPU ships in Safari 26 (iOS/iPadOS included) and three.js works there, but WebGL2 reaches older iPadOS and has the most predictable tooling. The interface keeps a later WebGPU backend possible.
- **Rejected:** WebGPU-first (excludes pre-26 iPads; GLSL→TSL port cost now).

## D3 — Deployment through Vercel's GitHub integration — Accepted (Step 0)

- **Why:** you declined providing a Vercel token to the cloud session. Git integration deploys every push and has no CLI upload limits.
- **Rejected:** CLI deploys from the container.

## D4 — Personal cloud environment `modulo-mountain` — Accepted (you approved the prompt)

- **Why:** the shared Default environment blocked ambientCG, research documentation and Copernicus licence pages. A per-repo environment keeps the Default untouched.

## D5 — Elevation sources: swissALTI3D 2 m + swissALTIRegio 10 m; Copernicus GLO-30 fallback only — Proposed

- **Why:** measured at the summit: swissALTI3D 4477.22 m, swissALTIRegio 4477.0 m, Copernicus 4329.1 m, Terrarium 4354.5 m (published 4,478 m). swissALTIRegio agrees with swissALTI3D to a median of +0.08 m (rms 1.33 m); Copernicus to a median rms of 13.9 m. The 2024 swissALTI3D tiles also cover the Italian south face.
- **Rejected:** Copernicus for the Italian side (DSM, 30 m, 2011–2015, peaks cut); Terrarium (EU-DEM-based, peaks cut); 0.5 m swissALTI3D everywhere (26 MB/km² source, little extra detail above 2,000 m).

## D6 — 64×64 km far field around a 16×16 km core — Proposed

- **Why:** ≥ 20 km visibility from the summit would otherwise show the edge of the data. It costs about 16 MB at ≤ 16 m resolution.
- **Rejected:** only 16 km (visible edge); fog to hide the edge (contradicts the visibility target).

## D7 — Local transverse Mercator frame per preset, float64 CPU, camera-relative GPU — Proposed

- **Why:** true ground distances near the centre; works for any preset with no code changes; float32 world positions would jitter by mm at 8–32 km.
- **Rejected:** LV95 directly (Swiss-only, scale distortion); Web Mercator (scale factor ~1.44 at 46° N, so distances would not be true); ECEF (curvature handling is unnecessary at 64 km).

## D8 — Terrain LOD: CDLOD-style quadtree with geomorphing, heights via `texelFetch` from R16UI arrays — Proposed

- **Why:** handles irregular data coverage, smooth transitions without stitching, trivial height queries, iPad-safe (no float filtering).
- **Rejected:** geometry clipmaps (assume a dense pyramid everywhere); quantized-mesh (offline simplification, irregular meshes); Terrarium RGBA8 textures (unnecessary given R16UI).

## D9 — Tile encoding `.mmh`: 16-bit, 2 cm quantisation, 2D predictor + zig-zag + byte planes + gzip — Proposed

- **Why:** measured 46–50 KiB per 256² tile vs. 98 KiB for Terrarium PNG and 73–75 KiB for Terrarium WebP-lossless, with max error 1 cm. Decoded with `DecompressionStream` in a worker.
- **Rejected:** Terrarium PNG/WebP (larger, goes through image decoding); xz (5–10% smaller but needs a JS decoder); 16-bit PNG (browsers decode it to 8 bits).

## D10 — Depth: reversed-Z with a float32 depth target; log-depth fallback — Proposed

- **Why:** near 0.1 m to far ~60 km. `EXT_clip_control` is in Safari/iOS 17.4+, Chrome 122+ and Firefox 159+. Log depth writes `gl_FragDepth`, which disables early-Z.
- To be verified by the M1.2 depth spike.

## D11 — iPad look controls: drag-to-look fallback — Proposed

- **Why:** MDN compat data lists no Pointer Lock support in Safari on iOS/iPadOS.

## D12 — Tile hosting: git + LFS under `public/tiles/<preset>/<version>/`, `tileBaseUrl` config — Proposed (needs your choice)

- **Why:** ~61 MB and ~1,300 files fit a static deploy. Versioned paths make immutable caching safe.
- **Rejected for now:** R2/Vercel Blob (needs accounts and credentials; not needed at this size).

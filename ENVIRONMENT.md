# ENVIRONMENT.md — Step 0 environment audit

Audit date: 2026-11-19. Machine: Claude Code cloud container (ephemeral; anything not pushed is lost).

## System

| Item                   | Value                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS                     | Ubuntu 24.04.5 LTS, Linux 6.18 x86_64, 4 vCPU, 15 GiB RAM, no swap                                                                                                                                                     |
| Disk                   | 60 GB available (per-session allowance; `df` shows 252 GB total)                                                                                                                                                       |
| Node / npm             | Node v22.23.5, npm 10.9.9 (pnpm 10.28, yarn 1.22 also present)                                                                                                                                                         |
| git                    | 2.43.0 — push to `leiffurthersocial-rgb/modulo-mountain` works (through the session's git proxy)                                                                                                                       |
| GitHub CLI             | `gh` installed, but the `GH_TOKEN` in this container is **invalid** (`gh auth status` fails). GitHub access works through the GitHub MCP tools and plain `git push` instead.                                           |
| Vercel CLI             | Not installed globally (`npx vercel` would work; npm registry reachable, latest 66.2.0). **Not authenticated**: you declined providing a token, so deployment goes through Vercel's GitHub integration (see SETUP.md). |
| Python                 | Default `python3` = 3.13.18 (no GDAL bindings). `/usr/bin/python3.12` has **GDAL 3.8.4 bindings + NumPy 1.26.4 + Pillow 10.2**. `rasterio` is not installed (a wheel for 3.13 is available on PyPI if ever needed).    |
| GDAL CLI               | `gdalinfo`, `gdal_translate`, `gdalwarp`, `gdaldem`, `gdalbuildvrt` 3.8.4; PROJ 9.4.0. Drivers: GTiff, COG, PNG, WEBP.                                                                                                 |
| ffmpeg                 | Installed (`/usr/bin/ffmpeg`).                                                                                                                                                                                         |
| KTX-Software (`toktx`) | **Not installed.** GitHub release downloads for `KhronosGroup/KTX-Software` are blocked here (GitHub access is scoped to this repo). Needed only in Phase 2; options in RESEARCH.md §5.                                |
| gltf-transform         | Not installed; available from npm (`@gltf-transform/cli` 4.5.1). It calls `toktx` for KTX2, so it has the same Phase 2 dependency.                                                                                     |
| Playwright             | Global 1.63.0 with Chromium build 1243 at `/opt/pw-browsers`. The project pins `@playwright/test@1.63.0` so it uses that browser.                                                                                      |

## Headless WebGL2 (Playwright + Chromium)

All three launch configurations produce a working WebGL2 context:

| Flags                                                                      | WebGL2 | Renderer                     | MAX_TEXTURE_SIZE | Array layers | float-linear | color-buffer-float | EXT_clip_control | WebGPU |
| -------------------------------------------------------------------------- | ------ | ---------------------------- | ---------------- | ------------ | ------------ | ------------------ | ---------------- | ------ |
| (none)                                                                     | yes    | ANGLE / Vulkan / SwiftShader | 8192             | 2048         | yes          | yes                | yes              | no     |
| `--use-angle=swiftshader --enable-unsafe-swiftshader`                      | yes    | same                         | 8192             | 2048         | yes          | yes                | yes              | no     |
| `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` | yes    | same                         | 8192             | 2048         | yes          | yes                | yes              | no     |

SwiftShader is a **CPU** renderer. Screenshots are correct, but frame rates measured here say nothing about real GPUs; the performance numbers I report later will come from the in-app benchmark run on real hardware (yours) or be clearly labelled "SwiftShader".

**Screenshot mode** (implemented, `src/core/screenshotMode.ts`): `/?shot=1&frames=N&cam=<bookmark>&sunAz=<deg>&sunEl=<deg>` gives a fixed DPR of 1, a fixed sun, no wall-clock animation, renders N frames, then sets `window.__MM_READY__ = true` and `<body data-ready="1">`. Two runs gave byte-identical PNGs (MD5-verified).

**Profiles** (`playwright.config.ts`): `desktop` 1920×1080 DPR 1 and `ipad` 1180×820 DPR 1 with touch and an iPad Safari user agent. Chromium only; there is no WebKit browser in this container, so real iPad Safari behaviour has to be checked on a device.

## Network (outbound HTTPS through the session's egress proxy)

The session started on your shared **Default** environment, which blocked most hosts this project needs. With your approval I created a personal environment **`modulo-mountain`** and later added four hosts. Result:

| Host                                                                                                                                                        | Default env    | `modulo-mountain` env                                                            | Used for                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| github.com (this repo), api.github.com, raw.githubusercontent.com                                                                                           | OK             | OK                                                                               | git, CI status, reading source/spec files           |
| registry.npmjs.org, pypi.org                                                                                                                                | OK             | OK                                                                               | packages                                            |
| data.geo.admin.ch (swisstopo STAC + downloads)                                                                                                              | OK             | OK                                                                               | **swissALTI3D**                                     |
| ogd.swisstopo.admin.ch                                                                                                                                      | blocked        | blocked (not requested; not needed — STAC on data.geo.admin.ch serves the files) | —                                                   |
| www.swisstopo.admin.ch                                                                                                                                      | blocked        | OK (curl; WebFetch can't resolve it)                                             | product docs, terms of use                          |
| s3.amazonaws.com (`elevation-tiles-prod` Terrarium)                                                                                                         | OK             | OK                                                                               | comparison data                                     |
| copernicus-dem-30m.s3.amazonaws.com                                                                                                                         | OK             | OK                                                                               | **Copernicus GLO-30**                               |
| ambientcg.com (API)                                                                                                                                         | blocked        | OK                                                                               | Phase 2 textures                                    |
| api.polyhaven.com                                                                                                                                           | blocked        | OK                                                                               | Phase 2 lab candidates                              |
| opentopography.org, portal.opentopography.org                                                                                                               | blocked        | blocked (not requested)                                                          | not needed                                          |
| spacedata.copernicus.eu                                                                                                                                     | blocked        | allowed, but the site resets the connection                                      | —                                                   |
| dataspace.copernicus.eu, documentation.dataspace.copernicus.eu                                                                                              | blocked        | OK                                                                               | Copernicus DEM licence                              |
| fonts.googleapis.com                                                                                                                                        | OK             | OK (re-tested; not on the list, so allowed by a default rule)                    | not needed so far                                   |
| vercel.com, api.vercel.com                                                                                                                                  | OK             | OK                                                                               | docs; no token                                      |
| threejs.org, developer.mozilla.org, webkit.org, www.khronos.org, cesium.com, docs.mapbox.com, caniuse.com, en.wikipedia.org, jcgt.org, developer.nvidia.com | mostly blocked | OK                                                                               | research citations                                  |
| cdn.jsdelivr.net, unpkg.com, freesound.org, pixabay.com, polyhaven.com (site), deb.debian.org, playwright.azureedge.net, github.com (other repos)           | blocked        | blocked                                                                          | not needed yet; Freesound/Pixabay are Phase 3 audio |

Note: the `modulo-mountain` environment's setup script (installs `gdal-bin python3-gdal`) has not been exercised yet; it runs only when a fresh container is built for a new session.

## Data access verified with real downloads

| Source                                 | Test                                                                                                                       | Result                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| swissALTI3D (STAC)                     | Listed all items for the 16×16 km window; downloaded all 165 newest (2024) 2 m tiles (176 MB) and one 0.5 m tile (10.9 MB) | Summit tile maximum **4477.22 m** (2024) / 4477.39 m (2019) vs. published 4,478 m  |
| Copernicus GLO-30                      | Downloaded N45E007 and N46E007 COGs (42 MB each)                                                                           | Max near summit **4329.1 m** (~149 m low: a 30 m grid cuts off the sharp peak)     |
| AWS Terrain Tiles (Terrarium)          | z12–z15 over the summit                                                                                                    | Max **4354.5 m**; source header `eudem/eudem_dem_5deg_n45e005.tif` (EU-DEM, ~30 m) |
| swissALTIRegio 10 m (STAC, single COG) | Read a 72×64 km window directly from the remote COG with GDAL `/vsicurl/` (28 s, no full download)                         | Max near summit **4477.0 m**; window 100% valid including Italy                    |

GDAL's `/vsicurl/` needs `GDAL_HTTP_CAINFO=/root/.ccr/ca-bundle.crt` in this container (the proxy re-terminates TLS).

## Installed vs. not installed

Installed or available: Node toolchain, GDAL CLI + Python 3.12 bindings, ffmpeg, Playwright/Chromium, project npm deps.
Not available: `toktx` / KTX-Software (Phase 2), WebKit browser for Playwright, Vercel auth, a valid `gh` token.

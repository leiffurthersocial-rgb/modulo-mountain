# SETUP.md — reproduce the project

## 1. Prerequisites

- Node.js 22+ and npm 10+
- git
- For the elevation data pipeline (Phase 1 onward): GDAL 3.8+ with its Python bindings
  - Ubuntu/Debian: `sudo apt-get install -y gdal-bin python3-gdal python3-numpy`
  - macOS (Homebrew): `brew install gdal` (includes the Python bindings for Homebrew's Python)
- For Phase 2 textures: KTX-Software (`toktx`), from the KhronosGroup/KTX-Software GitHub releases page

## 2. Install and run

```bash
git clone https://github.com/leiffurthersocial-rgb/modulo-mountain.git
```

```bash
cd modulo-mountain && npm ci
```

```bash
npm run dev
```

Open http://localhost:5173. Screenshot mode: http://localhost:5173/?shot=1&frames=3&cam=overview

## 3. Checks

```bash
npm run ci
```

This runs, in order: typecheck (TypeScript strict), ESLint, Prettier check, Vitest unit tests, and the production build.

Playwright screenshot and smoke tests (they build and serve the app on port 4173):

```bash
npx playwright install chromium
```

```bash
npm run e2e
```

Screenshots are written to `test-results/shots/<profile>-<bookmark>.png` for the `desktop` (1920×1080) and `ipad` (1180×820) profiles. To use an existing Chromium instead of downloading one, set `PW_CHROMIUM_PATH=/path/to/chrome`.

## 4. Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: the `check` job (typecheck, lint, format, unit tests, build), then the `e2e` job (Playwright in headless Chromium with SwiftShader). Screenshots are uploaded as the `playwright-screenshots` artifact.

## 5. Deploying to Vercel (one-time setup, done by you)

This container has no Vercel credentials, so deployment uses Vercel's GitHub integration:

1. Sign in at vercel.com, choose **Add New → Project**, and import `leiffurthersocial-rgb/modulo-mountain`.
2. Framework preset: **Vite**. Build command `npm run build`, output directory `dist` (both are also set in `vercel.json`).
3. Deploy. From then on every push to a branch creates a preview deployment, and pushes to the production branch update production.
4. Phase 1 tile data: if tiles are stored with Git LFS (see PLAN.md, "Hosting"), enable **Settings → Git → Git LFS** in the Vercel project and redeploy.

`vercel.json` sets `Cache-Control: public, max-age=31536000, immutable` on `/assets/*` and `/tiles/*`, and `Content-Type: image/ktx2` on `*.ktx2`. Tile URLs must therefore be content-versioned (the manifest carries a dataset version in the path) so that long caching is safe.

Alternative with the CLI (needs your own token):

```bash
npx vercel@66.2.0 deploy --prod
```

## 6. Elevation data (Phase 1, after PLAN.md approval)

The data scripts are not written yet. Planned usage (details in PLAN.md):

```bash
npm run fetch-dem -- --preset matterhorn
```

```bash
npm run build-tiles -- --preset matterhorn
```

Downloads are cached in `.dem-cache/` (gitignored). Sources: swissALTI3D via the swisstopo STAC API (`data.geo.admin.ch`) and Copernicus GLO-30 from the public `copernicus-dem-30m` S3 bucket. Neither needs an account.

## 7. Cloud environment used by Claude

Claude's sessions for this repo run on the personal cloud environment `modulo-mountain`, which allows the data, texture and documentation hosts listed in ENVIRONMENT.md. Its setup script installs `gdal-bin python3-gdal`.

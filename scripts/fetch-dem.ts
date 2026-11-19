/**
 * Download and cache the elevation sources of a mountain preset into .dem-cache/.
 *
 *   npm run fetch-dem -- --preset matterhorn
 *
 * - swissALTI3D: STAC item search over the core square, newest edition per 1 km tile, 2 m COGs.
 * - swissALTIRegio: a window of the national 10 m COG (root square + margin) via GDAL /vsicurl/.
 * - Copernicus GLO-30: the 1°x1° COG tiles intersecting the root square.
 * Writes .dem-cache/<preset>/sources.json listing the local files per source.
 * Requests are sequential-ish (max 3 in flight) with retries; existing files are reused.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TransverseMercator } from '../src/geo/tmerc';
import { ROOT, argValue, loadPreset } from './lib/presets';

const UA = 'modulo-mountain-dem-fetch/1.0 (open-source terrain viewer; data pipeline)';
const sourcesCatalog = JSON.parse(
  readFileSync(resolve(ROOT, 'data/sources.json'), 'utf8'),
) as Record<string, Record<string, string | number>>;

const presetId = argValue('preset', 'matterhorn');
const preset = loadPreset(presetId);
const cacheDir = resolve(ROOT, '.dem-cache');
const tm = new TransverseMercator({ lat0: preset.origin.lat, lon0: preset.origin.lon });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRetry(url: string, init: RequestInit = {}, tries = 4): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
      });
      if (r.ok) return r;
      if (r.status === 404) throw new Error(`404 ${url}`);
      last = new Error(`HTTP ${r.status} ${url}`);
    } catch (e) {
      last = e;
      if (String(e).includes('404')) throw e;
    }
    await sleep(1000 * 2 ** i);
  }
  throw last;
}

async function download(url: string, dest: string): Promise<void> {
  if (existsSync(dest) && statSync(dest).size > 0) return;
  mkdirSync(dirname(dest), { recursive: true });
  const r = await fetchRetry(url);
  if (!r.body) throw new Error(`empty body ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(
    Readable.fromWeb(r.body as import('node:stream/web').ReadableStream),
    createWriteStream(tmp),
  );
  renameSync(tmp, dest);
}

async function pool<T>(
  items: T[],
  n: number,
  fn: (t: T, i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i] as T, i);
        await sleep(100); // be polite
      }
    }),
  );
}

/** WGS84 bbox [minLon, minLat, maxLon, maxLat] of a local square of half-size h (+ margin). */
function lonLatBox(h: number, margin = 500): [number, number, number, number] {
  const pts: [number, number][] = [];
  const s = h + margin;
  for (const x of [-s, 0, s]) for (const y of [-s, 0, s]) pts.push(tm.inverse(x, y));
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** LV95 bbox of a local square via gdaltransform (PROJ). */
function lv95Box(h: number, margin: number): [number, number, number, number] {
  const s = h + margin;
  const input: string[] = [];
  for (const x of [-s, 0, s])
    for (const y of [-s, 0, s]) {
      const [la, lo] = tm.inverse(x, y);
      input.push(`${lo} ${la}`);
    }
  const out = execFileSync('gdaltransform', ['-s_srs', 'EPSG:4326', '-t_srs', 'EPSG:2056'], {
    input: input.join('\n') + '\n',
  })
    .toString()
    .trim()
    .split('\n')
    .map((l) => l.split(/\s+/).map(Number));
  const es = out.map((p) => p[0] as number);
  const ns = out.map((p) => p[1] as number);
  const r = (v: number, f: (x: number) => number) => f(v / 100) * 100;
  return [
    r(Math.min(...es), Math.floor),
    r(Math.min(...ns), Math.floor),
    r(Math.max(...es), Math.ceil),
    r(Math.max(...ns), Math.ceil),
  ];
}

interface StacFeature {
  id: string;
  bbox: [number, number, number, number];
  assets: Record<string, { href: string }>;
}

async function fetchSwissAlti3d(): Promise<string[]> {
  const cat = sourcesCatalog['swissalti3d'] as Record<string, string>;
  const half = preset.extent.coreHalfSizeM;
  const [w, s, e, n] = lonLatBox(half, 200);
  let url: string | null = `${cat['stacCollection']}/items?bbox=${w},${s},${e},${n}&limit=100`;
  const newest = new Map<string, { year: number; href: string }>();
  while (url) {
    const page = (await (await fetchRetry(url)).json()) as {
      features: StacFeature[];
      links: { rel: string; href: string }[];
    };
    for (const f of page.features) {
      const [, yearStr, tile] = f.id.split('_');
      const year = Number(yearStr);
      const asset = Object.entries(f.assets).find(([k]) =>
        k.endsWith(cat['assetSuffix'] as string),
      );
      if (!tile || !asset) continue;
      const prev = newest.get(tile);
      if (!prev || prev.year < year) newest.set(tile, { year, href: asset[1].href });
    }
    url = page.links.find((l) => l.rel === 'next')?.href ?? null;
  }
  const items = [...newest.entries()].sort(([a], [b]) => a.localeCompare(b));
  console.log(`swissALTI3D: ${items.length} tiles (newest edition per tile)`);
  const files: string[] = [];
  let done = 0;
  await pool(items, 3, async ([tile, { year, href }]) => {
    const dest = resolve(cacheDir, 'swissalti3d', `${tile}_${year}_2m.tif`);
    await download(href, dest);
    files.push(dest);
    if (++done % 20 === 0) console.log(`  ${done}/${items.length}`);
  });
  return files.sort();
}

function fetchSwissAltiRegio(): string[] {
  const cat = sourcesCatalog['swissaltiregio'] as Record<string, string>;
  const [e0, n0, e1, n1] = lv95Box(preset.extent.rootSizeM / 2, 1000);
  const dest = resolve(cacheDir, presetId, `swissaltiregio_${e0}_${n0}_${e1}_${n1}.tif`);
  if (!existsSync(dest)) {
    mkdirSync(dirname(dest), { recursive: true });
    console.log(`swissALTIRegio: reading window LV95 ${e0},${n0} - ${e1},${n1} from remote COG`);
    execFileSync(
      'gdal_translate',
      [
        '-q',
        '-projwin',
        `${e0}`,
        `${n1}`,
        `${e1}`,
        `${n0}`,
        '-co',
        'COMPRESS=DEFLATE',
        '-co',
        'PREDICTOR=3',
        '-co',
        'TILED=YES',
        `/vsicurl/${cat['cogUrl']}`,
        dest,
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          GDAL_HTTP_USERAGENT: UA,
          GDAL_HTTP_CAINFO: process.env['GDAL_HTTP_CAINFO'] ?? process.env['SSL_CERT_FILE'] ?? '',
        },
      },
    );
  }
  return [dest];
}

async function fetchCopernicus(): Promise<string[]> {
  const cat = sourcesCatalog['copernicus-glo30'] as Record<string, string>;
  const [w, s, e, n] = lonLatBox(preset.extent.rootSizeM / 2, 1000);
  const files: string[] = [];
  const cells: [number, number][] = [];
  for (let lat = Math.floor(s); lat <= Math.floor(n); lat++)
    for (let lon = Math.floor(w); lon <= Math.floor(e); lon++) cells.push([lat, lon]);
  await pool(cells, 2, async ([lat, lon]) => {
    const ns = `${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}_00`;
    const ew = `${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}_00`;
    const name = `Copernicus_DSM_COG_10_${ns}_${ew}_DEM`;
    const dest = resolve(cacheDir, 'copernicus', `${name}.tif`);
    try {
      await download(`${cat['bucketUrl']}${name}/${name}.tif`, dest);
      files.push(dest);
    } catch (err) {
      if (String(err).includes('404'))
        console.log(`  Copernicus ${name}: not available (ocean or unreleased)`);
      else throw err;
    }
  });
  console.log(`Copernicus GLO-30: ${files.length} tiles`);
  return files.sort();
}

async function main(): Promise<void> {
  const out: Record<string, string[]> = {};
  for (const src of preset.sources) {
    if (src.id === 'swissalti3d') out[src.id] = await fetchSwissAlti3d();
    else if (src.id === 'swissaltiregio') out[src.id] = fetchSwissAltiRegio();
    else if (src.id === 'copernicus-glo30') out[src.id] = await fetchCopernicus();
    else throw new Error(`No fetcher for source ${src.id}`);
  }
  const listing = resolve(cacheDir, presetId, 'sources.json');
  mkdirSync(dirname(listing), { recursive: true });
  writeFileSync(
    listing,
    JSON.stringify({ preset: presetId, fetchedAt: new Date().toISOString(), files: out }, null, 2),
  );
  console.log(`wrote ${listing}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

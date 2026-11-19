/** Mountain preset schema (data/mountains.json) with a dependency-free validator. */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Summit extends LatLon {
  name: string;
  elevationM: number;
  datum: string;
  toleranceM: number;
  searchRadiusM: number;
  /** Max horizontal distance (m) between the data's highest point and the published summit. */
  positionToleranceM: number;
  reference: string;
  note?: string;
}

export interface PresetSource {
  id: string;
  region: 'core' | 'all';
  priority: number;
  maxLevel: number;
  featherM?: number;
}

export interface Landmark extends LatLon {
  id: string;
  name: string;
  elevationM?: number;
  toleranceM?: number;
  searchRadiusM?: number;
  reference: string;
}

export type AltMode = 'asl' | 'agl';

export interface Bookmark extends LatLon {
  id: string;
  name: string;
  alt: number;
  altMode: AltMode;
  heading: number;
  pitch: number;
}

export interface MountainPreset {
  id: string;
  name: string;
  region: string;
  origin: LatLon;
  summit: Summit;
  extent: { rootSizeM: number; coreHalfSizeM: number };
  sources: PresetSource[];
  farFieldMaxLevel: number;
  tiles: { datasetVersion: string };
  landmarks: Landmark[];
  bookmarks: Bookmark[];
}

export interface PresetFile {
  default: string;
  presets: MountainPreset[];
}

class PresetError extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new PresetError(`${path}: expected object`);
  return v as Obj;
}
function str(o: Obj, k: string, path: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0)
    throw new PresetError(`${path}.${k}: expected non-empty string`);
  return v;
}
function num(o: Obj, k: string, path: string, min = -Infinity, max = Infinity): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new PresetError(`${path}.${k}: expected number in [${min}, ${max}]`);
  }
  return v;
}
function optNum(
  o: Obj,
  k: string,
  path: string,
  min = -Infinity,
  max = Infinity,
): number | undefined {
  return o[k] === undefined ? undefined : num(o, k, path, min, max);
}
function arr(o: Obj, k: string, path: string): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new PresetError(`${path}.${k}: expected array`);
  return v;
}
function latLon(o: Obj, path: string): LatLon {
  return { lat: num(o, 'lat', path, -90, 90), lon: num(o, 'lon', path, -180, 180) };
}

function parsePreset(v: unknown, path: string): MountainPreset {
  const o = obj(v, path);
  const id = str(o, 'id', path);
  if (!/^[a-z0-9-]+$/.test(id))
    throw new PresetError(`${path}.id: use lowercase letters, digits and dashes`);
  const s = obj(o['summit'], `${path}.summit`);
  const ext = obj(o['extent'], `${path}.extent`);
  const rootSizeM = num(ext, 'rootSizeM', `${path}.extent`, 1024, 1_048_576);
  if (!Number.isInteger(Math.log2(rootSizeM)))
    throw new PresetError(`${path}.extent.rootSizeM: must be a power of two`);
  const coreHalfSizeM = num(ext, 'coreHalfSizeM', `${path}.extent`, 256, rootSizeM / 2);
  const sources = arr(o, 'sources', path).map((sv, i) => {
    const p = `${path}.sources[${i}]`;
    const so = obj(sv, p);
    const region = str(so, 'region', p);
    if (region !== 'core' && region !== 'all') throw new PresetError(`${p}.region: core|all`);
    const featherM = optNum(so, 'featherM', p, 0, 5000);
    return {
      id: str(so, 'id', p),
      region,
      priority: num(so, 'priority', p, 1, 100),
      maxLevel: num(so, 'maxLevel', p, 0, 12),
      ...(featherM !== undefined ? { featherM } : {}),
    } satisfies PresetSource;
  });
  if (sources.length === 0) throw new PresetError(`${path}.sources: at least one source`);
  const landmarks = arr(o, 'landmarks', path).map((lv, i) => {
    const p = `${path}.landmarks[${i}]`;
    const lo = obj(lv, p);
    const elevationM = optNum(lo, 'elevationM', p, -500, 9000);
    const toleranceM = optNum(lo, 'toleranceM', p, 0, 1000);
    const searchRadiusM = optNum(lo, 'searchRadiusM', p, 0, 1000);
    return {
      id: str(lo, 'id', p),
      name: str(lo, 'name', p),
      ...latLon(lo, p),
      reference: str(lo, 'reference', p),
      ...(elevationM !== undefined ? { elevationM } : {}),
      ...(toleranceM !== undefined ? { toleranceM } : {}),
      ...(searchRadiusM !== undefined ? { searchRadiusM } : {}),
    } satisfies Landmark;
  });
  const bookmarks = arr(o, 'bookmarks', path).map((bv, i) => {
    const p = `${path}.bookmarks[${i}]`;
    const bo = obj(bv, p);
    const altMode = str(bo, 'altMode', p);
    if (altMode !== 'asl' && altMode !== 'agl') throw new PresetError(`${p}.altMode: asl|agl`);
    return {
      id: str(bo, 'id', p),
      name: str(bo, 'name', p),
      ...latLon(bo, p),
      alt: num(bo, 'alt', p, -500, 30000),
      altMode,
      heading: num(bo, 'heading', p, -360, 360),
      pitch: num(bo, 'pitch', p, -90, 90),
    } satisfies Bookmark;
  });
  const ids = new Set<string>();
  for (const b of bookmarks) {
    if (ids.has(b.id)) throw new PresetError(`${path}: duplicate bookmark ${b.id}`);
    ids.add(b.id);
  }
  const tiles = obj(o['tiles'], `${path}.tiles`);
  const note = s['note'];
  return {
    id,
    name: str(o, 'name', path),
    region: str(o, 'region', path),
    origin: latLon(obj(o['origin'], `${path}.origin`), `${path}.origin`),
    summit: {
      name: str(s, 'name', `${path}.summit`),
      ...latLon(s, `${path}.summit`),
      elevationM: num(s, 'elevationM', `${path}.summit`, -500, 9000),
      datum: str(s, 'datum', `${path}.summit`),
      toleranceM: num(s, 'toleranceM', `${path}.summit`, 0, 1000),
      searchRadiusM: num(s, 'searchRadiusM', `${path}.summit`, 0, 1000),
      positionToleranceM: optNum(s, 'positionToleranceM', `${path}.summit`, 0, 1000) ?? 25,
      reference: str(s, 'reference', `${path}.summit`),
      ...(typeof note === 'string' ? { note } : {}),
    },
    extent: { rootSizeM, coreHalfSizeM },
    sources,
    farFieldMaxLevel: num(o, 'farFieldMaxLevel', path, 0, 12),
    tiles: { datasetVersion: str(tiles, 'datasetVersion', `${path}.tiles`) },
    landmarks,
    bookmarks,
  };
}

export function parsePresetFile(v: unknown): PresetFile {
  const o = obj(v, 'mountains.json');
  const presets = arr(o, 'presets', 'mountains.json').map((p, i) =>
    parsePreset(p, `presets[${i}]`),
  );
  const def = str(o, 'default', 'mountains.json');
  if (!presets.some((p) => p.id === def))
    throw new PresetError(`default preset "${def}" not found`);
  const seen = new Set<string>();
  for (const p of presets) {
    if (seen.has(p.id)) throw new PresetError(`duplicate preset id ${p.id}`);
    seen.add(p.id);
  }
  return { default: def, presets };
}

export function presetMaxLevel(p: MountainPreset): number {
  return Math.max(p.farFieldMaxLevel, ...p.sources.map((s) => s.maxLevel));
}

export function tileBaseUrl(base: string, p: MountainPreset): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}${p.id}/${p.tiles.datasetVersion}/`;
}

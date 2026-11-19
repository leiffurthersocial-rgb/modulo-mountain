import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parsePresetFile, type MountainPreset } from '../../src/config/presets';
import { decodePlanes, MMH_HEADER_BYTES, readMmhHeader, type MmhTile } from '../../src/terrain/mmh';
import { TileIndex, type TileManifest } from '../../src/terrain/manifest';
import type { TileProvider } from '../../src/terrain/heightSampler';
import { type TileId, tileKey, tilePath } from '../../src/terrain/tileMath';

export const ROOT = resolve(import.meta.dirname, '..', '..');

export function presets(): MountainPreset[] {
  return parsePresetFile(JSON.parse(readFileSync(resolve(ROOT, 'data/mountains.json'), 'utf8')))
    .presets;
}

export function tileDir(p: MountainPreset): string {
  return resolve(ROOT, 'public/tiles', p.id, p.tiles.datasetVersion);
}

export function hasTiles(p: MountainPreset): boolean {
  const m = resolve(tileDir(p), 'manifest.json');
  if (!existsSync(m)) return false;
  // Git LFS pointer files (no `git lfs pull`) start with "version https://git-lfs"
  const anyTile = resolve(tileDir(p), '0/0/0.mmh');
  return (
    existsSync(anyTile) && !readFileSync(anyTile).subarray(0, 7).toString().startsWith('version')
  );
}

export function loadManifest(p: MountainPreset): TileManifest {
  return JSON.parse(readFileSync(resolve(tileDir(p), 'manifest.json'), 'utf8')) as TileManifest;
}

/** Synchronous decode with node:zlib (the browser uses DecompressionStream). */
export function decodeFile(buf: Buffer): MmhTile {
  const ab = new Uint8Array(buf).buffer as ArrayBuffer;
  const h = readMmhHeader(ab);
  let payload: Uint8Array = new Uint8Array(ab, MMH_HEADER_BYTES, h.payloadBytes);
  if (h.gzip) payload = gunzipSync(payload);
  return {
    samples: h.samples,
    minHeight: h.minHeight,
    step: h.step,
    q: decodePlanes(payload, h.samples),
  };
}

export class DiskTiles implements TileProvider {
  private cache = new Map<string, MmhTile | null>();
  readonly index: TileIndex;
  constructor(private readonly preset: MountainPreset) {
    this.index = new TileIndex(loadManifest(preset));
  }
  get(id: TileId): MmhTile | undefined {
    const k = tileKey(id);
    if (!this.cache.has(k)) {
      this.cache.set(
        k,
        this.index.has(id)
          ? decodeFile(readFileSync(resolve(tileDir(this.preset), tilePath(id))))
          : null,
      );
    }
    return this.cache.get(k) ?? undefined;
  }
}

/** Tile manifest written by scripts/pipeline/build_tiles.py. */
import { type TileId, tileKey } from './tileMath';

export interface ManifestSource {
  id: string;
  bit: number;
  maxLevel: number;
  region: 'core' | 'all';
  verticalDatum: string;
  nativeResolutionM: number;
}

/** [tx, ty, minHeight, maxHeight, sourceMask] */
export type ManifestTile = [number, number, number, number, number];

export interface ManifestLevel {
  level: number;
  spacingM: number;
  tileSizeM: number;
  tiles: ManifestTile[];
}

export interface TileManifest {
  format: 'mmh1';
  preset: string;
  datasetVersion: string;
  generatedAt: string;
  frame: { proj: string; lat0: number; lon0: number; k0: number };
  rootSizeM: number;
  coreHalfSizeM: number;
  tileCells: number;
  apron: number;
  farFieldMaxLevel: number;
  maxLevel: number;
  sources: ManifestSource[];
  summit: { maxHeightM: number; x: number; y: number; referenceM: number; gridSpacingM: number };
  stats: { tiles: number; bytes: number };
  levels: ManifestLevel[];
}

export interface TileInfo {
  id: TileId;
  minH: number;
  maxH: number;
  sourceMask: number;
}

/** Indexed view of a manifest: O(1) tile lookup by key. */
export class TileIndex {
  readonly tiles = new Map<string, TileInfo>();
  constructor(readonly manifest: TileManifest) {
    if (manifest.format !== 'mmh1') throw new Error(`unsupported tile format ${manifest.format}`);
    for (const lvl of manifest.levels) {
      for (const [tx, ty, minH, maxH, sourceMask] of lvl.tiles) {
        const id = { level: lvl.level, tx, ty };
        this.tiles.set(tileKey(id), { id, minH, maxH, sourceMask });
      }
    }
  }
  get(id: TileId): TileInfo | undefined {
    return this.tiles.get(tileKey(id));
  }
  has(id: TileId): boolean {
    return this.tiles.has(tileKey(id));
  }
}

/**
 * Tile pyramid geometry. Local frame: x = metres east, y = metres north (pipeline space),
 * origin at the preset origin. The root tile is a square of `rootSizeM` centred on the origin.
 *
 * Level L has 2^L x 2^L tiles of `TILE_CELLS` cells each. Samples sit on cell corners, so a tile
 * has TILE_CELLS + 1 samples per side, shared with its neighbours, plus an `APRON` of one extra
 * sample on every side (for normals) => TILE_SAMPLES = 259.
 * Tile (tx, ty): tx counts eastwards from the west edge, ty northwards from the south edge.
 * Inside a tile file, sample (i, j) is at x = x0 + (i - APRON) * spacing, y = y0 + (j - APRON) * spacing
 * with j = 0 the southern row.
 */
export const TILE_CELLS = 256;
export const APRON = 1;
export const TILE_SAMPLES = TILE_CELLS + 1 + 2 * APRON;

export interface TileId {
  level: number;
  tx: number;
  ty: number;
}

export interface TileBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
  spacing: number;
}

export function tileSize(rootSizeM: number, level: number): number {
  return rootSizeM / 2 ** level;
}

export function levelSpacing(rootSizeM: number, level: number): number {
  return tileSize(rootSizeM, level) / TILE_CELLS;
}

export function tileBounds(rootSizeM: number, t: TileId): TileBounds {
  const size = tileSize(rootSizeM, t.level);
  const x0 = -rootSizeM / 2 + t.tx * size;
  const y0 = -rootSizeM / 2 + t.ty * size;
  return { x0, y0, x1: x0 + size, y1: y0 + size, size, spacing: size / TILE_CELLS };
}

/** Tile containing the local point (x, y) at a level; null outside the root. */
export function tileAt(rootSizeM: number, level: number, x: number, y: number): TileId | null {
  const size = tileSize(rootSizeM, level);
  const n = 2 ** level;
  const fx = (x + rootSizeM / 2) / size;
  const fy = (y + rootSizeM / 2) / size;
  if (fx < 0 || fy < 0 || fx > n || fy > n) return null;
  return { level, tx: Math.min(n - 1, Math.floor(fx)), ty: Math.min(n - 1, Math.floor(fy)) };
}

export function parentOf(t: TileId): TileId | null {
  if (t.level === 0) return null;
  return { level: t.level - 1, tx: t.tx >> 1, ty: t.ty >> 1 };
}

export function childrenOf(t: TileId): TileId[] {
  const l = t.level + 1;
  const x = t.tx * 2;
  const y = t.ty * 2;
  return [
    { level: l, tx: x, ty: y },
    { level: l, tx: x + 1, ty: y },
    { level: l, tx: x, ty: y + 1 },
    { level: l, tx: x + 1, ty: y + 1 },
  ];
}

export function tileKey(t: TileId): string {
  return `${t.level}/${t.tx}/${t.ty}`;
}

export function parseTileKey(k: string): TileId {
  const [l, x, y] = k.split('/').map(Number);
  if (l === undefined || x === undefined || y === undefined || [l, x, y].some(Number.isNaN)) {
    throw new Error(`bad tile key ${k}`);
  }
  return { level: l, tx: x, ty: y };
}

export function tilePath(t: TileId): string {
  return `${t.level}/${t.tx}/${t.ty}.mmh`;
}

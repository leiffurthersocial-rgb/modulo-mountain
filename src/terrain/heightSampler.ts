import type { MmhTile } from './mmh';
import { APRON, TILE_CELLS, type TileId, tileAt, tileBounds } from './tileMath';

/** Source of decoded tiles (in-game: the GPU tile cache; tests: files on disk). */
export interface TileProvider {
  /** Decoded tile if resident, else undefined. */
  get(id: TileId): MmhTile | undefined;
}

export interface HeightSample {
  height: number;
  level: number;
}

/**
 * CPU height queries at any local (x = east, y = north): bilinear interpolation in the finest
 * resident tile. This is the hook used by terrain clearance, the HUD and (later) walking.
 */
export class HeightSampler {
  constructor(
    private readonly rootSizeM: number,
    private readonly maxLevel: number,
    private readonly provider: TileProvider,
  ) {}

  sample(x: number, y: number, maxLevel = this.maxLevel): HeightSample | null {
    for (let level = maxLevel; level >= 0; level--) {
      const id = tileAt(this.rootSizeM, level, x, y);
      if (!id) return null;
      const t = this.provider.get(id);
      if (t) return { height: bilinear(t, this.rootSizeM, id, x, y), level };
    }
    return null;
  }

  height(x: number, y: number): number | null {
    return this.sample(x, y)?.height ?? null;
  }

  /** Unit surface normal [east, north, up] from central differences at the given spacing. */
  normal(x: number, y: number, d = 2): [number, number, number] | null {
    const hx0 = this.height(x - d, y);
    const hx1 = this.height(x + d, y);
    const hy0 = this.height(x, y - d);
    const hy1 = this.height(x, y + d);
    if (hx0 === null || hx1 === null || hy0 === null || hy1 === null) return null;
    const nx = -(hx1 - hx0) / (2 * d);
    const ny = -(hy1 - hy0) / (2 * d);
    const l = Math.hypot(nx, ny, 1);
    return [nx / l, ny / l, 1 / l];
  }
}

export function bilinear(t: MmhTile, rootSizeM: number, id: TileId, x: number, y: number): number {
  const b = tileBounds(rootSizeM, id);
  const fx = Math.min(TILE_CELLS, Math.max(0, (x - b.x0) / b.spacing)) + APRON;
  const fy = Math.min(TILE_CELLS, Math.max(0, (y - b.y0) / b.spacing)) + APRON;
  const i = Math.min(Math.floor(fx), t.samples - 2);
  const j = Math.min(Math.floor(fy), t.samples - 2);
  const u = fx - i;
  const v = fy - j;
  const s = t.samples;
  const q00 = t.q[j * s + i] as number;
  const q10 = t.q[j * s + i + 1] as number;
  const q01 = t.q[(j + 1) * s + i] as number;
  const q11 = t.q[(j + 1) * s + i + 1] as number;
  const q = (q00 * (1 - u) + q10 * u) * (1 - v) + (q01 * (1 - u) + q11 * u) * v;
  return t.minHeight + q * t.step;
}

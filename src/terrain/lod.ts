/**
 * CDLOD-style quadtree selection (Strugar 2010) over *render nodes*.
 *
 * A render node at level r covers rootSize / 2^r metres and is drawn as a fixed GRID x GRID quad
 * mesh. Its heights come from data tile level d = max(0, r - 2): a 256-cell data tile is drawn
 * as 4x4 render nodes of 64 quads, so the mesh spacing equals the data spacing (no aliasing).
 * Nodes are refined by 3D distance; each node morphs towards its parent's grid between
 * morphStart and morphEnd so neighbouring levels meet without cracks or popping. Heights at the
 * morph target come from the parent data tile, so the morphed surface matches the coarser node.
 */
import { APRON, TILE_CELLS, type TileId } from './tileMath';

export const GRID = 64;

export interface RenderNode {
  r: number;
  nx: number;
  ny: number;
}

export interface NodeDraw {
  node: RenderNode;
  x0: number;
  y0: number;
  size: number;
  data: TileId;
  /** Texel coordinate of the node's SW corner in its data tile (includes the apron). */
  offX: number;
  offY: number;
  /** Texels per mesh quad. */
  step: number;
  parent: TileId;
  pOffX: number;
  pOffY: number;
  pStep: number;
  morphStart: number;
  morphEnd: number;
}

export type TileStatus = 'resident' | 'loading' | 'absent';

export interface LodParams {
  rootSizeM: number;
  /** Deepest data level available anywhere. */
  maxDataLevel: number;
  /** range(r) = lodFactor * nodeSize(r). Larger = more detail. */
  lodFactor: number;
  /** Morph starts at this fraction of the range. */
  morphStartRatio: number;
}

export interface LodContext {
  camX: number;
  camY: number;
  camZ: number;
  /** min/max terrain height for a data tile (manifest), for bounding boxes. */
  tileHeights(id: TileId): [number, number] | undefined;
  /** Is the data tile resident / loading / not in the dataset? */
  status(id: TileId): TileStatus;
  /** Ask for a data tile to be loaded (priority: lower = sooner). */
  request(id: TileId, priority: number): void;
  /** Frustum test on an axis-aligned box in local coordinates (x east, y north, z up). */
  visible(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ): boolean;
}

export function dataTileFor(n: RenderNode): {
  data: TileId;
  offX: number;
  offY: number;
  step: number;
} {
  const d = Math.max(0, n.r - 2);
  const k = n.r - d; // 0, 1 or 2 render levels below the data tile
  const per = 1 << k;
  const nodeTexels = TILE_CELLS / per;
  return {
    data: { level: d, tx: n.nx >> k, ty: n.ny >> k },
    offX: APRON + (n.nx & (per - 1)) * nodeTexels,
    offY: APRON + (n.ny & (per - 1)) * nodeTexels,
    step: nodeTexels / GRID,
  };
}

export function parentDataFor(n: RenderNode): {
  parent: TileId;
  pOffX: number;
  pOffY: number;
  pStep: number;
} {
  const own = dataTileFor(n);
  if (own.data.level === 0)
    return { parent: own.data, pOffX: own.offX, pOffY: own.offY, pStep: own.step };
  const half = TILE_CELLS / 2;
  return {
    parent: { level: own.data.level - 1, tx: own.data.tx >> 1, ty: own.data.ty >> 1 },
    pOffX: APRON + (own.data.tx & 1) * half + (own.offX - APRON) / 2,
    pOffY: APRON + (own.data.ty & 1) * half + (own.offY - APRON) / 2,
    pStep: own.step / 2,
  };
}

export function lodRange(p: LodParams, r: number): number {
  return (p.lodFactor * p.rootSizeM) / 2 ** r;
}

function boxDistance(
  c: LodContext,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): number {
  const dx = Math.max(x0 - c.camX, 0, c.camX - x1);
  const dy = Math.max(y0 - c.camY, 0, c.camY - y1);
  const dz = Math.max(z0 - c.camZ, 0, c.camZ - z1);
  return Math.hypot(dx, dy, dz);
}

export interface SelectionStats {
  visited: number;
  culled: number;
  waiting: number;
}

/** Select the render nodes to draw this frame. */
export function selectNodes(
  p: LodParams,
  c: LodContext,
  out: NodeDraw[] = [],
): { draws: NodeDraw[]; stats: SelectionStats } {
  out.length = 0;
  const stats: SelectionStats = { visited: 0, culled: 0, waiting: 0 };
  const maxR = p.maxDataLevel + 2;
  const half = p.rootSizeM / 2;

  const visit = (n: RenderNode): void => {
    stats.visited++;
    const size = p.rootSizeM / 2 ** n.r;
    const x0 = -half + n.nx * size;
    const y0 = -half + n.ny * size;
    const own = dataTileFor(n);
    const hz = c.tileHeights(own.data) ?? [0, 9000];
    const zPad = 2; // skirts / rounding
    if (!c.visible(x0, y0, hz[0] - zPad, x0 + size, y0 + size, hz[1] + zPad)) {
      stats.culled++;
      return;
    }
    const dist = boxDistance(c, x0, y0, hz[0], x0 + size, y0 + size, hz[1]);
    if (n.r < maxR && dist < lodRange(p, n.r + 1)) {
      const child: RenderNode = { r: n.r + 1, nx: n.nx * 2, ny: n.ny * 2 };
      const childData = dataTileFor(child).data; // all four children share one data tile
      const st = c.status(childData);
      if (st === 'resident') {
        for (const [ox, oy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          visit({ r: n.r + 1, nx: n.nx * 2 + ox, ny: n.ny * 2 + oy });
        }
        return;
      }
      if (st === 'loading') {
        c.request(childData, childData.level * 1e6 + dist);
        stats.waiting++;
      }
    }
    const range = lodRange(p, n.r);
    out.push({
      node: n,
      x0,
      y0,
      size,
      ...own,
      ...parentDataFor(n),
      morphStart: range * p.morphStartRatio,
      morphEnd: range,
    });
  };

  visit({ r: 0, nx: 0, ny: 0 });
  return { draws: out, stats };
}

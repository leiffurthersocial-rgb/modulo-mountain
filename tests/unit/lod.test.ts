import { describe, expect, it } from 'vitest';
import {
  dataTileFor,
  GRID,
  type LodContext,
  parentDataFor,
  selectNodes,
} from '../../src/terrain/lod';
import { APRON, TILE_CELLS, type TileId } from '../../src/terrain/tileMath';

const R = 65536;
const params = { rootSizeM: R, maxDataLevel: 7, lodFactor: 2.5, morphStartRatio: 0.7 };

function ctx(
  cam: [number, number, number],
  resident: (t: TileId) => boolean,
): LodContext & { requests: TileId[] } {
  const requests: TileId[] = [];
  return {
    camX: cam[0],
    camY: cam[1],
    camZ: cam[2],
    requests,
    tileHeights: () => [1500, 4500],
    status: (t) => (resident(t) ? 'resident' : t.level <= 7 ? 'loading' : 'absent'),
    request: (t) => requests.push(t),
    visible: () => true,
  };
}

describe('CDLOD selection', () => {
  it('drawn nodes tile the root exactly (no gaps, no overlaps)', () => {
    const { draws } = selectNodes(
      params,
      ctx([100, -200, 4600], () => true),
    );
    const area = draws.reduce((a, d) => a + d.size * d.size, 0);
    expect(area).toBeCloseTo(R * R, -3);
    // pairwise overlap check
    for (let i = 0; i < draws.length; i++)
      for (let j = i + 1; j < draws.length; j++) {
        const a = draws[i]!;
        const b = draws[j]!;
        const ox = Math.min(a.x0 + a.size, b.x0 + b.size) - Math.max(a.x0, b.x0);
        const oy = Math.min(a.y0 + a.size, b.y0 + b.size) - Math.max(a.y0, b.y0);
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
  });

  it('refines to the finest level near the camera and stays coarse far away', () => {
    const { draws } = selectNodes(
      params,
      ctx([0, 0, 4480], () => true),
    );
    const near = draws.find(
      (d) => d.x0 <= 0 && d.y0 <= 0 && d.x0 + d.size > 0 && d.y0 + d.size > 0,
    )!;
    expect(near.node.r).toBe(9);
    const far = draws.find((d) => d.x0 <= -30000 && d.y0 <= -30000)!;
    expect(far.node.r).toBeLessThan(5);
  });

  it('does not refine into tiles that are not resident, and requests them', () => {
    const c = ctx([0, 0, 4480], (t) => t.level <= 3);
    const { draws } = selectNodes(params, c);
    expect(Math.max(...draws.map((d) => d.node.r))).toBe(5); // data level 3 -> render level 5
    expect(c.requests.some((t) => t.level === 4)).toBe(true);
  });

  it('maps render nodes to data texels with matching spacing', () => {
    const d = dataTileFor({ r: 9, nx: 300, ny: 257 });
    expect(d.data).toEqual({ level: 7, tx: 75, ty: 64 });
    expect(d.step).toBe(1);
    expect(d.offX).toBe(APRON + 0 * 64);
    expect(d.offY).toBe(APRON + 1 * 64);
    const top = dataTileFor({ r: 0, nx: 0, ny: 0 });
    expect(top.step * GRID).toBe(TILE_CELLS);
    const p = parentDataFor({ r: 9, nx: 300, ny: 257 });
    expect(p.parent).toEqual({ level: 6, tx: 37, ty: 32 });
    expect(p.pStep).toBe(0.5);
    // even mesh vertices land on integer parent texels
    expect(Number.isInteger(p.pOffX) && Number.isInteger(p.pOffY)).toBe(true);
  });
});

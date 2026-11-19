import { describe, expect, it } from 'vitest';
import {
  childrenOf,
  levelSpacing,
  parentOf,
  parseTileKey,
  TILE_SAMPLES,
  tileAt,
  tileBounds,
  tileKey,
} from '../../src/terrain/tileMath';

const R = 65536;

describe('tile pyramid math', () => {
  it('has 259 samples per tile (256 cells + shared edge + 1-sample apron)', () => {
    expect(TILE_SAMPLES).toBe(259);
  });
  it('level spacings halve per level', () => {
    expect(levelSpacing(R, 0)).toBe(256);
    expect(levelSpacing(R, 7)).toBe(2);
  });
  it('root tile is centred on the origin', () => {
    expect(tileBounds(R, { level: 0, tx: 0, ty: 0 })).toMatchObject({
      x0: -32768,
      y0: -32768,
      x1: 32768,
      y1: 32768,
    });
  });
  it('tileAt / bounds round-trip and parent/children are consistent', () => {
    for (const [x, y] of [
      [0, 0],
      [-12345.6, 7000.1],
      [32767, -32767],
    ] as const) {
      for (let l = 0; l <= 8; l++) {
        const t = tileAt(R, l, x, y);
        expect(t).not.toBeNull();
        const b = tileBounds(R, t!);
        expect(x).toBeGreaterThanOrEqual(b.x0);
        expect(x).toBeLessThanOrEqual(b.x1);
        expect(y).toBeGreaterThanOrEqual(b.y0);
        if (l > 0) expect(parentOf(t!)).toEqual(tileAt(R, l - 1, x, y));
        expect(childrenOf(t!)).toContainEqual(tileAt(R, l + 1, x, y));
      }
    }
    expect(tileAt(R, 3, 40000, 0)).toBeNull();
  });
  it('keys round-trip', () => {
    const t = { level: 7, tx: 70, ty: 63 };
    expect(parseTileKey(tileKey(t))).toEqual(t);
  });
});

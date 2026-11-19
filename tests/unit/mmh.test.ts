import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  decodeMmh,
  encodeMmhRaw,
  encodePlanes,
  heightAt,
  MMH_HEADER_BYTES,
} from '../../src/terrain/mmh';
import { TILE_SAMPLES } from '../../src/terrain/tileMath';

function synthetic(): { q: Uint16Array; minHeight: number; step: number } {
  const s = TILE_SAMPLES;
  const q = new Uint16Array(s * s);
  for (let j = 0; j < s; j++)
    for (let i = 0; i < s; i++)
      q[j * s + i] = Math.round(
        30000 + 20000 * Math.sin(i / 17) * Math.cos(j / 23) + ((i * 7919 + j * 104729) % 97),
      );
  return { q, minHeight: 1234.5, step: 0.02 };
}

describe('.mmh codec', () => {
  it('round-trips an uncompressed tile exactly', async () => {
    const t = { samples: TILE_SAMPLES, ...synthetic() };
    const d = await decodeMmh(encodeMmhRaw(t));
    expect(d.samples).toBe(TILE_SAMPLES);
    expect(d.minHeight).toBe(1234.5);
    expect(d.step).toBe(0.02);
    expect(Array.from(d.q)).toEqual(Array.from(t.q));
    expect(heightAt(d, 0, 0)).toBeCloseTo(1234.5 + (t.q[0] as number) * 0.02, 6);
  });

  it('decodes gzip payloads (as written by the pipeline) via DecompressionStream', async () => {
    const t = { samples: TILE_SAMPLES, ...synthetic() };
    const raw = new Uint8Array(encodeMmhRaw(t));
    const gz = gzipSync(encodePlanes(t.q, TILE_SAMPLES));
    const buf = new Uint8Array(MMH_HEADER_BYTES + gz.length);
    buf.set(raw.subarray(0, MMH_HEADER_BYTES));
    const dv = new DataView(buf.buffer);
    dv.setUint16(6, 1, true);
    dv.setUint32(24, gz.length, true);
    buf.set(gz, MMH_HEADER_BYTES);
    const d = await decodeMmh(buf.buffer);
    expect(Array.from(d.q)).toEqual(Array.from(t.q));
  });

  it('rejects bad magic and truncated files', async () => {
    await expect(decodeMmh(new ArrayBuffer(10))).rejects.toThrow();
    const b = encodeMmhRaw({ samples: TILE_SAMPLES, ...synthetic() });
    new DataView(b).setUint32(0, 0, true);
    await expect(decodeMmh(b)).rejects.toThrow(/magic/);
  });
});

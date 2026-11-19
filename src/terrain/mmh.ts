/**
 * `.mmh` height tile format, version 1 (little-endian):
 *
 *   offset size  field
 *   0      4     magic "MMH1"
 *   4      2     uint16 samples per side (S)
 *   6      2     uint16 flags (bit 0: payload is gzip-compressed)
 *   8      8     float64 minHeight (m)
 *   16     8     float64 step (m per quantum)
 *   24     4     uint32 payload byte length
 *   28     4     uint32 reserved (0)
 *   32     ...   payload
 *
 * Payload (after gunzip): two byte planes of S*S bytes each (low bytes, then high bytes) of the
 * zig-zag encoded residuals r = q - p, where q = round((h - minHeight) / step) is a uint16 and
 * p is the planar predictor p = left + up - upLeft (first row: left; first column: up; corner: 0).
 * Rows are stored south to north, samples west to east.  h = minHeight + q * step.
 */
export const MMH_MAGIC = 0x31484d4d; // "MMH1" read as little-endian uint32
export const MMH_HEADER_BYTES = 32;

export interface MmhTile {
  samples: number;
  minHeight: number;
  step: number;
  /** Quantised heights, row-major, south row first. */
  q: Uint16Array;
}

export interface MmhHeader {
  samples: number;
  gzip: boolean;
  minHeight: number;
  step: number;
  payloadBytes: number;
}

export function readMmhHeader(buf: ArrayBuffer): MmhHeader {
  if (buf.byteLength < MMH_HEADER_BYTES) throw new Error('mmh: file too short');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MMH_MAGIC) throw new Error('mmh: bad magic');
  const samples = dv.getUint16(4, true);
  const flags = dv.getUint16(6, true);
  const payloadBytes = dv.getUint32(24, true);
  if (MMH_HEADER_BYTES + payloadBytes > buf.byteLength) throw new Error('mmh: truncated payload');
  return {
    samples,
    gzip: (flags & 1) === 1,
    minHeight: dv.getFloat64(8, true),
    step: dv.getFloat64(16, true),
    payloadBytes,
  };
}

/** Rebuild quantised heights from the (already decompressed) byte planes. */
export function decodePlanes(planes: Uint8Array, samples: number): Uint16Array {
  const count = samples * samples;
  if (planes.length !== count * 2) throw new Error(`mmh: expected ${count * 2} payload bytes`);
  const q = new Uint16Array(count);
  for (let j = 0; j < samples; j++) {
    const row = j * samples;
    for (let i = 0; i < samples; i++) {
      const k = row + i;
      const z = (planes[k] as number) | ((planes[count + k] as number) << 8);
      const r = (z >>> 1) ^ -(z & 1);
      let p: number;
      if (j === 0) p = i === 0 ? 0 : (q[k - 1] as number);
      else if (i === 0) p = q[k - samples] as number;
      else p = (q[k - 1] as number) + (q[k - samples] as number) - (q[k - samples - 1] as number);
      q[k] = p + r;
    }
  }
  return q;
}

/** Produce zig-zag residual byte planes (used by tests and procedural tiles). */
export function encodePlanes(q: Uint16Array, samples: number): Uint8Array {
  const count = samples * samples;
  const out = new Uint8Array(count * 2);
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const k = j * samples + i;
      let p: number;
      if (j === 0) p = i === 0 ? 0 : (q[k - 1] as number);
      else if (i === 0) p = q[k - samples] as number;
      else p = (q[k - 1] as number) + (q[k - samples] as number) - (q[k - samples - 1] as number);
      const r = (q[k] as number) - p;
      const z = ((r << 1) ^ (r >> 31)) >>> 0;
      if (z > 0xffff) throw new Error('mmh: residual overflow');
      out[k] = z & 0xff;
      out[count + k] = z >>> 8;
    }
  }
  return out;
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeMmh(buf: ArrayBuffer): Promise<MmhTile> {
  const h = readMmhHeader(buf);
  let payload: Uint8Array = new Uint8Array(buf, MMH_HEADER_BYTES, h.payloadBytes);
  if (h.gzip) payload = await gunzip(payload);
  return {
    samples: h.samples,
    minHeight: h.minHeight,
    step: h.step,
    q: decodePlanes(payload, h.samples),
  };
}

/** Uncompressed encoder (flags = 0); the data pipeline writes gzip payloads. */
export function encodeMmhRaw(tile: MmhTile): ArrayBuffer {
  const planes = encodePlanes(tile.q, tile.samples);
  const buf = new ArrayBuffer(MMH_HEADER_BYTES + planes.length);
  const dv = new DataView(buf);
  dv.setUint32(0, MMH_MAGIC, true);
  dv.setUint16(4, tile.samples, true);
  dv.setUint16(6, 0, true);
  dv.setFloat64(8, tile.minHeight, true);
  dv.setFloat64(16, tile.step, true);
  dv.setUint32(24, planes.length, true);
  new Uint8Array(buf, MMH_HEADER_BYTES).set(planes);
  return buf;
}

export function heightAt(tile: MmhTile, i: number, j: number): number {
  return tile.minHeight + (tile.q[j * tile.samples + i] as number) * tile.step;
}

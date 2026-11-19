"""Encoder for the .mmh height tile format (spec: src/terrain/mmh.ts)."""
import gzip
import struct

import numpy as np

MAGIC = b"MMH1"
MIN_STEP = 0.02  # metres; source accuracy is 1-3 m above 2,000 m (swisstopo), so 2 cm is lossless in practice


def zigzag_planes(q):
    """Planar predictor (left + up - upLeft) residuals, zig-zag encoded, split into byte planes."""
    qi = q.astype(np.int64)
    p = np.zeros_like(qi)
    p[1:, 1:] = qi[1:, :-1] + qi[:-1, 1:] - qi[:-1, :-1]
    p[0, 1:] = qi[0, :-1]
    p[1:, 0] = qi[:-1, 0]
    r = qi - p
    z = (r << 1) ^ (r >> 63)
    if z.max() > 0xFFFF or z.min() < 0:
        return None
    z = z.astype(np.uint16).ravel()
    return (z & 0xFF).astype(np.uint8).tobytes() + (z >> 8).astype(np.uint8).tobytes()


def encode_tile(h):
    """h: (S, S) float array, row 0 = south. Returns (bytes, min, max)."""
    s = h.shape[0]
    assert h.shape == (s, s)
    hmin = float(np.min(h))
    hmax = float(np.max(h))
    step = max(MIN_STEP, (hmax - hmin) / 65535.0)
    while True:
        q = np.round((h - hmin) / step)
        if q.max() <= 65535:
            planes = zigzag_planes(q.astype(np.int64))
            if planes is not None:
                break
        step *= 1.25  # extremely rough tiles: coarser quantum keeps residuals in 16 bits
    payload = gzip.compress(planes, compresslevel=9, mtime=0)
    header = MAGIC + struct.pack("<HHddII", s, 1, hmin, step, len(payload), 0)
    assert len(header) == 32
    return header + payload, hmin, hmax

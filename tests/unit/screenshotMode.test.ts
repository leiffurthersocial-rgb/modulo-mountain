import { describe, expect, it } from 'vitest';
import { parseScreenshotOptions, sunDirection } from '../../src/core/screenshotMode';

describe('parseScreenshotOptions', () => {
  it('is disabled by default with sane defaults', () => {
    const o = parseScreenshotOptions('');
    expect(o.enabled).toBe(false);
    expect(o.frames).toBe(3);
    expect(o.camera).toBeNull();
  });
  it('parses and clamps parameters', () => {
    const o = parseScreenshotOptions('?shot=1&frames=999&cam=summit&sunAz=90&sunEl=abc');
    expect(o.enabled).toBe(true);
    expect(o.frames).toBe(120);
    expect(o.camera).toBe('summit');
    expect(o.sunAzimuthDeg).toBe(90);
    expect(o.sunElevationDeg).toBe(35);
  });
});

describe('sunDirection', () => {
  it('returns unit vectors in the local east/up/north frame', () => {
    const [x, y, z] = sunDirection(90, 0); // due east on the horizon
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
    const [, upY] = sunDirection(0, 90);
    expect(upY).toBeCloseTo(1);
    const [, , nz] = sunDirection(0, 0); // due north => -Z
    expect(nz).toBeCloseTo(-1);
  });
});

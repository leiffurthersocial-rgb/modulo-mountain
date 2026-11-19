import { describe, expect, it } from 'vitest';
import { TransverseMercator } from '../../src/geo/tmerc';
import { geodesicInverse } from '../../src/geo/geodesic';
import ref from '../fixtures/proj-reference.json';

describe('TransverseMercator vs PROJ', () => {
  for (const c of ref.tmerc) {
    it(`${c.preset} (${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}) forward/inverse`, () => {
      const tm = new TransverseMercator({ lat0: c.lat0, lon0: c.lon0 });
      const [e, n] = tm.forward(c.lat, c.lon);
      expect(Math.abs(e - c.east)).toBeLessThan(1e-3); // < 1 mm
      expect(Math.abs(n - c.north)).toBeLessThan(1e-3);
      const [lat, lon] = tm.inverse(c.east, c.north);
      expect(Math.abs(lat - c.lat)).toBeLessThan(1e-9); // ~0.1 mm
      expect(Math.abs(lon - c.lon)).toBeLessThan(1e-9);
    });
  }

  it('local frame distances match geodesics within 0.01% inside +-32 km', () => {
    const tm = new TransverseMercator({ lat0: 45.97639, lon0: 7.65861 });
    for (const [e, n] of [
      [30000, 0],
      [0, 30000],
      [-25000, 20000],
    ] as const) {
      const [la, lo] = tm.inverse(e, n);
      const g = geodesicInverse(45.97639, 7.65861, la, lo).distanceM;
      expect(Math.abs(Math.hypot(e, n) - g) / g).toBeLessThan(1e-4);
    }
  });
});

describe('geodesicInverse vs PROJ geod', () => {
  for (const g of ref.geodesic) {
    it(`(${g.lat1}, ${g.lon1}) -> (${g.lat2}, ${g.lon2})`, () => {
      const r = geodesicInverse(g.lat1, g.lon1, g.lat2, g.lon2);
      expect(Math.abs(r.distanceM - g.distanceM)).toBeLessThan(1e-3);
      expect(Math.abs(r.azimuth1Deg - ((g.az1 + 360) % 360))).toBeLessThan(1e-6);
    });
  }
});

import { DEG, WGS84_A, WGS84_E2, WGS84_F } from './ellipsoid';

/**
 * Transverse Mercator on the WGS84 ellipsoid using the Krüger series to 6th order
 * (Karney 2011 coefficients; sub-millimetre within hundreds of km of the central meridian).
 *
 * The projection is centred on (lat0, lon0) with scale factor k0 and no false easting/northing,
 * so the origin maps to (0, 0). This is the local metric frame of each mountain preset:
 * E = metres east, N = metres north. Equivalent PROJ string:
 *   +proj=tmerc +lat_0=<lat0> +lon_0=<lon0> +k=<k0> +x_0=0 +y_0=0 +ellps=WGS84
 */
export interface TmercParams {
  lat0: number;
  lon0: number;
  k0?: number;
}

const n = WGS84_F / (2 - WGS84_F);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const n5 = n4 * n;
const n6 = n5 * n;
const A = (WGS84_A / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const E = Math.sqrt(WGS84_E2);

const ALPHA = [
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
  (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
  (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
  (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
  (212378941 * n6) / 319334400,
];
const BETA = [
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
  (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
  (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
  (4583 * n5) / 161280 - (108847 * n6) / 3991680,
  (20648693 * n6) / 638668800,
];

/** Unscaled (xi, eta) Gauss-Krüger coordinates, before multiplying by k0*A. */
function forwardXiEta(latRad: number, dLonRad: number): [number, number] {
  const s = Math.sin(latRad);
  const t = Math.sinh(Math.atanh(s) - E * Math.atanh(E * s));
  const xiP = Math.atan2(t, Math.cos(dLonRad));
  const etaP = Math.atanh(Math.sin(dLonRad) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 6; j++) {
    const a = ALPHA[j - 1] as number;
    xi += a * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += a * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  return [xi, eta];
}

export class TransverseMercator {
  readonly lat0: number;
  readonly lon0: number;
  readonly k0: number;
  private readonly n0: number;

  constructor(p: TmercParams) {
    this.lat0 = p.lat0;
    this.lon0 = p.lon0;
    this.k0 = p.k0 ?? 1;
    this.n0 = this.k0 * A * forwardXiEta(this.lat0 * DEG, 0)[0];
  }

  /** WGS84 degrees -> local metres [east, north]. */
  forward(latDeg: number, lonDeg: number): [number, number] {
    let dLon = lonDeg - this.lon0;
    dLon = ((((dLon + 180) % 360) + 360) % 360) - 180;
    const [xi, eta] = forwardXiEta(latDeg * DEG, dLon * DEG);
    return [this.k0 * A * eta, this.k0 * A * xi - this.n0];
  }

  /** Local metres [east, north] -> WGS84 degrees [lat, lon]. */
  inverse(east: number, north: number): [number, number] {
    const xi = (north + this.n0) / (this.k0 * A);
    const eta = east / (this.k0 * A);
    let xiP = xi;
    let etaP = eta;
    for (let j = 1; j <= 6; j++) {
      const b = BETA[j - 1] as number;
      xiP -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      etaP -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP)); // conformal latitude
    const dLon = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
    // conformal -> geodetic latitude (fixed-point iteration, converges in a few steps)
    let phi = chi;
    for (let i = 0; i < 12; i++) {
      const es = E * Math.sin(phi);
      const next =
        2 * Math.atan(Math.pow((1 + es) / (1 - es), E / 2) * Math.tan(Math.PI / 4 + chi / 2)) -
        Math.PI / 2;
      if (Math.abs(next - phi) < 1e-15) {
        phi = next;
        break;
      }
      phi = next;
    }
    return [phi / DEG, this.lon0 + dLon / DEG];
  }

  proj4(): string {
    return `+proj=tmerc +lat_0=${this.lat0} +lon_0=${this.lon0} +k=${this.k0} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
  }
}

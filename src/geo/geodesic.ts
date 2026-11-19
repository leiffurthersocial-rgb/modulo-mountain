import { DEG, WGS84_A, WGS84_B, WGS84_F } from './ellipsoid';

export interface GeodesicResult {
  distanceM: number;
  azimuth1Deg: number;
  azimuth2Deg: number;
}

/**
 * Vincenty's inverse formula on WGS84 (accurate to well below a millimetre for
 * non-antipodal points). Used as the ground truth for horizontal distances.
 */
export function geodesicInverse(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): GeodesicResult {
  const L = (lon2 - lon1) * DEG;
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(lat1 * DEG));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(lat2 * DEG));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cosSqAlpha = 1;
  let cos2SigmaM = 0;
  let sinLambda = 0;
  let cosLambda = 1;
  for (let iter = 0; iter < 200; iter++) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return { distanceM: 0, azimuth1Deg: 0, azimuth2Deg: 0 };
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha : 0;
    const C = (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) *
        WGS84_F *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - prev) < 1e-13) break;
  }
  const uSq = (cosSqAlpha * (WGS84_A ** 2 - WGS84_B ** 2)) / WGS84_B ** 2;
  const Acoef = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const Bcoef = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    Bcoef *
    sinSigma *
    (cos2SigmaM +
      (Bcoef / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (Bcoef / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  const s = WGS84_B * Acoef * (sigma - deltaSigma);
  const a1 = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
  const a2 = Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda);
  return {
    distanceM: s,
    azimuth1Deg: (((a1 / DEG) % 360) + 360) % 360,
    azimuth2Deg: (((a2 / DEG) % 360) + 360) % 360,
  };
}

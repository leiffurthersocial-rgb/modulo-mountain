/**
 * Deterministic "screenshot mode", driven by URL query parameters.
 *
 *   ?shot=1            enable (fixed DPR, no wall-clock animation, no HUD FPS)
 *   &frames=N          number of static frames to render before signalling ready (default 3)
 *   &cam=<bookmark>    camera bookmark id
 *   &sunAz=<deg>&sunEl=<deg>  fixed sun direction (defaults below)
 *
 * When the frames are rendered, `window.__MM_READY__` becomes true and
 * `<body data-ready="1">` is set, which Playwright waits for.
 */
export interface ScreenshotOptions {
  enabled: boolean;
  frames: number;
  camera: string | null;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
}

export const DEFAULT_SUN_AZIMUTH_DEG = 135; // from the south-east
export const DEFAULT_SUN_ELEVATION_DEG = 35;

function num(v: string | null, fallback: number, min: number, max: number): number {
  if (v === null || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseScreenshotOptions(search: string): ScreenshotOptions {
  const p = new URLSearchParams(search);
  const enabled = p.get('shot') === '1';
  return {
    enabled,
    frames: Math.round(num(p.get('frames'), 3, 1, 120)),
    camera: p.get('cam'),
    sunAzimuthDeg: num(p.get('sunAz'), DEFAULT_SUN_AZIMUTH_DEG, -360, 360),
    sunElevationDeg: num(p.get('sunEl'), DEFAULT_SUN_ELEVATION_DEG, -90, 90),
  };
}

/** Unit vector pointing TOWARDS the sun. Local frame: +X east, +Y up, -Z north. */
export function sunDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const h = Math.cos(el);
  return [h * Math.sin(az), Math.sin(el), -h * Math.cos(az)];
}

declare global {
  interface Window {
    __MM_READY__?: boolean;
  }
}

export function signalReady(): void {
  window.__MM_READY__ = true;
  document.body.dataset['ready'] = '1';
}

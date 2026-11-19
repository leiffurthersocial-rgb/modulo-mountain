import * as THREE from 'three';
import { createBackend } from './render/backend';
import { parseScreenshotOptions, signalReady, sunDirection } from './core/screenshotMode';

/**
 * STEP 0 hello-world: proves the Vite -> Three.js (WebGL2) -> Playwright -> Vercel pipeline.
 * A small greybox heightfield lit by a fixed sun; replaced by the real terrain engine in Phase 1.
 */
const shot = parseScreenshotOptions(window.location.search);
const canvas = document.querySelector<HTMLCanvasElement>('#view');
const hud = document.querySelector<HTMLDivElement>('#hud');
if (!canvas || !hud) throw new Error('Missing #view or #hud element');

const backend = createBackend({ canvas, preserveDrawingBuffer: shot.enabled });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c8);

// Greybox placeholder: 4 km x 4 km grid, simple deterministic bumps, 1 unit = 1 m.
const SIZE = 4000;
const SEG = 128;
const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes['position'] as THREE.BufferAttribute;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const z = pos.getZ(i);
  const r = Math.hypot(x, z) / (SIZE / 2);
  const peak = Math.max(0, 1 - r) ** 1.6 * 1200;
  const ripples = 40 * Math.sin(x / 170) * Math.cos(z / 230);
  pos.setY(i, peak + ripples);
}
geo.computeVertexNormals();
const mat = new THREE.MeshLambertMaterial({ color: 0xb8b8b8 });
scene.add(new THREE.Mesh(geo, mat));

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
const [sx, sy, sz] = sunDirection(shot.sunAzimuthDeg, shot.sunElevationDeg);
sun.position.set(sx, sy, sz);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x404040, 0.6));

const camera = new THREE.PerspectiveCamera(60, 1, 1, 50000);
type Bookmark = { pos: [number, number, number]; look: [number, number, number] };
const OVERVIEW: Bookmark = { pos: [3200, 1800, 3200], look: [0, 500, 0] };
const bookmarks: Record<string, Bookmark> = {
  overview: OVERVIEW,
  low: { pos: [1500, 300, -1800], look: [0, 900, 0] },
};
const bm = bookmarks[shot.camera ?? 'overview'] ?? OVERVIEW;
camera.position.set(...bm.pos);
camera.lookAt(...bm.look);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = shot.enabled ? 1 : Math.min(window.devicePixelRatio, 2);
  backend.resize(w, h, dpr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

hud.textContent = `Modulo: Mountain  (pipeline check)\nrenderer: ${backend.kind}`;

if (shot.enabled) {
  for (let i = 0; i < shot.frames; i++) backend.render(scene, camera);
  signalReady();
} else {
  const clock = new THREE.Clock();
  backend.renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    camera.position.set(Math.cos(t * 0.05) * 4500, 1800, Math.sin(t * 0.05) * 4500);
    camera.lookAt(0, 500, 0);
    backend.render(scene, camera);
  });
  signalReady();
}

import * as THREE from 'three';

/**
 * Renderer backend abstraction. Phase 1 ships WebGL2 only; the interface keeps
 * the door open for a WebGPU backend (three/webgpu) without touching callers.
 */
export type BackendKind = 'webgl2';

export interface RenderBackend {
  readonly kind: BackendKind;
  readonly renderer: THREE.WebGLRenderer;
  resize(width: number, height: number, pixelRatio: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  info(): { calls: number; triangles: number };
  dispose(): void;
}

export interface BackendOptions {
  canvas: HTMLCanvasElement;
  /** Needed for Playwright screenshots of a WebGL canvas. */
  preserveDrawingBuffer: boolean;
}

export function createBackend(opts: BackendOptions): RenderBackend {
  const gl = opts.canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: opts.preserveDrawingBuffer,
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, context: gl });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return {
    kind: 'webgl2',
    renderer,
    resize(width, height, pixelRatio) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
    },
    render(scene, camera) {
      renderer.render(scene, camera);
    },
    info() {
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    dispose() {
      renderer.dispose();
    },
  };
}

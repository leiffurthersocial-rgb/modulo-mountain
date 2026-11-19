import { defineConfig } from '@playwright/test';

/**
 * Two fixed profiles used for every screenshot:
 *  - desktop: 1920x1080, DPR 1
 *  - ipad:    1180x820 (iPad Air landscape CSS viewport), DPR 1 for deterministic pixels
 * Headless WebGL2 uses ANGLE + SwiftShader (software). It renders correctly but its
 * frame rate says nothing about real GPUs; performance is measured separately.
 */
const executablePath = process.env['PW_CHROMIUM_PATH'];
const gpuArgs = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    launchOptions: { args: gpuArgs, ...(executablePath ? { executablePath } : {}) },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'ipad',
      use: {
        browserName: 'chromium',
        viewport: { width: 1180, height: 820 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: false,
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      },
    },
  ],
});

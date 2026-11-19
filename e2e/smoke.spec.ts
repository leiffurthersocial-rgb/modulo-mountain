import { expect, test } from '@playwright/test';

const BOOKMARKS = ['overview', 'low'];

test.describe('hello-world pipeline', () => {
  for (const cam of BOOKMARKS) {
    test(`renders bookmark "${cam}" without console errors`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(`/?shot=1&frames=3&cam=${cam}`);
      await page.waitForFunction(() => window.__MM_READY__ === true);

      const webgl2 = await page.evaluate(
        () => !!document.createElement('canvas').getContext('webgl2'),
      );
      expect(webgl2).toBe(true);

      const shot = await page.locator('#view').screenshot();
      await testInfo.attach(`${cam}-${testInfo.project.name}.png`, {
        body: shot,
        contentType: 'image/png',
      });
      await page.screenshot({ path: `test-results/shots/${testInfo.project.name}-${cam}.png` });
      expect(errors).toEqual([]);
    });
  }
});

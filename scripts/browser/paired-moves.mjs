const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ?? 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const queries = [];
  page.on('request', (r) => {
    if (r.url().includes('/levels/moves/')) queries.push(r.url());
  });
  await page.goto('http://127.0.0.1:5191/');
  await page.getByRole('button', { name: 'Use Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in ↗', exact: true }).click();
  await page.locator('#home:not([hidden])').waitFor();
  await page.evaluate(
    () => (location.hash = 'solo/campaign/00000000-0000-4000-8000-000000000001/p1/creator'),
  );
  await page.locator('.move-sequence:not([hidden])').waitFor();
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await page.locator('.move-pairs li[data-state=confirmed]').first().waitFor();
  assert.deepEqual(await page.locator('.move-pair-cells .move-cell').allTextContents(), ['↑', '↓']);
  await page.getByRole('button', { name: 'Wait', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.move-pairs li[data-state=confirmed]').length === 2,
  );
  await page.screenshot({ path: '/tmp/taser-paired-moves-desktop.png' });
  const before = queries.length;
  await page.waitForTimeout(3300);
  assert.ok(queries.length > before, 'polls without another move');
  await page.locator('#undo').click();
  await page.waitForFunction(() => document.querySelectorAll('.move-pair-cells').length === 1);
  await page.locator('#reset').click();
  await page.getByText('Choose a move together.', { exact: false }).waitFor();
  await page.request.get('http://127.0.0.1:5191/__test/query-fail');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await page.getByText('Query failed · retrying', { exact: true }).waitFor();
  await page.request.get('http://127.0.0.1:5191/__test/query-recover');
  await page.locator('.move-pairs li[data-state=confirmed]').first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/taser-paired-moves-mobile.png' });
  const rects = await page.evaluate(() => {
    const console = document.querySelector('.console').getBoundingClientRect(),
      seq = document.querySelector('.move-sequence').getBoundingClientRect();
    return { console: console.toJSON(), seq: seq.toJSON(), width: innerWidth };
  });
  assert.ok(rects.seq.left >= 0 && rects.seq.right <= rects.width);
  assert.ok(rects.seq.top >= rects.console.top && rects.seq.bottom <= rects.console.bottom);
  await page.evaluate(() => (location.hash = ''));
  await page.locator('#home:not([hidden])').waitFor();
  const stopped = queries.length;
  await page.waitForTimeout(3300);
  assert.equal(queries.length, stopped, 'polling stops after leaving');
  assert.deepEqual(errors, []);
  console.log(
    'Passed: real session + API database reads, two-cell arrows, 3s polling, undo/reset, query failure/recovery, mobile containment, cleanup and no browser errors.',
  );
} finally {
  await browser.close();
}

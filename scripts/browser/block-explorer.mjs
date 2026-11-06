const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ?? 'playwright');
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const level = JSON.parse(
  readFileSync(new URL('../../server/data/levels.json', import.meta.url), 'utf8'),
)[0];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const base = 'http://127.0.0.1:5191';
let polls = 0;
page.on('request', (r) => {
  if (r.url().endsWith('/levels/activity') || r.url().includes('/levels/moves/')) polls++;
});
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Use Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in ↗', exact: true }).click();
  const panel = page.locator('#arkiv-panel'),
    toggle = panel.locator('.arkiv-toggle');
  await panel.getByText('Test archive · no blockchain writes', { exact: true }).waitFor();
  assert.equal(await panel.locator('a[href*="explorer.arkiv.network"]').count(), 0);
  assert.equal(await panel.locator('.arkiv-memory-grid button').count(), 6);
  await page.screenshot({ path: '/tmp/block-explorer-home-desktop.png' });
  await panel.locator('[data-category="theme"]').click();
  assert.match(
    await panel.locator('.arkiv-chain-query pre').first().textContent(),
    /ThemeEntities/,
  );
  await panel.locator('[data-category="move"]').click();
  assert.match(
    await panel.locator('.arkiv-chain-query pre').first().textContent(),
    /eq\('category', 'move'\)/,
  );
  await page.evaluate(() => (location.hash = 'solo/campaign'));
  await page.locator('.archive-card').first().waitFor();
  await panel.waitFor({ state: 'hidden' });
  await page
    .locator('.archive-card')
    .first()
    .getByRole('link', { name: 'Choose P1 / P2 ↗' })
    .click();
  await page.locator('.role-link').first().click();
  await page.getByRole('link', { name: 'Player runs →' }).click();
  await page.getByRole('link', { name: 'Fixture echo', exact: false }).waitFor();
  assert.equal(await page.locator('.archive-proof-links a').count(), 0);
  await page.getByRole('link', { name: '← Replay sources' }).click();
  await page.getByRole('link', { name: 'Creator solution →' }).click();
  await page.locator('#operator button[data-move=U]').waitFor();
  await page.waitForFunction(() => document.querySelector('#turn')?.textContent === '00');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#turn')?.textContent === '01');
  await page.locator('.move-pairs [data-sequence="1"]').waitFor();
  await page.locator('.move-pairs').getByText('Test record', { exact: true }).first().waitFor();
  await page.locator('#undo').click();
  await page.waitForFunction(() => document.querySelector('#turn')?.textContent === '00');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#turn')?.textContent === '01');
  await page.locator('.move-pairs [data-sequence="2"]').waitFor();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#turn')?.textContent === '01');
  await page.request.get(base + '/__test/fail');
  await page.locator('#reset').click();
  await page.waitForFunction(() => document.querySelector('#turn')?.textContent === '00');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#turn')?.textContent === '01');
  await page.locator('.move-pairs').getByText('Failed', { exact: true }).waitFor();
  await page.request.get(base + '/__test/recover');
  await page.waitForFunction(
    () => document.querySelector('.move-pairs [data-state=confirmed]') !== null,
  );
  // Finish a real server-simulated win, using the test archive, then verify publication reaches the panel.
  for (let i = 1; i < level.solutionP1.length; i++) {
    await page.locator(`[data-move=${level.solutionP1[i]}]`).click();
    await page.waitForFunction(
      (step) => Number(document.querySelector('#turn')?.textContent) === step,
      i + 1,
    );
  }
  await page.locator('#outcome.victory').waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('#outcome-message')
      ?.textContent?.includes('Your winning run is published.'),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await page.screenshot({ path: '/tmp/block-explorer-gameplay-mobile.png' });
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  const rect = await page.locator('.move-sequence').boundingBox();
  assert(rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 0);
  await page.screenshot({ path: '/tmp/block-explorer-minimized-mobile.png' });
  await page.getByRole('button', { name: 'Return to home', exact: true }).click();
  await panel.waitFor();
  await panel.locator('.arkiv-guide').waitFor();
  await page.screenshot({ path: '/tmp/block-explorer-home-mobile.png' });
  await page.evaluate(() => (location.hash = 'create'));
  await panel.waitFor({ state: 'hidden' });
  await page.waitForTimeout(200);
  const stopped = polls;
  await page.waitForTimeout(3300);
  assert.equal(polls, stopped, 'polling stops in the creator');
  await page.locator('[data-editor=save]').click();
  await page.screenshot({ path: '/tmp/block-explorer-creator-mobile.png' });
  // Mocked live-style responses test links and state rendering only. They are not live-chain evidence.
  const tx = '0x' + 'ab'.repeat(32),
    entity = '0x' + 'cd'.repeat(32);
  let verifyMockMove = false;
  await page.route('**/levels/activity', (route) =>
    route.fulfill({
      json: {
        storage: 'arkiv',
        activities: [
          {
            id: 'mock:1',
            kind: 'move',
            label: 'Mock confirmed turn',
            createdAt: Date.now(),
            state: 'confirmed',
            txHash: tx,
            entityKey: entity,
          },
          {
            id: 'mock:2',
            kind: 'move',
            label: 'Mock submitted turn',
            createdAt: Date.now(),
            state: verifyMockMove ? 'confirmed' : 'pending',
            txHash: tx,
            entityKey: verifyMockMove ? entity : undefined,
          },
          {
            id: 'mock:3',
            kind: 'move',
            label: 'Mock failed turn',
            createdAt: Date.now(),
            state: 'failed',
            message: 'Mock fee cap failure',
          },
        ],
      },
    }),
  );
  await page.evaluate(() => (location.hash = ''));
  await panel.getByText('Mock confirmed turn', { exact: true }).waitFor();
  assert.equal(
    await panel
      .getByRole('link', { name: 'Transaction ↗', exact: true })
      .first()
      .getAttribute('href'),
    `https://rabdi.explorer.arkiv.network/tx/${tx}`,
  );
  assert.equal(
    await panel.getByRole('link', { name: 'Entity ↗', exact: true }).getAttribute('href'),
    `https://rabdi.explorer.arkiv.network/entity/${entity}`,
  );
  await panel.getByText('Pending verification', { exact: true }).waitFor();
  await panel.getByText('Failed', { exact: true }).waitFor();
  assert.equal(await page.locator('.arkiv-arrival').count(), 0, 'history loads quietly');
  verifyMockMove = true;
  await page.locator('.arkiv-arrival[data-activity-id="mock:2"]').waitFor();
  await page.screenshot({ path: '/tmp/block-explorer-verified-arrival.png' });
  await page.route('**/levels/runs/**', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.runs = data.runs.map((r) => ({ ...r, storage: 'arkiv', txHash: tx, entityKey: entity }));
    await route.fulfill({ json: data });
  });
  await page.evaluate(() => (location.hash = 'solo/campaign'));
  await page.locator('.archive-card').first().waitFor();
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.arkiv-arrival').count(), 0, 'navigation clears arrivals');
  await page
    .locator('.archive-card')
    .first()
    .getByRole('link', { name: 'Choose P1 / P2 ↗' })
    .click();
  await page.locator('.role-link').first().click();
  await page.getByRole('link', { name: 'Player runs →' }).click();
  await page.getByRole('link', { name: 'Archived entity ↗', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('link', { name: 'Publication transaction ↗', exact: true })
      .getAttribute('href'),
    `https://rabdi.explorer.arkiv.network/tx/${tx}`,
  );
  await panel.waitFor({ state: 'hidden' });
  await page.screenshot({ path: '/tmp/block-explorer-runs-mobile.png' });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        checks: [
          'production UI + real HTTP/WebSocket test archive',
          'keyboard minimize/expand/Escape',
          'solo move pairs + undo/reset + reconnect',
          'write failure + recovery',
          'winning-run publication',
          'home record guide and direct chain query examples',
          'creator and browsing hide the panel; inactive polling cleanup',
          '390px viewport',
          'mocked live-style pending/confirmed/failed and explorer links',
          'verified move flies in; historical receipts stay quiet; navigation clears animations',
          'player-run entity/transaction links (mocked)',
        ],
        pageErrors: errors,
        screenshots: '/tmp/block-explorer-*.png',
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

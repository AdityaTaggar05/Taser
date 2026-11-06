const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ?? 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const a = await browser.newPage({ viewport: { width: 1440, height: 960 } }),
  b = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [];
for (const page of [a, b]) page.on('pageerror', (e) => errors.push(e.message));
async function login(page, name) {
  await page.goto('http://127.0.0.1:5191');
  await page.getByRole('button', { name: 'Use ' + name, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in ↗', exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.screen === 'home');
}
try {
  await login(a, 'Atlas');
  console.log('Co-op: signed in host');
  await login(b, 'Nova');
  await a.evaluate(() => (location.hash = 'coop/campaign'));
  await a.locator('.archive-card').first().getByRole('link', { name: 'Choose P1 / P2 ↗' }).click();
  await a.locator('.role-link').first().click();
  await a.locator('.party-code').waitFor({ timeout: 12000 });
  console.log('Co-op: party created');
  await a.waitForFunction(() => document.querySelector('.party-code')?.textContent?.length === 6);
  const code = await a.locator('.party-code').textContent();
  await b.evaluate((code) => (location.hash = 'invite/' + code), code);
  await b.getByRole('button', { name: 'Ready', exact: true }).waitFor();
  for (const p of [a, b]) {
    await p.getByRole('button', { name: 'Ready', exact: true }).click();
  }
  await a.getByRole('button', { name: 'Start challenge ↗', exact: true }).click();
  console.log('Co-op: started');
  await a.getByRole('button', { name: 'Move up', exact: true }).waitFor();
  await a.getByRole('button', { name: 'Move up', exact: true }).click();
  assert.equal(await a.locator('#turn').textContent(), '00');
  await a.getByRole('button', { name: 'Cancel', exact: true }).click();
  await b.getByRole('button', { name: 'Move down', exact: true }).click();
  assert.equal(await b.locator('#turn').textContent(), '00');
  await a.getByRole('button', { name: 'Move up', exact: true }).click();
  for (const p of [a, b]) {
    await p.waitForFunction(() => document.querySelector('#turn')?.textContent === '01');
    await p.locator('.move-pairs [data-sequence="1"]').waitFor();
    await p.locator('.move-pairs [data-state=confirmed]').waitFor();
  }
  await a.screenshot({ path: '/tmp/block-explorer-coop-desktop.png' });
  await a.locator('#reset').click();
  for (const p of [a, b])
    await p.waitForFunction(() => document.querySelector('#turn')?.textContent === '00');
  await a.getByRole('button', { name: 'Move up', exact: true }).click();
  await b.getByRole('button', { name: 'Move down', exact: true }).click();
  await b.reload();
  await b.waitForFunction(() => document.querySelector('#turn')?.textContent === '01');
  await b.locator('.move-pairs [data-sequence="2"]').waitFor();
  await a.getByRole('button', { name: 'Return to home', exact: true }).click();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'Co-op browser PASS: two accounts, lobby/ready/start, cancel and partial pairs, activity for both participants, reset, guest reconnect, desktop and mobile; test archive only.',
  );
} catch (error) {
  console.log('Host screen:', (await a.locator('body').innerText()).slice(-2500));
  console.log('Guest screen:', (await b.locator('body').innerText()).slice(-1500));
  throw error;
} finally {
  await browser.close();
}

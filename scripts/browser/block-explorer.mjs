const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH??'playwright');
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const level=JSON.parse(readFileSync(new URL('../../server/data/levels.json',import.meta.url),'utf8'))[0];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const base='http://127.0.0.1:5191';let polls=0;page.on('request',r=>{if(r.url().endsWith('/levels/activity'))polls++;});
try{
await page.goto(base);await page.getByRole('button',{name:'Use Atlas',exact:true}).click();await page.getByRole('button',{name:'Sign in ↗',exact:true}).click();
await page.evaluate(()=>location.hash='solo/campaign');await page.locator('.archive-card').first().waitFor();
const panel=page.locator('#arkiv-panel'),toggle=panel.locator('button');await toggle.click();await panel.getByText('Test archive · no blockchain writes',{exact:true}).waitFor();
assert.equal(await panel.locator('a[href*="explorer.arkiv.network"]').count(),0);
await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'false');await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
await page.locator('.archive-card').first().getByRole('link',{name:'Choose P1 / P2 ↗'}).click();await page.locator('.role-link').first().click();await page.getByRole('link',{name:'Player runs →'}).click();await page.getByRole('link',{name:'Fixture echo',exact:false}).waitFor();
assert.equal(await page.locator('.archive-proof-links a').count(),0);
await page.getByRole('link',{name:'← Replay sources'}).click();await page.getByRole('link',{name:'Creator solution →'}).click();await page.locator('#operator button[data-move=U]').waitFor();await page.waitForFunction(()=>document.querySelector('#turn')?.textContent==='00');
await page.getByRole('button',{name:'Move up',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#turn')?.textContent==='01');
await toggle.click();await panel.getByText('Turn 1 · move pair 1',{exact:true}).waitFor();await panel.getByText('TEST · recorded',{exact:true}).first().waitFor();
await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelector('#turn')?.textContent==='00');await page.getByRole('button',{name:'Move up',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#turn')?.textContent==='01');await panel.getByText('Turn 1 · move pair 2',{exact:true}).waitFor();
await page.reload();await page.waitForFunction(()=>document.querySelector('#turn')?.textContent==='01');
await page.request.get(base+'/__test/fail');await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelector('#turn')?.textContent==='00');await page.getByRole('button',{name:'Move up',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#turn')?.textContent==='01');await panel.getByText('TEST · failed',{exact:true}).waitFor();
await page.request.get(base+'/__test/recover');await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.arkiv-write-state')).some(e=>e.textContent==='TEST · failed'));
// Finish a real server-simulated win, using the test archive, then verify publication reaches the panel.
for(let i=1;i<level.solutionP1.length;i++){await page.locator(`[data-move=${level.solutionP1[i]}]`).click();await page.waitForFunction(step=>Number(document.querySelector('#turn')?.textContent)===step,i+1);}
await page.locator('#outcome.victory').waitFor();await panel.getByText('Winning run · P1',{exact:true}).waitFor();
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/block-explorer-gameplay-mobile.png'});
const rect=await panel.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=390&&rect.y>=0);await toggle.click();await page.screenshot({path:'/tmp/block-explorer-minimized-mobile.png'});
await page.getByRole('button',{name:'Return to home',exact:true}).click();await panel.waitFor({state:'hidden'});await page.waitForTimeout(200);const stopped=polls;await page.waitForTimeout(3300);assert.equal(polls,stopped,'polling stops on home');
await page.evaluate(()=>location.hash='create');await panel.waitFor();await toggle.click();await page.locator('[data-editor=save]').click();await panel.getByText('Draft revision 1',{exact:true}).waitFor();
await page.screenshot({path:'/tmp/block-explorer-creator-mobile.png'});
// Mocked live-style responses test links and state rendering only. They are not live-chain evidence.
const tx='0x'+'ab'.repeat(32),entity='0x'+'cd'.repeat(32);
await page.route('**/levels/activity',route=>route.fulfill({json:{storage:'arkiv',activities:[{id:'mock:1',kind:'move',label:'Mock confirmed turn',createdAt:Date.now(),state:'confirmed',txHash:tx,entityKey:entity},{id:'mock:2',kind:'move',label:'Mock submitted turn',createdAt:Date.now(),state:'pending',txHash:tx},{id:'mock:3',kind:'move',label:'Mock failed turn',createdAt:Date.now(),state:'failed',message:'Mock fee cap failure'}]}}));
await page.evaluate(()=>location.hash='');await page.waitForTimeout(100);await page.evaluate(()=>location.hash='solo/campaign');await page.locator('.archive-card').first().waitFor();await panel.getByText('Mock confirmed turn',{exact:true}).waitFor();
assert.equal(await panel.getByRole('link',{name:'Transaction ↗',exact:true}).first().getAttribute('href'),`https://rabdi.explorer.arkiv.network/tx/${tx}`);assert.equal(await panel.getByRole('link',{name:'Entity ↗',exact:true}).getAttribute('href'),`https://rabdi.explorer.arkiv.network/entity/${entity}`);
await panel.getByText('Pending verification',{exact:true}).waitFor();await panel.getByText('Failed',{exact:true}).waitFor();
await page.route('**/levels/runs/**',async route=>{const response=await route.fetch();const data=await response.json();data.runs=data.runs.map(r=>({...r,storage:'arkiv',txHash:tx,entityKey:entity}));await route.fulfill({json:data});});
await toggle.click();await page.locator('.archive-card').first().getByRole('link',{name:'Choose P1 / P2 ↗'}).click();await page.locator('.role-link').first().click();await page.getByRole('link',{name:'Player runs →'}).click();await page.getByRole('link',{name:'Archived entity ↗',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Publication transaction ↗',exact:true}).getAttribute('href'),`https://rabdi.explorer.arkiv.network/tx/${tx}`);
await toggle.click();await page.screenshot({path:'/tmp/block-explorer-runs-mobile.png'});assert.equal(errors.length,0,errors.join('\n'));
console.log(JSON.stringify({result:'passed',checks:['production UI + real HTTP/WebSocket test archive','keyboard minimize/expand/Escape','solo move pairs + undo/reset + reconnect','write failure + recovery','winning-run publication','home polling cleanup','creator save','390px viewport','mocked live-style pending/confirmed/failed and explorer links','player-run entity/transaction links (mocked)'],pageErrors:errors,screenshots:'/tmp/block-explorer-*.png'},null,2));}finally{await browser.close();}

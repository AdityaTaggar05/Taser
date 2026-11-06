const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH??'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],frames=[];
page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>socket.on('framereceived',event=>{try{frames.push(JSON.parse(event.payload));}catch{}}));
let releaseArtwork;let heldImages=0,released=false;
const artwork=new Promise(resolve=>{releaseArtwork=()=>{released=true;resolve();};});
await page.route('**/*.png',async route=>{heldImages++;await artwork;await route.continue().catch(()=>{});});
const base='http://127.0.0.1:5191',id='00000000-0000-4000-8000-000000000001';
const create=()=>page.evaluate(id=>location.hash='coop/campaign/'+id+'/p1',id);
const leave=()=>page.locator('[data-party=leave]').click();
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Use Atlas',exact:true}).click();await page.getByRole('button',{name:'Sign in ↗',exact:true}).click();
  await page.waitForFunction(()=>document.body.dataset.screen==='home');await page.request.get(base+'/__test/join-slow');
  await create();await page.locator('.party-status').filter({hasText:'Reading and verifying the chamber from the archive'}).waitFor({timeout:2000});
  await page.locator('.party-status').filter({hasText:/\([12]s\)/}).waitFor({timeout:2500});
  await page.screenshot({path:'/tmp/party-loading-mobile.png'});
  await page.waitForFunction(()=>document.querySelector('.party-code')?.textContent?.length===6);
  assert(heldImages>0&&!released,'party opens before any blocked artwork is released');
  assert(frames.some(f=>f.type==='joining'&&f.stage==='level'));assert.equal(await page.locator('.party-status').getAttribute('data-loading'),'false');
  releaseArtwork();await leave();console.log('PASS: immediate loading stages + elapsed time; party created while artwork was blocked.');
  await page.request.get(base+'/__test/join-fail');await create();await page.locator('[data-party=retry]').waitFor();
  await page.getByRole('heading',{name:'Could not open your party',exact:true}).waitFor();
  assert.equal(await page.locator('.party-invite').isVisible(),false);await page.request.get(base+'/__test/join-recover');await page.locator('[data-party=retry]').click();
  await page.waitForFunction(()=>document.querySelector('.party-code')?.textContent?.length===6);await leave();console.log('PASS: read failure is visible; retry creates the party.');
  await page.request.get(base+'/__test/join-slow');await create();await page.locator('.party-status').filter({hasText:'Reading and verifying'}).waitFor();await leave();
  await page.waitForTimeout(3300);await page.request.get(base+'/__test/join-recover');await create();await page.waitForFunction(()=>document.querySelector('.party-code')?.textContent?.length===6);await leave();
  assert.deepEqual(errors,[]);console.log('PASS: leaving a slow load creates no orphaned party; another party can be created. No browser errors. Test archive only; no live-chain verification.');
}catch(error){console.error((await page.locator('body').innerText()).slice(-2500));throw error;}
finally{releaseArtwork();await browser.close();}

import { chromium } from 'playwright';
import fs from 'node:fs';

const baseUrl = 'http://127.0.0.1:7460';
const output = 'test-results';
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const records = [];
let fatal = null;

for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }, { width: 932, height: 430 }]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  const startedAt = Date.now();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  try {
    await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });
  } catch (error) {
    fatal = `bootstrap unavailable at ${viewport.width}x${viewport.height}: ${error.message}; ${errors.join(' | ')}`;
    await page.screenshot({ path: `${output}/failure-${viewport.width}x${viewport.height}.png` });
    await context.close();
    break;
  }
  const canvas = await page.locator('canvas').first();
  const bounds = await canvas.boundingBox();
  if (!bounds || bounds.width < viewport.width * 0.9 || bounds.height < viewport.height * 0.85) throw new Error(`canvas not full size: ${JSON.stringify(bounds)}`);
  await page.screenshot({ path: `${output}/menu-${viewport.width}x${viewport.height}.png` });
  await page.evaluate(() => globalThis.__FPS_GAME__.start('blue'));
  await page.waitForTimeout(6200);
  let state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.phase !== 'playing' || state.actorCount !== 24) throw new Error(`invalid match state ${JSON.stringify(state)}`);
  await page.evaluate(() => { globalThis.__FPS_GAME__.fire(); globalThis.__FPS_GAME__.reload(); globalThis.__FPS_GAME__.grenade(); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { globalThis.__FPS_GAME__.damagePlayer(25); globalThis.__FPS_GAME__.heal(); });
  await page.waitForTimeout(2400);
  state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.ammo.magazine < 0 || state.ammo.reserve < 0 || state.activeGrenades > 2) throw new Error(`invalid consumables ${JSON.stringify(state)}`);
  for (const quality of ['low', 'medium', 'high']) {
    await page.evaluate(q => globalThis.__FPS_GAME__.setQuality(q), quality);
    await page.waitForTimeout(100);
    const qualityState=await page.evaluate(() => globalThis.__FPS_GAME__.state());
    if(qualityState.shadowEnabled!==(quality==='high')||qualityState.fogEnabled!==(quality!=='low'))throw new Error(`quality state mismatch: ${JSON.stringify(qualityState)}`);
  }
  await page.evaluate(() => globalThis.__FPS_GAME__.releaseInputs());
  await page.screenshot({ path: `${output}/battle-${viewport.width}x${viewport.height}.png` });
  const screenshot = await page.screenshot();
  const byteVariety = new Set(screenshot.subarray(Math.max(0, screenshot.length - 20000))).size;
  if (byteVariety < 40) throw new Error(`screenshot appears blank, byte variety ${byteVariety}`);
  records.push({ viewport, loadMs: Date.now() - startedAt, state, errors, byteVariety });
  await context.close();
}

if (!fatal) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });
  for (let i = 0; i < 20; i += 1) {
    await page.evaluate(() => globalThis.__FPS_GAME__.restart());
    await page.waitForTimeout(35);
    const state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    if (state.actorCount !== 24) throw new Error(`restart ${i + 1} actor leak: ${state.actorCount}`);
  }
  await page.waitForTimeout(3500);
  await page.evaluate(() => globalThis.__FPS_GAME__.forceEndSoon());
  await page.waitForTimeout(1300);
  const finalState = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (finalState.phase !== 'ended' || finalState.actorCount !== 24 || finalState.restarts !== 20) throw new Error(`restart/end failure ${JSON.stringify(finalState)}`);
  records.push({ restartTest: finalState, errors });
  await page.evaluate(() => { window.addEventListener('pagehide',()=>localStorage.setItem('city-front-web-profile-v1','{broken-json'),{once:true}); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });
  const recoveredCoins=await page.evaluate(() => globalThis.__FPS_GAME__.state().coins);
  if(recoveredCoins!==1000)throw new Error(`corrupt save did not recover: ${recoveredCoins}`);
  await page.evaluate(() => globalThis.__FPS_GAME__.resetProfile());
  records.push({ corruptSaveRecovered: true, recoveredCoins });
  await context.close();
}

await browser.close();
fs.writeFileSync(`${output}/browser-smoke.json`, JSON.stringify({ fatal, records }, null, 2));
if (fatal) throw new Error(fatal);
const allErrors = records.flatMap(record => record.errors || []).filter(error => !error.includes('AudioContext'));
if (allErrors.length) throw new Error(`runtime errors: ${allErrors.join(' | ')}`);
console.log(JSON.stringify({ ok: true, records }, null, 2));

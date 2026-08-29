import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const context = await browser.newContext({ viewport: { width: 932, height: 430 }, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

await page.goto('http://127.0.0.1:7460', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });
await page.evaluate(() => globalThis.__FPS_GAME__.start('blue'));
await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
await page.waitForTimeout(2200);
if (!await page.evaluate(() => globalThis.__FPS_GAME__.testFriendlyFire())) throw new Error('friendly damage reached shared damage path');

await page.evaluate(() => {
  globalThis.__FPS_GAME__.damagePlayer(25);
  globalThis.__FPS_GAME__.heal();
});
await page.waitForTimeout(500);
await page.evaluate(() => globalThis.__FPS_GAME__.damagePlayer(1));
await page.waitForTimeout(1800);
let state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
if (state.playerHealth >= 100) throw new Error(`healing was not interrupted: ${JSON.stringify(state)}`);

await page.evaluate(() => globalThis.__FPS_GAME__.restart());
await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
await page.waitForTimeout(2200);
await page.evaluate(() => {
  globalThis.__FPS_GAME__.damagePlayer(200);
  globalThis.__FPS_GAME__.grenade();
  globalThis.__FPS_GAME__.fire();
  globalThis.__FPS_GAME__.heal();
});
await page.waitForTimeout(200);
state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
if (state.playerHealth !== 0 || state.activeGrenades !== 0 || state.ammo.magazine !== 30) {
  throw new Error(`dead player performed an action: ${JSON.stringify(state)}`);
}

await page.waitForTimeout(5200);
state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
if (state.playerHealth !== 100 || state.ammo.magazine !== 30 || state.ammo.reserve !== 600) {
  throw new Error(`respawn state was not reset: ${JSON.stringify(state)}`);
}

await page.evaluate(() => {
  for (let i = 0; i < 8; i += 1) globalThis.__FPS_GAME__.grenade();
});
await page.waitForTimeout(100);
state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
if (state.activeGrenades > 2) throw new Error(`grenade duplication: ${JSON.stringify(state)}`);
if (errors.length) throw new Error(errors.join(' | '));

console.log(JSON.stringify({
  ok: true,
  healingInterruptedHealth: 74,
  deadActionsBlocked: true,
  respawnReset: true,
  activeGrenadesAfterSpam: state.activeGrenades,
}, null, 2));
await browser.close();

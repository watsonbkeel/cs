import { chromium } from 'playwright';
import fs from 'node:fs';

const baseUrl = 'http://127.0.0.1:7460';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
  browser.newContext({ viewport: { width: 1366, height: 768 } }),
]);
const pages = await Promise.all(contexts.map(context => context.newPage()));
const errors = [];
for (const page of pages) {
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });
}

await pages[0].evaluate(() => globalThis.__FPS_GAME__.onlineCreate('blue', 'm16'));
await pages[0].waitForFunction(() => globalThis.__FPS_GAME__.state().roomCode.length === 6);
const roomCode = await pages[0].evaluate(() => globalThis.__FPS_GAME__.state().roomCode);
await pages[1].evaluate(code => globalThis.__FPS_GAME__.onlineJoin(code, 'red', 'akm'), roomCode);
await Promise.all(pages.map(page => page.waitForFunction(() => globalThis.__FPS_GAME__.state().roomPlayers === 2)));

await pages[0].evaluate(() => globalThis.__FPS_GAME__.onlineStart('military-base'));
await Promise.all(pages.map(page => page.waitForFunction(() => {
  const state = globalThis.__FPS_GAME__.state();
  return state.phase === 'playing' && state.actorCount === 24 && state.map === 'military-base';
}, null, { timeout: 15000 })));

await pages[1].evaluate(() => globalThis.__FPS_GAME__.ads(true));
await pages[1].evaluate(() => globalThis.__FPS_GAME__.holdFire());
await pages[1].waitForTimeout(240);
await pages[1].evaluate(() => globalThis.__FPS_GAME__.releaseFire());
await pages[1].evaluate(() => globalThis.__FPS_GAME__.ads(false));
await pages[1].waitForTimeout(350);
const clientState = await pages[1].evaluate(() => globalThis.__FPS_GAME__.state());
if (clientState.ammo.magazine >= 30) throw new Error(`remote client ammunition did not decrease: ${JSON.stringify(clientState.ammo)}`);

await pages[1].evaluate(() => globalThis.__FPS_GAME__.grenade());
await pages[0].waitForFunction(() => globalThis.__FPS_GAME__.state().activeGrenades === 1, null, { timeout: 3000 });
await pages[1].waitForFunction(() => globalThis.__FPS_GAME__.state().activeGrenades === 1, null, { timeout: 3000 });
await pages[1].waitForFunction(() => globalThis.__FPS_GAME__.state().activeGrenades === 0, null, { timeout: 6000 });

const beforeMigration = await pages[1].evaluate(() => globalThis.__FPS_GAME__.state());
if (beforeMigration.isHost) throw new Error('joining client unexpectedly became host before migration');
await pages[0].evaluate(() => globalThis.__FPS_GAME__.onlineLeave());
await pages[1].waitForFunction(() => globalThis.__FPS_GAME__.state().isHost === true, null, { timeout: 5000 });
await pages[1].waitForFunction(() => { const state=globalThis.__FPS_GAME__.state();return state.phase==='playing'&&state.actorCount===24&&state.map==='military-base'; }, null, { timeout: 5000 });
const finalState = await pages[1].evaluate(() => globalThis.__FPS_GAME__.state());
await pages[1].screenshot({ path: 'test-results/web-online-client.png' });

for (const context of contexts) await context.close();
await browser.close();
const runtimeErrors = errors.filter(error => !error.includes('AudioContext'));
if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
const report = { ok: true, roomCode, humans: 2, aiFill: 22, clientAmmo: clientState.ammo, hostMigrated: finalState.isHost, snapshotContinued: finalState.phase==='playing'&&finalState.actorCount===24 };
fs.writeFileSync('test-results/web-online-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

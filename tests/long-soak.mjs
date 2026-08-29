import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const context = await browser.newContext({ viewport: { width: 932, height: 430 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
await page.goto('http://127.0.0.1:7460', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });

const samples = [];
const matches = [];
const stagnantCounts = new Map();
let previousPositions = new Map();

for (const team of ['blue', 'red']) {
  await page.evaluate(selected => globalThis.__FPS_GAME__.start(selected), team);
  await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
  const started = Date.now();
  let sampleIndex = 0;
  while (true) {
    await page.waitForTimeout(30000);
    const state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    sampleIndex += 1;
    for (const actor of state.actorPositions) {
      const old = previousPositions.get(actor.id);
      const moved = old ? Math.hypot(actor.position[0]-old[0], actor.position[2]-old[2]) : Infinity;
      stagnantCounts.set(actor.id, moved < 0.15 ? (stagnantCounts.get(actor.id) || 0) + 1 : 0);
      previousPositions.set(actor.id, actor.position);
      if (Math.abs(actor.position[0]) > 88 || Math.abs(actor.position[2]) > 88 || actor.position[1] < -4.21 || actor.position[1] > 20) throw new Error(`actor out of bounds: ${JSON.stringify(actor)}`);
    }
    const sample = { team, elapsedSeconds: Math.round((Date.now()-started)/1000), heap, ...state };
    samples.push(sample);
    console.log(`SOAK ${team} ${sample.elapsedSeconds}s phase=${state.phase} score=${state.score.blue}:${state.score.red} alive=${state.aliveActors} fps=${state.averageFps.toFixed(1)} heap=${Math.round(heap/1048576)}MB`);
    if (state.phase === 'ended') {
      matches.push({ team, elapsedSeconds: sample.elapsedSeconds, finalState: state });
      break;
    }
    if (sampleIndex > 23) throw new Error(`match did not end within 11.5 minutes: ${team}`);
  }
}

await page.screenshot({ path: 'test-results/long-soak-final.png' });
const report = {
  startedAt: new Date(samples[0] ? Date.now() - samples[samples.length-1].elapsedSeconds * 1000 : Date.now()).toISOString(),
  finishedAt: new Date().toISOString(), viewport: { width: 932, height: 430 }, matches, samples,
  maxHeap: Math.max(...samples.map(s => s.heap)), minFps: Math.min(...samples.map(s => s.worstFps || 999)),
  longStagnantActors: [...stagnantCounts.entries()].filter(([, count]) => count >= 4), errors,
};
fs.writeFileSync('test-results/long-soak.json', JSON.stringify(report, null, 2));
await browser.close();
if (matches.length !== 2) throw new Error(`expected 2 complete matches, got ${matches.length}`);
if (errors.length) throw new Error(errors.join(' | '));
console.log(`SOAK COMPLETE matches=${matches.length} maxHeap=${Math.round(report.maxHeap/1048576)}MB stagnant=${report.longStagnantActors.length}`);

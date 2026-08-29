import { chromium } from 'playwright';
import fs from 'node:fs';

const baseUrl = 'http://127.0.0.1:7460';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const report = { viewports: [], weaponChecks: [], errors: [] };

for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });
  await page.evaluate(() => globalThis.__FPS_GAME__.grantXp(20000));
  const missionRotation=await page.evaluate(()=>({blue:globalThis.__FPS_GAME__.drawMissionRotation('blue',11),red:globalThis.__FPS_GAME__.drawMissionRotation('red',12)}));
  if(new Set(missionRotation.blue).size!==11||new Set(missionRotation.red).size!==12)throw new Error(`mission rotation repeated before deck exhaustion: ${JSON.stringify(missionRotation)}`);
  const allMaps=['city','city-riverside','military-base','military-depot','harbor-terminal','harbor-shipyard','refinery','power-station','mountain-checkpoint','mountain-radar','desert-outpost','desert-village','forest-station','forest-depot','airport-cargo','airport-perimeter'];
  for(const map of allMaps){
    await page.evaluate(selectedMap=>globalThis.__FPS_GAME__.start('blue',selectedMap,'m16'),map);
    const mapState=await page.evaluate(()=>globalThis.__FPS_GAME__.state());
    const naturalTerrain=map.startsWith('forest')||map.startsWith('mountain')||map.startsWith('desert');
    if(mapState.map!==map||mapState.mapCount!==16||mapState.missionCount!==22||mapState.actorCount!==24||mapState.capturePointCount!==5||mapState.obstacleCount<26||(naturalTerrain?mapState.naturalCoverCount<4:mapState.naturalCoverCount!==0)||mapState.upperFloorCount<2||mapState.characterPartCount<64||mapState.weaponPartCount<85)throw new Error(`map/visual build failed: ${map} ${JSON.stringify(mapState)}`);
    if(!mapState.weaponVisuals.some(part=>part.name==='BarrelTube'&&part.active)||!mapState.weaponVisuals.some(part=>part.name==='Trigger'&&part.active)||!mapState.weaponVisuals.some(part=>part.name==='RailTooth0'&&part.active))throw new Error(`detailed PBR weapon parts missing: ${map}`);
    if(!mapState.factionVisuals.blue.includes('NVGMount')||mapState.factionVisuals.blue.includes('HeadWrap')||!mapState.factionVisuals.red.includes('HeadWrap')||!mapState.factionVisuals.red.includes('ChestRig')||mapState.factionVisuals.red.includes('NVGMount'))throw new Error(`team silhouettes are not distinct: ${map} ${JSON.stringify(mapState.factionVisuals)}`);
  }
  for(const [team,mission,objectives,commanders] of [['blue','hostage-rescue',2,0],['blue','bomb-defusal',2,0],['blue','vip-escort',1,2],['blue','safehouse-raid',2,0],['red','cache-defense',2,0],['red','extraction-intercept',0,2],['red','corridor-denial',3,0],['red','evacuation-cover',1,2],['red','supply-line-disruption',2,0]]){
    await page.evaluate(([selectedTeam,selectedMission])=>globalThis.__FPS_GAME__.startMission(selectedTeam,selectedMission,'city'),[team,mission]);
    const missionState=await page.evaluate(()=>globalThis.__FPS_GAME__.state());
    if(missionState.mission!==mission||missionState.activeObjectiveCount!==objectives||missionState.hud.commanderMarkerCount!==commanders||!missionState.missionBriefingVisible)throw new Error(`expanded mission setup failed: ${mission} ${JSON.stringify(missionState)}`);
  }
  await page.evaluate(() => globalThis.__FPS_GAME__.start('blue', 'city', 'm16'));
  await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
  await page.waitForTimeout(2200);

  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.click(center.x, center.y);
  await page.waitForFunction(() => globalThis.__FPS_GAME__.state().pointerLocked === true, null, { timeout: 5000 });
  await page.evaluate(() => globalThis.__FPS_GAME__.setInvertVerticalLook(false));
  const lookStart = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  await page.mouse.move(center.x, center.y - 80, { steps: 2 });
  const lookUp = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (lookUp.pitch <= lookStart.pitch) throw new Error(`mouse-up must look up: ${lookStart.pitch} -> ${lookUp.pitch}`);
  await page.mouse.move(center.x, center.y + 80, { steps: 4 });
  const lookDown = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (lookDown.pitch >= lookUp.pitch) throw new Error(`mouse-down must look down: ${lookUp.pitch} -> ${lookDown.pitch}`);
  if (Math.abs(lookDown.yaw - lookStart.yaw) > 0.01) throw new Error(`vertical mouse test changed yaw: ${lookStart.yaw} -> ${lookDown.yaw}`);

  await page.mouse.down({ button: 'right' });
  await page.mouse.move(center.x, center.y - 70, { steps: 3 });
  const adsLookUp = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (!adsLookUp.ads || adsLookUp.pitch <= lookDown.pitch) throw new Error(`ADS mouse-up direction failed: ${JSON.stringify(adsLookUp)}`);
  await page.mouse.up({ button: 'right' });
  const adsAfterRelease = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (!adsAfterRelease.ads) throw new Error(`right-click ADS must remain active after release: ${JSON.stringify(adsAfterRelease)}`);
  if (adsAfterRelease.weaponVisuals.some(item => ['Optic','OpticLens','RearSight','FrontSight','TopRail'].includes(item.name) && item.active)) throw new Error(`physical sight obstructs unscoped ADS: ${JSON.stringify(adsAfterRelease.weaponVisuals)}`);
  await page.mouse.click(center.x, center.y, { button: 'right' });
  const adsToggledOff = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (adsToggledOff.ads) throw new Error(`second right click must leave ADS: ${JSON.stringify(adsToggledOff)}`);

  await page.evaluate(() => globalThis.__FPS_GAME__.setInvertVerticalLook(true));
  await page.mouse.move(center.x, center.y + 20);
  const invertedStart = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  await page.mouse.move(center.x, center.y - 70, { steps: 3 });
  const invertedUp = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (invertedUp.pitch >= invertedStart.pitch) throw new Error(`inverted mouse-up must look down: ${invertedStart.pitch} -> ${invertedUp.pitch}`);
  await page.evaluate(() => globalThis.__FPS_GAME__.setInvertVerticalLook(false));
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.move(center.x, 20);
    await page.mouse.move(center.x, viewport.height - 20);
  }
  const rapidLook = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (rapidLook.pitch < -80 || rapidLook.pitch > 80) throw new Error(`rapid vertical look escaped clamp: ${rapidLook.pitch}`);

  const beforeFire = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(310);
  await page.mouse.up({ button: 'left' });
  const afterFire = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  const spent = beforeFire.ammo.magazine - afterFire.ammo.magazine;
  if (spent < 4 || spent > 6) throw new Error(`M16 held-fire ammo did not follow 800 RPM: spent=${spent}`);
  if (Math.abs(afterFire.pitch - beforeFire.pitch) > 0.001 || afterFire.recoilPitch <= 0 || afterFire.weaponKick <= 0) throw new Error(`recoil must be separate from base aim: ${JSON.stringify({ beforeFire, afterFire })}`);
  await page.waitForTimeout(1400);
  const recoilRecovered = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (recoilRecovered.recoilPitch > 0.08 || recoilRecovered.weaponKick > 0.01) throw new Error(`recoil did not recover: ${JSON.stringify(recoilRecovered)}`);

  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(250);
  const adsState = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  await page.mouse.up({ button: 'right' });
  if (!adsState.ads || adsState.fov >= 70) throw new Error(`right mouse ADS failed: ${JSON.stringify(adsState)}`);
  const adsStillActive = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (!adsStillActive.ads) throw new Error(`ADS unexpectedly cancelled on right mouse-up: ${JSON.stringify(adsStillActive)}`);
  await page.evaluate(() => { globalThis.__FPS_GAME__.setOptic('2x'); globalThis.__FPS_GAME__.ads(true); });
  await page.waitForTimeout(350);
  const scoped = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (!scoped.scopeVisible || scoped.fov > 42) throw new Error(`2x scope overlay/magnification failed: ${JSON.stringify(scoped)}`);
  if (scoped.weaponVisuals.some(item => ['Optic','OpticLens','RearSight','FrontSight','TopRail'].includes(item.name) && item.active)) throw new Error(`physical sight obstructs scoped ADS: ${JSON.stringify(scoped.weaponVisuals)}`);
  await page.evaluate(() => { globalThis.__FPS_GAME__.ads(false); globalThis.__FPS_GAME__.setOptic('none'); });

  await page.keyboard.press('Digit2');
  let state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.weaponId !== 'glock17' || state.ammo.magazine !== 17) throw new Error(`Digit2 sidearm switch failed: ${JSON.stringify(state)}`);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(300);
  await page.mouse.up({ button: 'left' });
  state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.ammo.magazine !== 16) throw new Error(`Glock must fire once per click: ${JSON.stringify(state)}`);
  await page.keyboard.press('Digit1');

  await page.keyboard.press('KeyZ');
  state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.stance !== 'crouch') throw new Error(`Z crouch failed: ${JSON.stringify(state)}`);
  await page.keyboard.press('KeyX');
  state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.stance !== 'prone') throw new Error(`X prone failed: ${JSON.stringify(state)}`);

  const grenadeBefore = state.grenades;
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => { const s=globalThis.__FPS_GAME__.state();return s.cursorMode&&!s.pointerLocked; });
  await page.mouse.click(viewport.width * 0.865, viewport.height * 0.939);
  await page.waitForTimeout(100);
  state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.grenades !== grenadeBefore - 1 || state.activeGrenades !== 1 || !state.pointerLocked) throw new Error(`clickable grenade/relock failed: ${JSON.stringify(state)}`);
  await page.evaluate(() => globalThis.__FPS_GAME__.detonateGrenades());
  state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.activeGrenades !== 0 || state.smokePuffCount < 8 || state.smokePuffCount > 36) throw new Error(`pooled smoke explosion failed: ${JSON.stringify(state)}`);

  await page.evaluate(() => globalThis.__FPS_GAME__.teleportPlayer(10, -4, 0));
  state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (Math.abs(state.playerPosition[1] + 4) > 0.1) throw new Error(`subway floor entry failed: ${JSON.stringify(state.playerPosition)}`);

  await page.evaluate(() => globalThis.__FPS_GAME__.damagePlayer(45));
  const healthBefore = (await page.evaluate(() => globalThis.__FPS_GAME__.state())).playerHealth;
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => globalThis.__FPS_GAME__.state().cursorMode === true);
  await page.mouse.click(viewport.width * 0.95, viewport.height * 0.939);
  await page.waitForTimeout(2200);
  state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (state.playerHealth !== Math.min(100, healthBefore + 40) || state.medkits !== 0 || !state.pointerLocked) throw new Error(`clickable medical/relock failed: ${JSON.stringify(state)}`);
  if (!state.hud.ammo.includes('/') || !state.hud.grenade.includes('[G]') || !state.hud.medkit.includes('[H]')) throw new Error(`HUD labels missing: ${JSON.stringify(state.hud)}`);
  if (!state.hud.slots.includes('[1 主武器]') || !state.hud.slots.includes('[4 空投武器]') || !/\d{3}°/.test(state.hud.compass)) throw new Error(`compass/weapon slots missing: ${JSON.stringify(state.hud)}`);
  if (!state.hud.tacticalMapVisible || !state.hud.tacticalMapTitle.includes('战术地图') || state.hud.mapObstacleCount < 20) throw new Error(`tactical map missing: ${JSON.stringify(state.hud)}`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => { const s=globalThis.__FPS_GAME__.state();return s.paused&&!s.pointerLocked; }, null, { timeout: 5000 });
  await page.mouse.click(center.x, viewport.height * 0.468);
  await page.waitForFunction(() => { const s=globalThis.__FPS_GAME__.state();return !s.paused&&s.pointerLocked; }, null, { timeout: 5000 });

  if (viewport.width === 1366) {
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForFunction(() => { const s=globalThis.__FPS_GAME__.state();return s.cursorMode&&!s.pointerLocked&&!s.fireHeld&&s.heldInputCount===0; });
      await page.keyboard.press('Tab');
      await page.waitForFunction(() => globalThis.__FPS_GAME__.state().pointerLocked === true);
    }
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => { const s=globalThis.__FPS_GAME__.state();return s.paused&&!s.pointerLocked&&!s.fireHeld&&s.heldInputCount===0; });
      await page.mouse.click(center.x, viewport.height * 0.468);
      await page.waitForFunction(() => { const s=globalThis.__FPS_GAME__.state();return !s.paused&&s.pointerLocked; });
    }
    for (const quality of ['low','medium','high']) {
      await page.evaluate(value => globalThis.__FPS_GAME__.setQuality(value), quality);
      const qualityState = await page.evaluate(() => globalThis.__FPS_GAME__.state());
      if (qualityState.quality !== quality || qualityState.shadowEnabled !== (quality === 'high') || qualityState.fogEnabled !== (quality !== 'low')) throw new Error(`quality switch failed: ${JSON.stringify(qualityState)}`);
    }
    await page.evaluate(() => globalThis.__FPS_GAME__.setQuality('medium'));
    await page.evaluate(() => globalThis.__FPS_GAME__.setAmmo(1, 600));
    const firedLast = await page.evaluate(() => globalThis.__FPS_GAME__.tryFire());
    if (!firedLast) throw new Error('last round did not fire');
    await page.waitForFunction(() => globalThis.__FPS_GAME__.state().ammo.reloading === true);
    await page.waitForTimeout(120);
    const animatedReload=await page.evaluate(()=>globalThis.__FPS_GAME__.state());
    if(animatedReload.reloadAnimationTime<=0||animatedReload.activeShellCount<1||animatedReload.activeMuzzleFlashCount!==0)throw new Error(`reload/ejection/no-flash animation failed: ${JSON.stringify(animatedReload)}`);
    await page.waitForFunction(() => { const a=globalThis.__FPS_GAME__.state().ammo;return !a.reloading&&a.magazine===30&&a.reserve===570; }, null, { timeout: 5000 });

    await page.evaluate(() => globalThis.__FPS_GAME__.setAmmo(1, 5));
    await page.evaluate(() => globalThis.__FPS_GAME__.tryFire());
    await page.waitForFunction(() => { const a=globalThis.__FPS_GAME__.state().ammo;return !a.reloading&&a.magazine===5&&a.reserve===0; }, null, { timeout: 5000 });

    await page.evaluate(() => globalThis.__FPS_GAME__.setAmmo(1, 0));
    if (!await page.evaluate(() => globalThis.__FPS_GAME__.tryFire())) throw new Error('final available round did not fire');
    if (await page.evaluate(() => globalThis.__FPS_GAME__.tryFire())) throw new Error('empty weapon reported a successful shot');
    const exhausted = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    if (exhausted.ammo.magazine !== 0 || exhausted.ammo.reserve !== 0 || exhausted.ammo.reloading) throw new Error(`exhausted ammo invalid: ${JSON.stringify(exhausted.ammo)}`);

    await page.evaluate(() => globalThis.__FPS_GAME__.setAmmo(7, 33));
    await page.keyboard.press('Digit2');
    const pistolBefore = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    await page.evaluate(() => globalThis.__FPS_GAME__.tryFire());
    await page.keyboard.press('Digit1');
    const independent = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    if (pistolBefore.ammo.magazine !== 17 || independent.ammo.magazine !== 7 || independent.ammo.reserve !== 33) throw new Error(`weapon ammunition independence failed: ${JSON.stringify({pistolBefore,independent})}`);

    await page.evaluate(() => globalThis.__FPS_GAME__.restart());
    await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
    const replenished = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    if (replenished.ammo.magazine !== 30 || replenished.ammo.reserve !== 600) throw new Error(`restart did not replenish ammunition: ${JSON.stringify(replenished.ammo)}`);
  }

  if (state.capturePointCount !== 5 || state.ladderCount < 3 || state.subwayNavPointCount < 40 || state.subwayActorCount < 2 || state.firstShotLatencyMs > 5) throw new Error(`map/subway/latency invariant failed: ${JSON.stringify(state)}`);
  const canvas = page.locator('canvas').first();
  const bounds = await canvas.boundingBox();
  if (!bounds || bounds.width < viewport.width * 0.95 || bounds.height < viewport.height * 0.9) throw new Error(`canvas sizing failed: ${JSON.stringify(bounds)}`);
  await page.screenshot({ path: `test-results/web-city-${viewport.width}x${viewport.height}.png` });
  report.viewports.push({ viewport, spent, state, errors });
  if (viewport.width === 1366) {
    await page.evaluate(() => globalThis.__FPS_GAME__.setInvertVerticalLook(true));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });
    const persisted = await page.evaluate(() => globalThis.__FPS_GAME__.state().invertVerticalLook);
    if (!persisted) throw new Error('vertical inversion did not persist after reload');
    await page.evaluate(() => globalThis.__FPS_GAME__.setInvertVerticalLook(false));
  }
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => globalThis.__FPS_GAME__?.state, null, { timeout: 45000 });
  await page.evaluate(() => globalThis.__FPS_GAME__.grantXp(5000));
  for (const [team, weapon] of [['blue','m4a1'],['blue', 'mp5'], ['blue', 'm249'], ['red','ak74'],['red', 'aks74u'], ['red', 'pkm']]) {
    await page.evaluate(([selectedTeam, selectedWeapon]) => globalThis.__FPS_GAME__.start(selectedTeam, 'military-base', selectedWeapon), [team, weapon]);
    await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
    const state = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    const expected = weapon === 'm249' || weapon === 'pkm' ? { magazine: 150, reserve: 1200 } : { magazine: 30, reserve: 600 };
    if (state.weaponId !== weapon || state.map !== 'military-base' || state.capturePointCount !== 5 || state.ladderCount < 3 || state.ammo.magazine !== expected.magazine || state.ammo.reserve !== expected.reserve) throw new Error(`loadout/map/ammo failed: ${team}/${weapon} ${JSON.stringify(state)}`);
    report.weaponChecks.push({ team, weapon, magazine: state.ammo.magazine, reserve: state.ammo.reserve });
  }
  await page.evaluate(() => globalThis.__FPS_GAME__.startMission('blue', 'command-strike', 'city'));
  await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
  const commanderMapState = await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if (!commanderMapState.hud.tacticalMapVisible || commanderMapState.hud.commanderMarkerCount !== 2) throw new Error(`commander markers missing: ${JSON.stringify(commanderMapState.hud)}`);
  for (let i = 0; i < 20; i += 1) {
    await page.evaluate(() => globalThis.__FPS_GAME__.restart());
    const restartState = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    if (restartState.actorCount !== 24 || restartState.ammo.magazine !== 150 || restartState.ammo.reserve !== 1200 || restartState.ammo.reloading) throw new Error(`restart ${i+1} leaked state: ${JSON.stringify(restartState)}`);
  }
  await page.evaluate(() => globalThis.__FPS_GAME__.startBattleRoyale('city'));
  await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
  const battleRoyaleState=await page.evaluate(() => globalThis.__FPS_GAME__.state());
  if(battleRoyaleState.mission!=='battle-royale'||battleRoyaleState.actorCount!==16||battleRoyaleState.aliveActors!==16||battleRoyaleState.activeObjectiveCount!==0||battleRoyaleState.vehicleCount!==3||battleRoyaleState.activeSlot!==1)throw new Error(`battle royale setup failed: ${JSON.stringify(battleRoyaleState)}`);
  for(let i=0;i<20;i+=1){await page.evaluate(()=>globalThis.__FPS_GAME__.restart());const restarted=await page.evaluate(()=>globalThis.__FPS_GAME__.state());if(restarted.actorCount!==16||restarted.aliveActors!==16||restarted.vehicleCount!==3||restarted.activeObjectiveCount!==0)throw new Error(`battle royale restart ${i+1} leaked state: ${JSON.stringify(restarted)}`);}
  for (const [team, weapon, optic] of [['blue','m107','6x'],['blue','m200','6x'],['red','svd','4x']]) {
    await page.evaluate(([selectedTeam, selectedWeapon]) => globalThis.__FPS_GAME__.start(selectedTeam, 'city', selectedWeapon), [team, weapon]);
    await page.waitForFunction(() => globalThis.__FPS_GAME__.state().phase === 'playing', null, { timeout: 10000 });
    await page.evaluate(() => globalThis.__FPS_GAME__.ads(true));
    await page.waitForTimeout(350);
    const sniperState = await page.evaluate(() => globalThis.__FPS_GAME__.state());
    if (sniperState.weaponId !== weapon || sniperState.optic !== optic || !sniperState.scopeVisible || sniperState.fov > (optic === '6x' ? 18 : 25)) throw new Error(`built-in sniper optic failed: ${team}/${weapon}/${optic} ${JSON.stringify(sniperState)}`);
    report.weaponChecks.push({ team, weapon, optic, magazine: sniperState.ammo.magazine, reserve: sniperState.ammo.reserve });
  }
  await page.screenshot({ path: 'test-results/web-military-base.png' });
  await context.close();
}

await browser.close();
const runtimeErrors = [...report.errors, ...report.viewports.flatMap(item => item.errors)].filter(error => !error.includes('AudioContext'));
if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
fs.writeFileSync('test-results/web-desktop-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, viewports: report.viewports.length, weaponChecks: report.weaponChecks }, null, 2));

import { ActionState } from '../assets/scripts/core/ActionState';
import { createWeaponRuntime, MAP_IDS, MAP_SCENE_GROUPS, MISSION_IDS, unlockedPrimaryWeapons, WEAPONS } from '../assets/scripts/core/GameTypes';
import { defaultProfile, ProfileStore, repairProfile } from '../assets/scripts/core/ProfileStore';
import { applyExperience, consumeShot, damageAtDistance, finishReload, handlingMobility, IdempotencySet, levelFromExperience, purchaseAttachment, radialDamage, safeDelta } from '../assets/scripts/core/Rules';

let passed = 0;
function check(condition: unknown, message: string): void { if (!condition) throw new Error(message); passed += 1; }

const primaryIds = ['mp18', 'zhongzheng-shi', 'zb26', 'type24-hmg', 'type38', 'type100', 'type96-lmg', 'type92-hmg'] as const;
check(primaryIds.every(id => WEAPONS[id].weightKg > 0), 'all WWII weapons have positive weight');
check(WEAPONS['zhongzheng-shi'].team === 'red' && WEAPONS.type38.team === 'blue', 'faction weapon mapping is preserved');
check(Object.keys(WEAPONS).filter(id => id !== 'glock17').every(id => primaryIds.includes(id as typeof primaryIds[number])), 'modern primary IDs are not exposed');
check(WEAPONS['zhongzheng-shi'].magazineSize === 5 && WEAPONS.type38.magazineSize === 5, 'bolt-action rifles use five-round magazines');
check(WEAPONS.mp18.category === 'smg' && WEAPONS.type100.category === 'smg', 'SMG categories are mapped');
check(WEAPONS.zb26.category === 'lmg' && WEAPONS['type96-lmg'].category === 'lmg', 'LMG categories are mapped');
check(WEAPONS['type24-hmg'].category === 'hmg' && WEAPONS['type92-hmg'].category === 'hmg', 'HMG categories are mapped');

const rifle = WEAPONS['zhongzheng-shi'];
const gun = createWeaponRuntime('zhongzheng-shi');
check(consumeShot(gun, rifle, 0) && gun.magazine === 4, 'first rifle shot consumes one round');
check(!consumeShot(gun, rifle, 0.1), 'rifle cadence rejects an early second shot');
check(consumeShot(gun, rifle, 1.5), 'rifle cadence permits the next shot');
gun.magazine = 4; gun.reserve = 1;
check(finishReload(gun, rifle) === 1 && gun.magazine === 5 && gun.reserve === 0, 'partial reload uses only available reserve');
check(!consumeShot(gun, rifle, -Infinity), 'invalid shot time is rejected');
check(damageAtDistance(rifle, 0, false) === rifle.damageNear && damageAtDistance(rifle, 999, false) === rifle.damageFar, 'distance damage clamps to weapon range');
check(handlingMobility(WEAPONS.glock17.weightKg) > handlingMobility(WEAPONS['type92-hmg'].weightKg), 'heavier WWII weapons reduce mobility');

check(MAP_IDS.length === 16 && MAP_SCENE_GROUPS.length === 8, 'map configuration is unchanged');
check(MISSION_IDS.length === 21, 'mission configuration is unchanged');
check(unlockedPrimaryWeapons('blue', 1).join(',') === 'type38' && unlockedPrimaryWeapons('red', 1).join(',') === 'zhongzheng-shi', 'level-one defaults are WWII rifles');
check(unlockedPrimaryWeapons('blue', 9).includes('type92-hmg') && unlockedPrimaryWeapons('red', 9).includes('type24-hmg'), 'heavy weapons unlock at level nine');

const profile = defaultProfile();
check(profile.selectedPrimary.blue === 'type38' && profile.selectedPrimary.red === 'zhongzheng-shi', 'default profile selects WWII rifles');
check(profile.loadouts['type38'].optic === 'none' && !('m16' in profile.loadouts), 'default loadouts contain only WWII primaries');
check(purchaseAttachment(profile, 'red-dot') === 'purchased' && profile.coins === 400, 'attachment purchase remains functional');
const repaired = repairProfile({ version: 3, coins: 1000, selectedPrimary: { blue: 'm16', red: 'akm' }, loadouts: { m16: { optic: 'red-dot', grip: true } } });
check(repaired.selectedPrimary.blue === 'type38' && repaired.selectedPrimary.red === 'zhongzheng-shi', 'legacy faction selections migrate safely');
check(repaired.loadouts.type38.optic === 'none' && repaired.loadouts.type38.grip === false, 'legacy loadout attachments are sanitized for the WWII profile');
const stored = new Map<string, string>();
const storage = { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => { stored.set(key, value); } };
const saved = new ProfileStore(storage); saved.profile.xp = 350; saved.save();
check(stored.has('ww2-web-profile-v1') && new ProfileStore(storage).profile.level === 2, 'WWII profile uses an isolated storage key');
const progression = defaultProfile(); const result = applyExperience(progression, 350);
check(result.levels === 1 && progression.level === 2 && levelFromExperience(349) === 1, 'progression remains functional');

check(radialDamage(100, 7, 0, false) === 100 && radialDamage(100, 7, 8, false) === 0, 'explosive damage bounds remain functional');
check(safeDelta(2) === 0.05 && safeDelta(-1) === 0, 'frame delta remains clamped');
const action = new ActionState(); const token = action.begin('reload');
check(token !== null && action.begin('heal') === null && action.complete(token!), 'exclusive action state remains functional');
action.kill(); check(!action.alive && action.begin('throw') === null, 'dead actors block actions'); action.respawn(); check(action.alive, 'respawn restores action state');
const ids = new IdempotencySet(); check(ids.accept('death-1') && !ids.accept('death-1'), 'scoring idempotency remains functional');

console.log(`core tests passed: ${passed}`);

import {
  chooseTeam, safeMap, safeMission, safeName, safePrimary, safeRoomCode, sanitizePlayerState, sanitizeWorldSnapshot,
} from '../server/protocol.mjs';

let passed = 0;
function check(condition, message) { if (!condition) throw new Error(message); passed += 1; }

check(safeName('<script>玩家_01') === 'script玩家_01', 'player names are sanitized');
check(safeRoomCode(' abc234 ') === 'ABC234' && safeRoomCode('ABC10O') === 'ABC10O' && safeRoomCode('ABCDE') === '', 'custom room codes accept exactly six letters or digits');
check(safeMap('military-base') === 'military-base' && safeMap('harbor-terminal') === 'harbor-terminal' && safeMap('airport-perimeter') === 'airport-perimeter' && safeMap('invalid') === 'city', 'all map values are constrained');
check(safeMission('airborne-assault')==='airborne-assault'&&safeMission('hostage-rescue')==='hostage-rescue'&&safeMission('communications-raid')==='communications-raid'&&safeMission('evacuation-cover')==='evacuation-cover'&&safeMission('battle-royale')==='battle-royale'&&safeMission('safehouse-raid')==='safehouse-raid'&&safeMission('supply-line-disruption')==='supply-line-disruption'&&safeMission('invalid')==='conquest','expanded mission values are constrained');
check(safePrimary('blue','type38')==='type38'&&safePrimary('blue','zhongzheng-shi')==='type38'&&safePrimary('red','type100')==='zhongzheng-shi'&&safePrimary('red','zb26')==='zb26'&&safePrimary('blue','m16')==='type38'&&safePrimary('red','akm')==='zhongzheng-shi','team weapon restrictions');
check(chooseTeam({ players: [{ team: 'blue' }] }, 'blue') === 'red', 'team balancing overrides stacked preference');
check(chooseTeam({ players: Array.from({ length: 12 }, () => ({ team: 'blue' })) }, 'blue') === 'red', 'blue team cap is twelve');
check(chooseTeam({ players: Array.from({ length: 12 }, () => ({ team: 'red' })) }, 'red') === 'blue', 'red team cap is twelve');

const player = { weapon: 'zb26', activeWeapon: 'zb26' };
const state = sanitizePlayerState(player, {
  position: [999, -99, -999], yaw: Infinity, pitch: 999, stance: 'flying', weaponId: 'rpk',
  magazine: 999, reserve: 9999, ads: true, reloading: 'yes',
});
check(state.position[0] === 87 && state.position[1] === -4.2 && state.position[2] === -87, 'network position clamps include subway floor');
check(state.pitch === 80 && state.stance === 'stand' && state.magazine === 20 && state.reserve === 240, 'stance and ZB26 ammo are constrained');
check(state.ads === true && state.reloading === false, 'network booleans require exact true');
const airDropState=sanitizePlayerState(player,{position:[0,0,0],yaw:0,pitch:0,stance:'stand',weaponId:'type92-hmg',magazine:999,reserve:9999,ads:true,reloading:false});
check(airDropState.weaponId==='type92-hmg'&&airDropState.magazine===120&&airDropState.reserve===720,'Type 92 air-drop state is accepted and ammo-clamped');
const vehicleState=sanitizePlayerState(player,{position:[0,0,0],yaw:0,pitch:0,stance:'stand',weaponId:'zb26',magazine:20,reserve:240,ads:false,reloading:false,vehicleIndex:9,vehicleAmmo:900});
check(vehicleState.vehicleIndex===2&&vehicleState.vehicleAmmo===600,'vehicle seat and mounted-gun ammo are bounded');
check(sanitizePlayerState(player, { position: [1, 2] }) === null, 'malformed player state is rejected');

const actors = Array.from({ length: 30 }, (_, index) => ({
  id: `actor-${index}`, position: [index, index === 0 ? -9 : 0, 0], yaw: 0, pitch: 0, stance: 'stand',
  weaponId: index === 0 ? 'type24-hmg' : 'invalid', magazine: 999, reserve: 9999, ads: false, reloading: false,
  health: 999, alive: true, grenades: 99, medkits: 99,
}));
const snapshot = sanitizeWorldSnapshot({
  matchTime: 999, score: { blue: 2_000_000, red: -1 }, actors,
  objectives: [{ id: 'F', owner: 'blue', progress: 99 }, { id: 'A', owner: 'invalid', progress: 99 }],
  grenades: [{ id: 'g', ownerId: 'actor-0', position: [200, -99, -200], fuse: 99 }],
  vehicles:[{position:[999,5,-999],yaw:Infinity,health:999,magazine:999,active:true,occupantId:'actor-0'}],
});
check(snapshot.actors.length === 24 && snapshot.actors[0].weaponId === 'type24-hmg' && snapshot.actors[0].magazine === 100 && snapshot.actors[0].reserve === 600, 'world actors and HMG ammunition are bounded');
check(snapshot.actors[0].position[1]===-4.2&&snapshot.actors[0].health===160&&snapshot.actors[0].grenades===3,'world actor combat state is bounded');
check(snapshot.objectives.length === 1 && snapshot.objectives[0].id === 'A' && snapshot.objectives[0].owner === null && snapshot.objectives[0].progress === 8, 'world uses exactly objective IDs A-E');
check(snapshot.matchTime === 600 && snapshot.score.blue === 1_000_000 && snapshot.score.red === 0, 'world timer and scores are bounded');
check(snapshot.grenades[0].position[0] === 95 && snapshot.grenades[0].position[1] === -8 && snapshot.grenades[0].fuse === 3.5, 'grenade snapshots are bounded');
check(snapshot.vehicles.length===1&&snapshot.vehicles[0].position[0]===87&&snapshot.vehicles[0].health===520&&snapshot.vehicles[0].magazine===600,'vehicle snapshots are bounded');
check(sanitizeWorldSnapshot({}) === null, 'malformed world snapshot is rejected');

console.log(`server protocol tests passed: ${passed}`);

export const weaponAmmo = {
  m16: [30, 600],m4a1:[30,600], mp5: [30, 600], m249: [150, 1200],
  m107:[10,50],m200:[7,35],m2hb:[200,1200],
  akm: [30, 600],ak74:[30,600], aks74u: [30, 600], rpk: [75, 750], pkm: [150, 1200],svd:[10,50],kord:[200,1200],glock17: [17, 119],awm:[10,50],
};

export const teamWeapons = {
  blue:['m16','mp5','m4a1','m249','m107','m200','m2hb'],
  red:['akm','aks74u','ak74','rpk','pkm','svd','kord'],
};
export const missions = ['conquest','command-strike','airborne-assault','intel-recovery','hostage-rescue','bomb-defusal','vip-escort','arms-seizure','perimeter-sweep','encirclement','sabotage-raid','convoy-ambush','command-defense','cache-defense','battle-royale','extraction-intercept','communications-raid','corridor-denial','evacuation-cover','safehouse-raid','supply-line-disruption'];
export const maps = ['city','city-riverside','military-base','military-depot','harbor-terminal','harbor-shipyard','refinery','power-station','mountain-checkpoint','mountain-radar','desert-outpost','desert-village','forest-station','forest-depot','airport-cargo','airport-perimeter'];

export function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function clampInt(value, min, max, fallback = 0) { return Math.floor(clampNumber(value, min, max, fallback)); }
export function safeName(value) { return String(value || 'Player').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 16) || 'Player'; }
export function safeTeam(value) { return value === 'red' ? 'red' : 'blue'; }
export function safePrimary(team, value) { return teamWeapons[team].includes(value) ? value : teamWeapons[team][0]; }
export function safeWeaponForPlayer(player, value) { return Object.hasOwn(weaponAmmo,value) ? value : player.activeWeapon; }
export function safeMap(value) { return maps.includes(value) ? value : 'city'; }
export function safeMission(value) { return missions.includes(value) ? value : 'conquest'; }
export function safeMissionTeam(value) { return value === 'red' ? 'red' : 'blue'; }
export function safeRoomCode(value) { const normalized = String(value || '').trim().toUpperCase(); return /^[A-Z0-9]{6}$/.test(normalized) ? normalized : ''; }

export function chooseTeam(room, preferred) {
  const blue = room.players.filter(player => player.team === 'blue').length; const red = room.players.length - blue;
  if (preferred === 'blue' && blue < 12 && blue <= red) return 'blue';
  if (preferred === 'red' && red < 12 && red <= blue) return 'red';
  return blue <= red && blue < 12 ? 'blue' : 'red';
}

export function sanitizePlayerState(player, state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.position) || state.position.length < 3) return null;
  const weaponId = safeWeaponForPlayer(player, state.weaponId); const [magazineSize, reserveAmmo] = weaponAmmo[weaponId];
  player.activeWeapon = weaponId;
  return {
    position: [clampNumber(state.position[0], -87, 87), clampNumber(state.position[1], -4.2, 20), clampNumber(state.position[2], -87, 87)],
    yaw: clampNumber(state.yaw, -360000, 360000), pitch: clampNumber(state.pitch, -80, 80),
    stance: state.stance === 'crouch' || state.stance === 'prone' ? state.stance : 'stand', weaponId,
    magazine: clampInt(state.magazine, 0, magazineSize), reserve: clampInt(state.reserve, 0, reserveAmmo),
    ads: state.ads === true, reloading: state.reloading === true,
    climbing: state.climbing === true,
    vehicleIndex: state.vehicleIndex === null ? null : clampInt(state.vehicleIndex,-1,2,-1), vehicleAmmo:clampInt(state.vehicleAmmo,0,600,0),
  };
}

export function sanitizeWorldSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.actors) || !Array.isArray(snapshot.objectives)) return null;
  const actors = snapshot.actors.slice(0, 24).flatMap(actor => {
    if (!actor || typeof actor !== 'object' || typeof actor.id !== 'string' || !Array.isArray(actor.position)) return [];
    const weaponId = Object.hasOwn(weaponAmmo, actor.weaponId) ? actor.weaponId : 'm16'; const [magazineSize, reserveAmmo] = weaponAmmo[weaponId];
    return [{
      id: actor.id.slice(0, 40), position: [clampNumber(actor.position[0], -87, 87), clampNumber(actor.position[1], -4.2, 20), clampNumber(actor.position[2], -87, 87)],
      yaw: clampNumber(actor.yaw, -360000, 360000), pitch: clampNumber(actor.pitch, -80, 80),
      stance: actor.stance === 'crouch' || actor.stance === 'prone' ? actor.stance : 'stand', weaponId,
      magazine: clampInt(actor.magazine, 0, magazineSize), reserve: clampInt(actor.reserve, 0, reserveAmmo),
      ads: actor.ads === true, reloading: actor.reloading === true, climbing: actor.climbing === true, health: clampNumber(actor.health, 0, 160),
      alive: actor.alive === true, grenades: clampInt(actor.grenades, 0, 3), medkits: clampInt(actor.medkits, 0, 2),
    }];
  });
  const objectives = snapshot.objectives.slice(0, 5).flatMap(objective => {
    if (!objective || !['A', 'B', 'C', 'D', 'E'].includes(objective.id)) return [];
    return [{ id: objective.id, owner: objective.owner === 'blue' || objective.owner === 'red' ? objective.owner : null, progress: clampNumber(objective.progress, 0, 8) }];
  });
  const grenades = (Array.isArray(snapshot.grenades) ? snapshot.grenades : []).slice(0, 20).flatMap(grenade => {
    if (!grenade || typeof grenade.id !== 'string' || typeof grenade.ownerId !== 'string' || !Array.isArray(grenade.position)) return [];
    return [{ id: grenade.id.slice(0, 64), ownerId: grenade.ownerId.slice(0, 40), position: [clampNumber(grenade.position[0], -95, 95), clampNumber(grenade.position[1], -8, 30), clampNumber(grenade.position[2], -95, 95)], fuse: clampNumber(grenade.fuse, 0, 3.5) }];
  });
  const vehicles=(Array.isArray(snapshot.vehicles)?snapshot.vehicles:[]).slice(0,3).flatMap(vehicle=>{
    if(!vehicle||typeof vehicle!=='object'||!Array.isArray(vehicle.position))return [];
    return [{position:[clampNumber(vehicle.position[0],-87,87),0,clampNumber(vehicle.position[2],-87,87)],yaw:clampNumber(vehicle.yaw,-360000,360000),health:clampNumber(vehicle.health,0,520),magazine:clampInt(vehicle.magazine,0,600),active:vehicle.active===true,occupantId:typeof vehicle.occupantId==='string'?vehicle.occupantId.slice(0,40):null}];
  });
  return {
    matchTime: clampNumber(snapshot.matchTime, 0, 600),
    score: { blue: clampInt(snapshot.score?.blue, 0, 1_000_000), red: clampInt(snapshot.score?.red, 0, 1_000_000) },
    actors, objectives, grenades, vehicles,
  };
}

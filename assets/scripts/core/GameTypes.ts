export type Team = 'blue' | 'red';
export type PrimaryWeaponId = 'mp18' | 'zhongzheng-shi' | 'zb26' | 'type24-hmg' | 'type38' | 'type100' | 'type96-lmg' | 'type92-hmg';
export type WeaponId = PrimaryWeaponId | 'glock17';
export const MAP_IDS = [
  'city','city-riverside','military-base','military-depot',
  'harbor-terminal','harbor-shipyard','refinery','power-station',
  'mountain-checkpoint','mountain-radar','desert-outpost','desert-village',
  'forest-station','forest-depot','airport-cargo','airport-perimeter',
] as const;
export type MapId = typeof MAP_IDS[number];
export const MAP_DISPLAY_NAMES: Record<MapId,string> = {
  city:'城市中心', 'city-riverside':'滨河街区', 'military-base':'军事基地', 'military-depot':'军需仓库',
  'harbor-terminal':'港口货柜区', 'harbor-shipyard':'滨海船厂', refinery:'炼化厂区', 'power-station':'废弃电站',
  'mountain-checkpoint':'山地检查站', 'mountain-radar':'高地雷达站', 'desert-outpost':'沙漠前哨', 'desert-village':'荒漠村镇',
  'forest-station':'森林通信站', 'forest-depot':'林地补给站', 'airport-cargo':'机场货运区', 'airport-perimeter':'机场外围',
};
export const MAP_SCENE_GROUPS = [
  { id:'urban',name:'城市战区',maps:['city','city-riverside'] },
  { id:'military',name:'军事设施',maps:['military-base','military-depot'] },
  { id:'harbor',name:'港口战区',maps:['harbor-terminal','harbor-shipyard'] },
  { id:'industrial',name:'工业设施',maps:['refinery','power-station'] },
  { id:'mountain',name:'山地战区',maps:['mountain-checkpoint','mountain-radar'] },
  { id:'desert',name:'荒漠战区',maps:['desert-outpost','desert-village'] },
  { id:'forest',name:'林地战区',maps:['forest-station','forest-depot'] },
  { id:'airport',name:'机场战区',maps:['airport-cargo','airport-perimeter'] },
] as const satisfies ReadonlyArray<{id:string;name:string;maps:readonly [MapId,MapId]}>;
export function isMapId(value: unknown): value is MapId { return typeof value === 'string' && (MAP_IDS as readonly string[]).includes(value); }
export const MISSION_IDS = [
  'conquest','command-strike','airborne-assault','intel-recovery',
  'hostage-rescue','bomb-defusal','vip-escort','arms-seizure','perimeter-sweep',
  'encirclement','sabotage-raid','convoy-ambush','command-defense','cache-defense','battle-royale',
  'extraction-intercept','communications-raid','corridor-denial','evacuation-cover','safehouse-raid','supply-line-disruption',
] as const;
export type MissionId = typeof MISSION_IDS[number];
export type OpticId = 'none' | 'red-dot' | '2x' | '4x' | '6x';
export type StockId = 'none' | 'collapsible-stock' | 'folding-stock';
export type BarrelId = 'none' | 'barrel' | 'heavy-barrel' | 'precision-barrel';
export type AttachmentId = Exclude<OpticId, 'none'> | Exclude<StockId, 'none'> | Exclude<BarrelId, 'none'> | 'grip';
export type Stance = 'stand' | 'crouch' | 'prone';
export type MatchPhase = 'menu' | 'countdown' | 'playing' | 'ended';
export type ExclusiveAction = 'idle' | 'reload' | 'heal' | 'throw';

export interface Vec2Like { x: number; y: number; }

export interface PlayerSettings {
  lookSensitivity: number;
  adsSensitivity: number;
  invertVerticalLook: boolean;
  sfxVolume: number;
  quality: 'low' | 'medium' | 'high';
}

export interface WeaponLoadout { optic: OpticId; grip: boolean; stock: StockId; barrel: BarrelId; }

export interface PlayerProfileV1 {
  version: 3;
  coins: number;
  xp: number;
  level: number;
  selectedPrimary: Record<Team, PrimaryWeaponId>;
  ownedAttachments: AttachmentId[];
  loadouts: Record<WeaponId, WeaponLoadout>;
  settings: PlayerSettings;
  settledMatchIds: string[];
}

export interface WeaponDefinition {
  id: WeaponId;
  displayName: string;
  team: Team;
  weightKg: number;
  magazineSize: number;
  reserveAmmo: number;
  roundsPerMinute: number;
  reloadSeconds: number;
  damageNear: number;
  damageFar: number;
  falloffStart: number;
  falloffEnd: number;
  hipSpreadDegrees: number;
  adsSpreadDegrees: number;
  verticalRecoil: number;
  automatic: boolean;
  burstSize: number;
  category: 'rifle' | 'smg' | 'lmg' | 'sniper' | 'hmg' | 'pistol';
}

/**
 * First-person presentation hints.  Gameplay values intentionally remain in
 * WeaponDefinition; these values only describe how a viewmodel is composed.
 */
export interface WeaponViewModelProfile {
  hipPosition: readonly [number, number, number];
  adsPosition: readonly [number, number, number];
  hipRotation: readonly [number, number, number];
  adsRotation: readonly [number, number, number];
  hipScale: number;
  adsScale: number;
  reloadDrop: number;
}

export const WEAPON_VIEWMODEL_PROFILES: Partial<Record<WeaponId, WeaponViewModelProfile>> = {
  'zhongzheng-shi': {
    // Keep the rifle in the lower-right at hip fire; ADS is a separate,
    // sight-only composition and does not move a full rifle over the reticle.
    hipPosition: [0.08, -0.03, 0],
    // Parent camera offset places the sight line just below screen centre;
    // the receiver stays beneath it while the stock remains hidden.
    adsPosition: [-0.035, 0, 0.015],
    hipRotation: [-8, 0, -9],
    adsRotation: [-2, 0, -1],
    hipScale: 0.96,
    adsScale: 0.9,
    reloadDrop: -0.16,
  },
};

export interface WeaponRuntime { magazine: number; reserve: number; lastShotAt: number; reloading: boolean; }
export interface MatchReward { kills: number; completed: boolean; won: boolean; }

export const DEFAULT_SETTINGS: PlayerSettings = {
  lookSensitivity: 0.16, adsSensitivity: 0.09, invertVerticalLook: false, sfxVolume: 0.8, quality: 'medium',
};

export const DEFAULT_LOADOUT: WeaponLoadout = { optic: 'none', grip: false, stock: 'none', barrel: 'none' };

export const BUILT_IN_OPTICS: Partial<Record<WeaponId, OpticId>> = {};

export function opticForWeapon(id: WeaponId, equipped: OpticId): OpticId {
  return BUILT_IN_OPTICS[id] || equipped;
}

export const ATTACHMENT_PRICES: Record<AttachmentId, number> = {
  'red-dot': 600, '2x': 900, '4x': 1500, '6x': 2300,
  grip: 800, 'collapsible-stock': 1000, 'folding-stock': 1200,
  barrel: 900, 'heavy-barrel': 1600, 'precision-barrel': 2200,
};

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  mp18: { id:'mp18', displayName:'MP18 冲锋枪', team:'red', weightKg:4.2, magazineSize:32, reserveAmmo:320, roundsPerMinute:500, reloadSeconds:2.8, damageNear:30, damageFar:17, falloffStart:18, falloffEnd:62, hipSpreadDegrees:1.7, adsSpreadDegrees:0.24, verticalRecoil:0.64, automatic:true, burstSize:1, category:'smg' },
  'zhongzheng-shi': { id:'zhongzheng-shi', displayName:'中正式步枪', team:'red', weightKg:4.1, magazineSize:5, reserveAmmo:120, roundsPerMinute:42, reloadSeconds:2.7, damageNear:68, damageFar:46, falloffStart:55, falloffEnd:155, hipSpreadDegrees:2.3, adsSpreadDegrees:0.08, verticalRecoil:1.38, automatic:false, burstSize:1, category:'rifle' },
  zb26: { id:'zb26', displayName:'ZB26 轻机枪', team:'red', weightKg:8.8, magazineSize:20, reserveAmmo:240, roundsPerMinute:550, reloadSeconds:3.2, damageNear:39, damageFar:25, falloffStart:42, falloffEnd:115, hipSpreadDegrees:2.35, adsSpreadDegrees:0.25, verticalRecoil:0.92, automatic:true, burstSize:1, category:'lmg' },
  'type24-hmg': { id:'type24-hmg', displayName:'二四式重机枪', team:'red', weightKg:26, magazineSize:100, reserveAmmo:600, roundsPerMinute:500, reloadSeconds:6.2, damageNear:58, damageFar:37, falloffStart:55, falloffEnd:145, hipSpreadDegrees:3.1, adsSpreadDegrees:0.35, verticalRecoil:1.45, automatic:true, burstSize:1, category:'hmg' },
  type38: { id:'type38', displayName:'三八式步枪', team:'blue', weightKg:3.9, magazineSize:5, reserveAmmo:120, roundsPerMinute:40, reloadSeconds:2.6, damageNear:65, damageFar:44, falloffStart:58, falloffEnd:160, hipSpreadDegrees:2.2, adsSpreadDegrees:0.08, verticalRecoil:1.34, automatic:false, burstSize:1, category:'rifle' },
  type100: { id:'type100', displayName:'一〇〇式冲锋枪', team:'blue', weightKg:4.0, magazineSize:30, reserveAmmo:300, roundsPerMinute:450, reloadSeconds:2.7, damageNear:29, damageFar:16, falloffStart:18, falloffEnd:60, hipSpreadDegrees:1.8, adsSpreadDegrees:0.25, verticalRecoil:0.7, automatic:true, burstSize:1, category:'smg' },
  'type96-lmg': { id:'type96-lmg', displayName:'九六式轻机枪', team:'blue', weightKg:9.0, magazineSize:30, reserveAmmo:360, roundsPerMinute:550, reloadSeconds:3.5, damageNear:38, damageFar:24, falloffStart:44, falloffEnd:118, hipSpreadDegrees:2.4, adsSpreadDegrees:0.26, verticalRecoil:0.96, automatic:true, burstSize:1, category:'lmg' },
  'type92-hmg': { id:'type92-hmg', displayName:'九二式重机枪', team:'blue', weightKg:27, magazineSize:120, reserveAmmo:720, roundsPerMinute:450, reloadSeconds:6.5, damageNear:57, damageFar:36, falloffStart:58, falloffEnd:150, hipSpreadDegrees:3.2, adsSpreadDegrees:0.36, verticalRecoil:1.5, automatic:true, burstSize:1, category:'hmg' },
  glock17: {
    id: 'glock17', displayName: '制式手枪', team: 'blue', weightKg: 0.71, magazineSize: 17, reserveAmmo: 119,
    roundsPerMinute: 420, reloadSeconds: 1.55, damageNear: 23, damageFar: 13,
    falloffStart: 15, falloffEnd: 48, hipSpreadDegrees: 1.55, adsSpreadDegrees: 0.3,
    verticalRecoil: 0.48, automatic: false, burstSize: 1, category: 'pistol',
  },
};

export const PRIMARY_WEAPONS: Record<Team, PrimaryWeaponId[]> = {
  blue: ['type38','type100','type96-lmg','type92-hmg'],
  red: ['zhongzheng-shi','mp18','zb26','type24-hmg'],
};

export const WEAPON_UNLOCK_LEVEL: Record<PrimaryWeaponId, number> = {
  type38:1, 'zhongzheng-shi':1, type100:2, mp18:2, 'type96-lmg':5, zb26:5, 'type92-hmg':9, 'type24-hmg':9,
};

export function unlockedPrimaryWeapons(team: Team, level: number): PrimaryWeaponId[] {
  const unlocked = PRIMARY_WEAPONS[team].filter(id => level >= WEAPON_UNLOCK_LEVEL[id]);
  return unlocked.length > 0 ? unlocked : [PRIMARY_WEAPONS[team][0]];
}

export function createWeaponRuntime(id: WeaponId): WeaponRuntime {
  const def = WEAPONS[id];
  return { magazine: def.magazineSize, reserve: def.reserveAmmo, lastShotAt: -Infinity, reloading: false };
}

export function oppositeTeam(team: Team): Team { return team === 'blue' ? 'red' : 'blue'; }

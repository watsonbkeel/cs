export type Team = 'blue' | 'red';
export type PrimaryWeaponId = 'm16' | 'm4a1' | 'mp5' | 'm249' | 'm107' | 'm200' | 'm2hb' | 'akm' | 'ak74' | 'aks74u' | 'rpk' | 'pkm' | 'svd' | 'kord';
export type WeaponId = PrimaryWeaponId | 'glock17' | 'awm';
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

export interface WeaponRuntime { magazine: number; reserve: number; lastShotAt: number; reloading: boolean; }
export interface MatchReward { kills: number; completed: boolean; won: boolean; }

export const DEFAULT_SETTINGS: PlayerSettings = {
  lookSensitivity: 0.16, adsSensitivity: 0.09, invertVerticalLook: false, sfxVolume: 0.8, quality: 'medium',
};

export const DEFAULT_LOADOUT: WeaponLoadout = { optic: 'none', grip: false, stock: 'none', barrel: 'none' };

export const BUILT_IN_OPTICS: Partial<Record<WeaponId, OpticId>> = {
  svd: '4x', awm: '4x',
  m107: '6x',
  m200: '6x',
};

export function opticForWeapon(id: WeaponId, equipped: OpticId): OpticId {
  return BUILT_IN_OPTICS[id] || equipped;
}

export const ATTACHMENT_PRICES: Record<AttachmentId, number> = {
  'red-dot': 600, '2x': 900, '4x': 1500, '6x': 2300,
  grip: 800, 'collapsible-stock': 1000, 'folding-stock': 1200,
  barrel: 900, 'heavy-barrel': 1600, 'precision-barrel': 2200,
};

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  m16: {
    id: 'm16', displayName: 'M16', team: 'blue', weightKg: 3.4, magazineSize: 30, reserveAmmo: 600,
    roundsPerMinute: 800, reloadSeconds: 2.4, damageNear: 32, damageFar: 21,
    falloffStart: 38, falloffEnd: 105, hipSpreadDegrees: 1.65, adsSpreadDegrees: 0.16,
    verticalRecoil: 0.68, automatic: true, burstSize: 1, category: 'rifle',
  },
  m4a1: {
    id:'m4a1',displayName:'M4A1',team:'blue',weightKg:3.1,magazineSize:30,reserveAmmo:600,
    roundsPerMinute:800,reloadSeconds:2.25,damageNear:30,damageFar:19,
    falloffStart:32,falloffEnd:92,hipSpreadDegrees:1.48,adsSpreadDegrees:0.15,
    verticalRecoil:0.61,automatic:true,burstSize:1,category:'rifle',
  },
  mp5: {
    id: 'mp5', displayName: 'MP5', team: 'blue', weightKg: 2.9, magazineSize: 30, reserveAmmo: 600,
    roundsPerMinute: 800, reloadSeconds: 1.95, damageNear: 24, damageFar: 13,
    falloffStart: 18, falloffEnd: 58, hipSpreadDegrees: 1.35, adsSpreadDegrees: 0.2,
    verticalRecoil: 0.42, automatic: true, burstSize: 1, category: 'smg',
  },
  m249: {
    id: 'm249', displayName: 'M249', team: 'blue', weightKg: 7.5, magazineSize: 150, reserveAmmo: 1200,
    roundsPerMinute: 750, reloadSeconds: 4.8, damageNear: 34, damageFar: 23,
    falloffStart: 42, falloffEnd: 115, hipSpreadDegrees: 2.25, adsSpreadDegrees: 0.28,
    verticalRecoil: 0.86, automatic: true, burstSize: 1, category: 'lmg',
  },
  m107: {
    id:'m107',displayName:'Barrett M107',team:'blue',weightKg:13.6,magazineSize:10,reserveAmmo:50,
    roundsPerMinute:55,reloadSeconds:5.3,damageNear:190,damageFar:145,
    falloffStart:82,falloffEnd:175,hipSpreadDegrees:4.2,adsSpreadDegrees:0.055,
    verticalRecoil:2.25,automatic:false,burstSize:1,category:'sniper',
  },
  m200: {
    id:'m200',displayName:'M200',team:'blue',weightKg:14,magazineSize:7,reserveAmmo:35,
    roundsPerMinute:42,reloadSeconds:5.5,damageNear:145,damageFar:125,
    falloffStart:115,falloffEnd:240,hipSpreadDegrees:4.5,adsSpreadDegrees:0.035,
    verticalRecoil:1.85,automatic:false,burstSize:1,category:'sniper',
  },
  awm: {
    id:'awm',displayName:'AWM',team:'blue',weightKg:6.9,magazineSize:10,reserveAmmo:50,
    roundsPerMinute:48,reloadSeconds:5.2,damageNear:185,damageFar:155,
    falloffStart:140,falloffEnd:260,hipSpreadDegrees:4.5,adsSpreadDegrees:0.028,
    verticalRecoil:2.05,automatic:false,burstSize:1,category:'sniper',
  },
  m2hb: {
    id:'m2hb',displayName:'M2HB',team:'blue',weightKg:38,magazineSize:200,reserveAmmo:1200,
    roundsPerMinute:650,reloadSeconds:7.2,damageNear:178,damageFar:100,
    falloffStart:55,falloffEnd:130,hipSpreadDegrees:3.1,adsSpreadDegrees:0.32,
    verticalRecoil:1.55,automatic:true,burstSize:1,category:'hmg',
  },
  akm: {
    id: 'akm', displayName: 'AKM', team: 'red', weightKg: 3.3, magazineSize: 30, reserveAmmo: 600,
    roundsPerMinute: 600, reloadSeconds: 2.55, damageNear: 39, damageFar: 26,
    falloffStart: 30, falloffEnd: 80, hipSpreadDegrees: 2.2, adsSpreadDegrees: 0.24,
    verticalRecoil: 1.05, automatic: true, burstSize: 1, category: 'rifle',
  },
  ak74: {
    id:'ak74',displayName:'AK-74',team:'red',weightKg:3.3,magazineSize:30,reserveAmmo:600,
    roundsPerMinute:650,reloadSeconds:2.35,damageNear:31,damageFar:20,
    falloffStart:36,falloffEnd:100,hipSpreadDegrees:1.62,adsSpreadDegrees:0.17,
    verticalRecoil:0.65,automatic:true,burstSize:1,category:'rifle',
  },
  aks74u: {
    id: 'aks74u', displayName: 'AKS-74U', team: 'red', weightKg: 2.7, magazineSize: 30, reserveAmmo: 600,
    roundsPerMinute: 800, reloadSeconds: 2.05, damageNear: 27, damageFar: 16,
    falloffStart: 22, falloffEnd: 68, hipSpreadDegrees: 1.65, adsSpreadDegrees: 0.22,
    verticalRecoil: 0.62, automatic: true, burstSize: 1, category: 'smg',
  },
  rpk: {
    id: 'rpk', displayName: 'RPK', team: 'red', weightKg: 4.8, magazineSize: 75, reserveAmmo: 750,
    roundsPerMinute: 600, reloadSeconds: 4.1, damageNear: 40, damageFar: 27,
    falloffStart: 38, falloffEnd: 105, hipSpreadDegrees: 2.05, adsSpreadDegrees: 0.27,
    verticalRecoil: 0.9, automatic: true, burstSize: 1, category: 'lmg',
  },
  pkm: {
    id: 'pkm', displayName: 'PKM', team: 'red', weightKg: 7.5, magazineSize: 150, reserveAmmo: 1200,
    roundsPerMinute: 700, reloadSeconds: 5, damageNear: 49, damageFar: 34,
    falloffStart: 45, falloffEnd: 120, hipSpreadDegrees: 2.5, adsSpreadDegrees: 0.3,
    verticalRecoil: 1.12, automatic: true, burstSize: 1, category: 'lmg',
  },
  svd: {
    id:'svd',displayName:'SVD',team:'red',weightKg:4.3,magazineSize:10,reserveAmmo:50,
    roundsPerMinute:180,reloadSeconds:5.1,damageNear:65,damageFar:48,
    falloffStart:65,falloffEnd:145,hipSpreadDegrees:3.4,adsSpreadDegrees:0.09,
    verticalRecoil:1.25,automatic:false,burstSize:1,category:'sniper',
  },
  kord: {
    id:'kord',displayName:'KORD',team:'red',weightKg:25.5,magazineSize:200,reserveAmmo:1200,
    roundsPerMinute:700,reloadSeconds:6.7,damageNear:165,damageFar:92,
    falloffStart:48,falloffEnd:118,hipSpreadDegrees:2.8,adsSpreadDegrees:0.3,
    verticalRecoil:1.42,automatic:true,burstSize:1,category:'hmg',
  },
  glock17: {
    id: 'glock17', displayName: 'Glock 17', team: 'blue', weightKg: 0.71, magazineSize: 17, reserveAmmo: 119,
    roundsPerMinute: 420, reloadSeconds: 1.55, damageNear: 23, damageFar: 13,
    falloffStart: 15, falloffEnd: 48, hipSpreadDegrees: 1.55, adsSpreadDegrees: 0.3,
    verticalRecoil: 0.48, automatic: false, burstSize: 1, category: 'pistol',
  },
};

export const PRIMARY_WEAPONS: Record<Team, PrimaryWeaponId[]> = {
  blue: ['m16','mp5','m4a1','m249','m107','m200','m2hb'],
  red: ['akm','aks74u','ak74','rpk','pkm','svd','kord'],
};

export const WEAPON_UNLOCK_LEVEL: Record<PrimaryWeaponId, number> = {
  m16:1,akm:1,mp5:2,aks74u:2,m4a1:3,ak74:3,rpk:4,m249:5,pkm:6,svd:7,m107:8,m200:10,kord:11,m2hb:13,
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

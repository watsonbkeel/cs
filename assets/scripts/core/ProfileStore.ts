import { AttachmentId, BarrelId, BUILT_IN_OPTICS, DEFAULT_LOADOUT, DEFAULT_SETTINGS, OpticId, PlayerProfileV1, PRIMARY_WEAPONS, PrimaryWeaponId, StockId, Team, WEAPON_UNLOCK_LEVEL, WeaponId, WeaponLoadout } from './GameTypes';
import { clamp, experienceForLevel, levelFromExperience } from './Rules';

const STORAGE_KEY = 'ww2-web-profile-v1';
const LEGACY_STORAGE_KEY = 'wechat-tactical-fps-profile-v1';
const LEGACY_WEAPON_MAP: Record<string, PrimaryWeaponId> = {
  m16: 'type38', m4a1: 'type38', mp5: 'type100', m249: 'type96-lmg', m107: 'type38', m200: 'type38', m2hb: 'type92-hmg',
  akm: 'zhongzheng-shi', ak74: 'zhongzheng-shi', aks74u: 'mp18', rpk: 'zb26', pkm: 'type24-hmg', svd: 'zhongzheng-shi', kord: 'type24-hmg',
};
const ATTACHMENTS: AttachmentId[] = [
  'red-dot', '2x', '4x', '6x', 'grip', 'collapsible-stock', 'folding-stock',
  'barrel', 'heavy-barrel', 'precision-barrel',
];
export interface KeyValueStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void; }

export function defaultProfile(): PlayerProfileV1 {
  return {
    version: 3, coins: 1000, xp: 0, level: 1, selectedPrimary:{blue:'type38',red:'zhongzheng-shi'}, ownedAttachments: [],
    loadouts: {
      mp18:{...DEFAULT_LOADOUT},'zhongzheng-shi':{...DEFAULT_LOADOUT},zb26:{...DEFAULT_LOADOUT},'type24-hmg':{...DEFAULT_LOADOUT},
      type38:{...DEFAULT_LOADOUT},type100:{...DEFAULT_LOADOUT},'type96-lmg':{...DEFAULT_LOADOUT},'type92-hmg':{...DEFAULT_LOADOUT},
      glock17: { ...DEFAULT_LOADOUT },
    },
    settings: { ...DEFAULT_SETTINGS }, settledMatchIds: [],
  };
}

function cleanLoadout(value: unknown, owned: AttachmentId[], weaponId: WeaponId): WeaponLoadout {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const opticIds: OpticId[] = ['none', 'red-dot', '2x', '4x', '6x'];
  const stockIds: StockId[] = ['none', 'collapsible-stock', 'folding-stock'];
  const barrelIds: BarrelId[] = ['none', 'barrel', 'heavy-barrel', 'precision-barrel'];
  const requestedOptic = opticIds.includes(raw.optic as OpticId) ? raw.optic as OpticId : 'none';
  const requestedStock = stockIds.includes(raw.stock as StockId) ? raw.stock as StockId : 'none';
  const migratedBarrel = raw.barrel === true ? 'barrel' : raw.barrel;
  const requestedBarrel = barrelIds.includes(migratedBarrel as BarrelId) ? migratedBarrel as BarrelId : 'none';
  const optic = BUILT_IN_OPTICS[weaponId] || (requestedOptic !== 'none' && !owned.includes(requestedOptic) ? 'none' : requestedOptic);
  const stock = requestedStock !== 'none' && !owned.includes(requestedStock) ? 'none' : requestedStock;
  const barrel = requestedBarrel !== 'none' && !owned.includes(requestedBarrel) ? 'none' : requestedBarrel;
  return { optic, grip: raw.grip === true && owned.includes('grip'), stock, barrel };
}

export function repairProfile(value: unknown): PlayerProfileV1 {
  if (!value || typeof value !== 'object') return defaultProfile();
  const raw = value as Record<string, any>;
  const owned = Array.isArray(raw.ownedAttachments)
    ? Array.from(new Set(raw.ownedAttachments.filter((item: unknown): item is AttachmentId => ATTACHMENTS.includes(item as AttachmentId))))
    : [];
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const quality = settings.quality === 'low' || settings.quality === 'high' ? settings.quality : 'medium';
  const migratedXp = Number.isFinite(raw.xp) ? Math.max(0, Math.floor(raw.xp)) : experienceForLevel(Number(raw.level) || 1);
  const level = levelFromExperience(migratedXp);
  const selectedPrimary=(team:Team,fallback:PrimaryWeaponId):PrimaryWeaponId=>{
    const saved=raw.selectedPrimary?.[team] as string;
    const requested=(LEGACY_WEAPON_MAP[saved] || saved) as PrimaryWeaponId;
    return PRIMARY_WEAPONS[team].includes(requested)&&level>=WEAPON_UNLOCK_LEVEL[requested]?requested:fallback;
  };
  const settledMatchIds = Array.isArray(raw.settledMatchIds)
    ? raw.settledMatchIds.filter((id: unknown): id is string => typeof id === 'string').slice(-30) : [];
  // A previous web build shipped with 1500 coins. Correct only that untouched
  // starter profile; earned currency and purchased inventory remain intact.
  const legacyUntouchedBalance = (raw.version === 2 || raw.version === 3) && raw.coins === 1500 && migratedXp === 0
    && owned.length === 0 && settledMatchIds.length === 0;
  return {
    version: 3,
    coins: legacyUntouchedBalance ? 1000 : clamp(Number.isFinite(raw.coins) ? Math.floor(raw.coins) : 1000, 0, 99999999),
    xp: migratedXp,
    level,
    selectedPrimary:{blue:selectedPrimary('blue','type38'),red:selectedPrimary('red','zhongzheng-shi')},
    ownedAttachments: owned,
    loadouts: {
      mp18:cleanLoadout(raw.loadouts?.mp18 ?? raw.loadouts?.aks74u,owned,'mp18'),
      'zhongzheng-shi':cleanLoadout(raw.loadouts?.['zhongzheng-shi'] ?? raw.loadouts?.akm,owned,'zhongzheng-shi'),
      zb26:cleanLoadout(raw.loadouts?.zb26 ?? raw.loadouts?.rpk,owned,'zb26'),
      'type24-hmg':cleanLoadout(raw.loadouts?.['type24-hmg'] ?? raw.loadouts?.pkm,owned,'type24-hmg'),
      type38:cleanLoadout(raw.loadouts?.type38 ?? raw.loadouts?.m16,owned,'type38'),
      type100:cleanLoadout(raw.loadouts?.type100 ?? raw.loadouts?.mp5,owned,'type100'),
      'type96-lmg':cleanLoadout(raw.loadouts?.['type96-lmg'] ?? raw.loadouts?.m249,owned,'type96-lmg'),
      'type92-hmg':cleanLoadout(raw.loadouts?.['type92-hmg'] ?? raw.loadouts?.m2hb,owned,'type92-hmg'),
      glock17: cleanLoadout(raw.loadouts?.glock17, owned,'glock17'),
    },
    settings: {
      lookSensitivity: clamp(Number(settings.lookSensitivity) || DEFAULT_SETTINGS.lookSensitivity, 0.04, 0.5),
      adsSensitivity: clamp(Number(settings.adsSensitivity) || DEFAULT_SETTINGS.adsSensitivity, 0.02, 0.3),
      invertVerticalLook: settings.invertVerticalLook === true,
      sfxVolume: clamp(Number.isFinite(Number(settings.sfxVolume)) ? Number(settings.sfxVolume) : 0.8, 0, 1),
      quality,
    },
    settledMatchIds,
  };
}

export class ProfileStore {
  public profile: PlayerProfileV1;
  constructor(private readonly storage: KeyValueStorage) { this.profile = this.load(); }
  public load(): PlayerProfileV1 {
    try {
      const serialized = this.storage.getItem(STORAGE_KEY) || this.storage.getItem(LEGACY_STORAGE_KEY);
      return serialized ? repairProfile(JSON.parse(serialized)) : defaultProfile();
    }
    catch { return defaultProfile(); }
  }
  public save(): void { this.profile = repairProfile(this.profile); this.storage.setItem(STORAGE_KEY, JSON.stringify(this.profile)); }
  public reset(): PlayerProfileV1 {
    this.profile = defaultProfile();
    this.storage.removeItem?.(LEGACY_STORAGE_KEY);
    this.save();
    return this.profile;
  }
  public equip(weapon: WeaponId, id: AttachmentId, enabled: boolean): boolean {
    if (BUILT_IN_OPTICS[weapon] && (id === 'red-dot' || id === '2x' || id === '4x' || id === '6x')) return false;
    if (!this.profile.ownedAttachments.includes(id)) return false;
    const target = this.profile.loadouts[weapon];
    if (id === 'red-dot' || id === '2x' || id === '4x' || id === '6x') target.optic = enabled ? id : 'none';
    else if (id === 'collapsible-stock' || id === 'folding-stock') target.stock = enabled ? id : 'none';
    else if (id === 'barrel' || id === 'heavy-barrel' || id === 'precision-barrel') target.barrel = enabled ? id : 'none';
    else target.grip = enabled;
    this.save(); return true;
  }
}

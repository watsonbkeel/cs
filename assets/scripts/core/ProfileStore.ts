import { AttachmentId, BarrelId, BUILT_IN_OPTICS, DEFAULT_LOADOUT, DEFAULT_SETTINGS, OpticId, PlayerProfileV1, PRIMARY_WEAPONS, PrimaryWeaponId, StockId, Team, WEAPON_UNLOCK_LEVEL, WeaponId, WeaponLoadout } from './GameTypes';
import { clamp, experienceForLevel, levelFromExperience } from './Rules';

const STORAGE_KEY = 'ww2-web-profile-v1';
const LEGACY_STORAGE_KEY = 'wechat-tactical-fps-profile-v1';
const ATTACHMENTS: AttachmentId[] = [
  'red-dot', '2x', '4x', '6x', 'grip', 'collapsible-stock', 'folding-stock',
  'barrel', 'heavy-barrel', 'precision-barrel',
];
export interface KeyValueStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void; }

export function defaultProfile(): PlayerProfileV1 {
  return {
    version: 3, coins: 1000, xp: 0, level: 1, selectedPrimary:{blue:'m16',red:'akm'}, ownedAttachments: [],
    loadouts: {
      m16:{...DEFAULT_LOADOUT},m4a1:{...DEFAULT_LOADOUT},mp5:{...DEFAULT_LOADOUT},m249:{...DEFAULT_LOADOUT},m107:{...DEFAULT_LOADOUT,optic:'6x'},m200:{...DEFAULT_LOADOUT,optic:'6x'},m2hb:{...DEFAULT_LOADOUT},
      akm:{...DEFAULT_LOADOUT},ak74:{...DEFAULT_LOADOUT},aks74u:{...DEFAULT_LOADOUT},rpk:{...DEFAULT_LOADOUT},pkm:{...DEFAULT_LOADOUT},svd:{...DEFAULT_LOADOUT,optic:'4x'},kord:{...DEFAULT_LOADOUT},
      glock17: { ...DEFAULT_LOADOUT }, awm: { ...DEFAULT_LOADOUT, optic: '4x' },
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
    const requested=raw.selectedPrimary?.[team] as PrimaryWeaponId;
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
    selectedPrimary:{blue:selectedPrimary('blue','m16'),red:selectedPrimary('red','akm')},
    ownedAttachments: owned,
    loadouts: {
      m16:cleanLoadout(raw.loadouts?.m16,owned,'m16'),m4a1:cleanLoadout(raw.loadouts?.m4a1,owned,'m4a1'),mp5:cleanLoadout(raw.loadouts?.mp5,owned,'mp5'),m249:cleanLoadout(raw.loadouts?.m249,owned,'m249'),
      m107:cleanLoadout(raw.loadouts?.m107,owned,'m107'),m200:cleanLoadout(raw.loadouts?.m200,owned,'m200'),m2hb:cleanLoadout(raw.loadouts?.m2hb,owned,'m2hb'),akm:cleanLoadout(raw.loadouts?.akm,owned,'akm'),
      ak74:cleanLoadout(raw.loadouts?.ak74,owned,'ak74'),aks74u: cleanLoadout(raw.loadouts?.aks74u, owned,'aks74u'), rpk: cleanLoadout(raw.loadouts?.rpk, owned,'rpk'),
      pkm:cleanLoadout(raw.loadouts?.pkm,owned,'pkm'),svd:cleanLoadout(raw.loadouts?.svd,owned,'svd'),kord:cleanLoadout(raw.loadouts?.kord,owned,'kord'),
      glock17: cleanLoadout(raw.loadouts?.glock17, owned,'glock17'), awm:cleanLoadout(raw.loadouts?.awm,owned,'awm'),
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

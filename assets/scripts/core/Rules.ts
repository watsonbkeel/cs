import { ATTACHMENT_PRICES, AttachmentId, MatchReward, PlayerProfileV1, WeaponDefinition, WeaponRuntime } from './GameTypes';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function safeDelta(deltaSeconds: number): number {
  return clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
}

export function handlingMobility(weightKg: number): number {
  return clamp(1.04 - Math.max(0, Number.isFinite(weightKg) ? weightKg : 0) * 0.017, 0.55, 1.02);
}

export function aiCombatSkill(index: number, opponent: boolean, factionSalt = 0): number {
  const safeIndex=Math.max(0,Math.floor(Number.isFinite(index)?index:0));
  const safeSalt=Math.max(0,Math.floor(Number.isFinite(factionSalt)?factionSalt:0));
  const variation=((safeIndex*17+safeSalt)%11)/100;
  return clamp((opponent?0.919:0.84)+variation,0.82,opponent?0.979:0.94);
}

export function applyVerticalLook(pitch: number, deltaY: number, sensitivity: number, inverted: boolean): number {
  const direction = inverted ? -1 : 1;
  return clamp(pitch + deltaY * sensitivity * direction, -80, 80);
}

export function stepCriticalSpring(position: number, velocity: number, angularFrequency: number, deltaSeconds: number): { position: number; velocity: number } {
  const dt = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
  const omega = Math.max(0.001, angularFrequency);
  const decay = Math.exp(-omega * dt);
  const c2 = velocity + omega * position;
  return {
    position: (position + c2 * dt) * decay,
    velocity: (velocity - c2 * omega * dt) * decay,
  };
}

export function canFire(runtime: WeaponRuntime, weapon: WeaponDefinition, nowSeconds: number): boolean {
  if (runtime.reloading || runtime.magazine <= 0) return false;
  return nowSeconds - runtime.lastShotAt + 1e-6 >= 60 / weapon.roundsPerMinute;
}

export function consumeShot(runtime: WeaponRuntime, weapon: WeaponDefinition, nowSeconds: number): boolean {
  if (!canFire(runtime, weapon, nowSeconds)) return false;
  runtime.magazine = Math.max(0, runtime.magazine - 1);
  runtime.lastShotAt = nowSeconds;
  return true;
}

export function finishReload(runtime: WeaponRuntime, weapon: WeaponDefinition): number {
  const needed = Math.max(0, weapon.magazineSize - runtime.magazine);
  const moved = Math.min(needed, Math.max(0, runtime.reserve));
  runtime.magazine = Math.max(0, runtime.magazine + moved);
  runtime.reserve = Math.max(0, runtime.reserve - moved);
  runtime.reloading = false;
  return moved;
}

export function damageAtDistance(weapon: WeaponDefinition, distance: number, barrel: boolean): number {
  const scale = barrel ? 1.15 : 1;
  const start = weapon.falloffStart * scale;
  const end = weapon.falloffEnd * scale;
  const t = clamp((Math.max(0, distance) - start) / Math.max(0.001, end - start), 0, 1);
  return weapon.damageNear + (weapon.damageFar - weapon.damageNear) * t;
}

export function experienceForLevel(level: number): number {
  const steps = Math.max(0, Math.floor(level) - 1);
  return 350 * steps + 125 * steps * Math.max(0, steps - 1);
}

export function levelFromExperience(experience: number): number {
  const xp = Math.max(0, Math.floor(Number.isFinite(experience) ? experience : 0));
  let level = 1;
  while (level < 50 && xp >= experienceForLevel(level + 1)) level += 1;
  return level;
}

export function rewardExperience(reward: MatchReward): number {
  return Math.max(0, Math.floor(reward.kills)) * 50 + (reward.completed ? 250 : 0) + (reward.won ? 150 : 0);
}

export function applyExperience(profile: PlayerProfileV1, amount: number): { gained: number; levels: number; coinReward: number } {
  const gained = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  const previousLevel = levelFromExperience(profile.xp);
  profile.xp = Math.max(0, profile.xp + gained);
  profile.level = levelFromExperience(profile.xp);
  let coinReward = 0;
  for (let level = previousLevel + 1; level <= profile.level; level += 1) coinReward += 150 + level * 50;
  profile.coins += coinReward;
  return { gained, levels: profile.level - previousLevel, coinReward };
}

export function radialDamage(maxDamage: number, radius: number, distance: number, occluded: boolean): number {
  if (distance >= radius || radius <= 0) return 0;
  return maxDamage * (1 - clamp(distance / radius, 0, 1)) * (occluded ? 0.2 : 1);
}

export function purchaseAttachment(profile: PlayerProfileV1, id: AttachmentId): 'purchased' | 'owned' | 'insufficient' {
  if (profile.ownedAttachments.includes(id)) return 'owned';
  const price = ATTACHMENT_PRICES[id];
  if (!Number.isFinite(profile.coins) || profile.coins < price) return 'insufficient';
  profile.coins = Math.max(0, Math.floor(profile.coins - price));
  profile.ownedAttachments.push(id);
  return 'purchased';
}

export function rewardCoins(reward: MatchReward): number {
  return Math.max(0, Math.floor(reward.kills)) * 20 + (reward.completed ? 200 : 0) + (reward.won ? 100 : 0);
}

export class IdempotencySet {
  private readonly seen = new Set<string>();
  public accept(id: string): boolean { if (!id || this.seen.has(id)) return false; this.seen.add(id); return true; }
  public clear(): void { this.seen.clear(); }
}

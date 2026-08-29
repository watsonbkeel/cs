import { ExclusiveAction, Stance } from './GameTypes';

export class ActionState {
  public alive = true;
  public ads = false;
  public stance: Stance = 'stand';
  public exclusive: ExclusiveAction = 'idle';
  private token = 0;
  public begin(action: Exclude<ExclusiveAction, 'idle'>): number | null {
    if (!this.alive || this.exclusive !== 'idle') return null;
    if (action === 'throw') this.ads = false;
    this.exclusive = action; this.token += 1; return this.token;
  }
  public complete(token: number): boolean { if (token !== this.token || this.exclusive === 'idle') return false; this.exclusive = 'idle'; return true; }
  public cancel(): void { this.token += 1; this.exclusive = 'idle'; }
  public kill(): void { this.alive = false; this.ads = false; this.stance = 'stand'; this.cancel(); }
  public respawn(): void { this.alive = true; this.ads = false; this.stance = 'stand'; this.cancel(); }
}

import { isMapId, MapId, MissionId, PrimaryWeaponId, Stance, Team, WeaponId } from './GameTypes';

export interface RoomPlayer {
  id: string;
  name: string;
  team: Team;
  weapon: PrimaryWeaponId;
}

export interface RemotePlayerState {
  position: [number, number, number];
  yaw: number;
  pitch: number;
  stance: Stance;
  weaponId: WeaponId;
  magazine: number;
  reserve: number;
  ads: boolean;
  reloading: boolean;
  climbing?: boolean;
  vehicleIndex?: number | null;
  vehicleAmmo?: number;
}

export interface WorldActorState extends RemotePlayerState {
  id: string;
  health: number;
  alive: boolean;
  grenades: number;
  medkits: number;
}

export interface WorldSnapshot {
  matchTime: number;
  score: { blue: number; red: number };
  actors: WorldActorState[];
  objectives: Array<{ id: string; owner: Team | null; progress: number }>;
  grenades?: Array<{ id: string; ownerId: string; position: [number, number, number]; fuse: number }>;
  vehicles?: Array<{ position:[number,number,number]; yaw:number; health:number; magazine:number; active:boolean; occupantId:string|null }>;
}

type Message = Record<string, any> & { type: string };

export class RoomClient {
  public id = '';
  public code = '';
  public hostId = '';
  public status: 'lobby' | 'playing' = 'lobby';
  public map: MapId = 'city';
  public players: RoomPlayer[] = [];
  public connected = false;
  public onRoom: (() => void) | null = null;
  public onMatchStart: ((map: MapId, mission: MissionId, missionTeam: Team, players: RoomPlayer[]) => void) | null = null;
  public onPlayerState: ((id: string, state: RemotePlayerState) => void) | null = null;
  public onRemoteFire: ((id: string, weaponId: WeaponId) => void) | null = null;
  public onRemoteReload: ((id: string, weaponId: WeaponId) => void) | null = null;
  public onUseItem: ((id: string, item: 'grenade' | 'heal') => void) | null = null;
  public onWorld: ((snapshot: WorldSnapshot) => void) | null = null;
  public onHostMigration: ((snapshot: WorldSnapshot | null) => void) | null = null;
  public onError: ((message: string) => void) | null = null;
  private socket: WebSocket | null = null;

  public get isHost(): boolean { return this.id !== '' && this.id === this.hostId; }

  public async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const protocol = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof location !== 'undefined' ? location.host : '127.0.0.1:7460';
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${protocol}//${host}/rooms`); this.socket = socket;
      const timeout = setTimeout(() => reject(new Error('连接房间服务器超时')), 5000);
      socket.onopen = () => { clearTimeout(timeout); this.connected = true; resolve(); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('无法连接房间服务器')); };
      socket.onclose = () => { this.connected = false; this.code = ''; this.hostId = ''; this.status = 'lobby'; this.players = []; this.onRoom?.(); };
      socket.onmessage = event => this.handleMessage(String(event.data));
    });
  }

  public createRoom(code: string, name: string, team: Team, weapon: PrimaryWeaponId): void { this.send({ type: 'create', code: code.trim().toUpperCase(), name, team, weapon }); }
  public joinRoom(code: string, name: string, team: Team, weapon: PrimaryWeaponId): void { this.send({ type: 'join', code: code.trim().toUpperCase(), name, team, weapon }); }
  public startMatch(map: MapId, mission: MissionId = 'conquest', missionTeam: Team = 'blue'): void { this.send({ type: 'start', map, mission, missionTeam }); }
  public finishMatch(): void { this.send({ type: 'matchFinished' }); }
  public sendPlayerState(state: RemotePlayerState): void { this.send({ type: 'playerState', state }); }
  public sendFire(weaponId: WeaponId): void { this.send({ type: 'fire', weaponId }); }
  public sendReload(weaponId: WeaponId): void { this.send({ type: 'reload', weaponId }); }
  public sendUseItem(item: 'grenade' | 'heal'): void { this.send({ type: 'useItem', item }); }
  public sendWorld(snapshot: WorldSnapshot): void { this.send({ type: 'world', snapshot }); }
  public leave(): void { this.send({ type: 'leave' }); this.socket?.close(); this.socket = null; }

  private send(message: Message): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  private handleMessage(serialized: string): void {
    let message: Message; try { message = JSON.parse(serialized); } catch { return; }
    if (message.type === 'welcome') this.id = String(message.id || '');
    if (message.type === 'room') {
      this.code = String(message.code || ''); this.hostId = String(message.hostId || ''); this.status = message.status === 'playing' ? 'playing' : 'lobby';this.map=isMapId(message.map)?message.map:'city';this.players = Array.isArray(message.players) ? message.players : []; this.onRoom?.();
    }
    if (message.type === 'matchStart') this.onMatchStart?.(isMapId(message.map)?message.map:'city', String(message.mission || 'conquest') as MissionId, message.missionTeam === 'red' ? 'red' : 'blue', Array.isArray(message.players) ? message.players : []);
    if (message.type === 'playerState' && message.id && message.state) this.onPlayerState?.(String(message.id), message.state);
    if (message.type === 'fire' && message.id) this.onRemoteFire?.(String(message.id), message.weaponId === 'glock17' ? 'glock17' : String(message.weaponId) as WeaponId);
    if (message.type === 'reload' && message.id) this.onRemoteReload?.(String(message.id), message.weaponId === 'glock17' ? 'glock17' : String(message.weaponId) as WeaponId);
    if (message.type === 'useItem' && message.id && (message.item === 'grenade' || message.item === 'heal')) this.onUseItem?.(String(message.id), message.item);
    if (message.type === 'world' && message.snapshot) this.onWorld?.(message.snapshot);
    if (message.type === 'hostMigration') this.onHostMigration?.(message.snapshot || null);
    if (message.type === 'notice') this.onError?.(String(message.message || ''));
    if (message.type === 'error') this.onError?.(String(message.message || '联机错误'));
  }
}

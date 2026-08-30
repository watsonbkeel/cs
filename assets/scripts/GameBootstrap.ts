import {
  _decorator, AudioClip, AudioSource, Camera, Canvas, Color, Component, DirectionalLight,
  EventKeyboard, EventMouse, EventTouch, FogInfo, Game, game, Graphics, input, Input, KeyCode,
  Label, Layers, Material, Mesh, MeshRenderer, Node, primitives, Rect, resources,
  Sprite, SpriteFrame, sys, UITransform, utils, Vec2, Vec3, view,
} from 'cc';
import { ActionState } from './core/ActionState';
import {
  ATTACHMENT_PRICES, AttachmentId, BUILT_IN_OPTICS, createWeaponRuntime, MatchPhase, OpticId, opticForWeapon, oppositeTeam, Team,
  MAP_DISPLAY_NAMES, MAP_IDS, MapId, MissionId, PRIMARY_WEAPONS, PrimaryWeaponId, unlockedPrimaryWeapons, WEAPONS, WEAPON_UNLOCK_LEVEL,
  WeaponDefinition, WeaponId, WeaponLoadout, WeaponRuntime, WEAPON_VIEWMODEL_PROFILES,
} from './core/GameTypes';
import { ProfileStore } from './core/ProfileStore';
import { RemotePlayerState, RoomClient, RoomPlayer, WorldSnapshot } from './core/RoomClient';
import {
  aiCombatSkill, applyExperience, applyVerticalLook, clamp, consumeShot, damageAtDistance, experienceForLevel,
  finishReload, handlingMobility, IdempotencySet, purchaseAttachment, radialDamage, rewardCoins, rewardExperience,
  safeDelta, stepCriticalSpring,
} from './core/Rules';

const { ccclass, property } = _decorator;
const MATCH_SECONDS = 600;
const TEAM_SIZE = 12;
const BATTLE_ROYALE_SIZE = 16;
const BATTLE_ROYALE_AI_SKILL = 0.86;
const MAP_HALF = 88;
const PLAYER_RADIUS = 0.48;
const PLAYER_HEIGHT: Record<'stand' | 'crouch' | 'prone', number> = { stand: 1.82, crouch: 1.28, prone: 0.72 };
const EYE_HEIGHT: Record<'stand' | 'crouch' | 'prone', number> = { stand: 1.65, crouch: 1.16, prone: 0.62 };
const MOVE_SPEED: Record<'stand' | 'crouch' | 'prone', number> = { stand: 7.2, crouch: 4.2, prone: 2.1 };
const GRENADE_THROW_SPEED = 17 * 1.7;
const GRENADE_THROW_LIFT = 5.5;
const PICKED_WEAPON_RESERVE = 300;
const PICKUP_COUNT = 9;

interface WeaponVisualSpec { receiver:number; barrel:number; stock:number; handguard:number; width:number; magazine:'straight'|'curved'|'box'|'pistol'; wood:boolean; carry:boolean; bipod:boolean; heavy:boolean; }
const WEAPON_VISUALS:Record<WeaponId,WeaponVisualSpec>={
  mp18:{receiver:0.52,barrel:0.34,stock:0.38,handguard:0.28,width:0.16,magazine:'straight',wood:true,carry:false,bipod:false,heavy:false},
  'zhongzheng-shi':{receiver:0.74,barrel:0.91,stock:0.52,handguard:0.58,width:0.18,magazine:'straight',wood:true,carry:false,bipod:false,heavy:false},
  zb26:{receiver:0.74,barrel:0.66,stock:0.42,handguard:0.44,width:0.2,magazine:'box',wood:true,carry:true,bipod:true,heavy:true},
  'type24-hmg':{receiver:0.96,barrel:0.82,stock:0.31,handguard:0.36,width:0.28,magazine:'box',wood:true,carry:true,bipod:true,heavy:true},
  type38:{receiver:0.62,barrel:1.08,stock:0.54,handguard:0.7,width:0.145,magazine:'straight',wood:true,carry:false,bipod:false,heavy:false},
  type100:{receiver:0.56,barrel:0.4,stock:0.38,handguard:0.3,width:0.17,magazine:'straight',wood:true,carry:false,bipod:false,heavy:false},
  'type96-lmg':{receiver:0.76,barrel:0.68,stock:0.43,handguard:0.46,width:0.2,magazine:'curved',wood:true,carry:true,bipod:true,heavy:true},
  'type92-hmg':{receiver:0.98,barrel:0.8,stock:0.31,handguard:0.38,width:0.29,magazine:'box',wood:true,carry:true,bipod:true,heavy:true},
  glock17:{receiver:0.3,barrel:0.18,stock:0.01,handguard:0.01,width:0.13,magazine:'pistol',wood:false,carry:false,bipod:false,heavy:false},
};

interface MissionDefinition { id: MissionId; owner: Team | 'both'; title: string; brief: string; equipment: string; equipmentUse: string; objectiveIds: string[]; durationSeconds: number; }
const MISSION_DEFINITIONS: Record<MissionId, MissionDefinition> = {
  conquest: { id:'conquest', owner:'both', title:'争取据点', brief:'占领并守住更多据点，持续取得战场分数。', equipment:'标准战斗装具', equipmentUse:'无需主动使用', objectiveIds:['A','B','C','D','E'], durationSeconds:600 },
  'battle-royale': { id:'battle-royale', owner:'both', title:'大逃杀', brief:'16 名士兵分散进入战区，搜集空投装备，最后存活者获胜。', equipment:'空投侦测器 · 载具钥匙', equipmentUse:'按 4 切换空投武器；按 V 进入或离开载具', objectiveIds:[], durationSeconds:600 },
  'command-strike': { id:'command-strike', owner:'blue', title:'斩首行动', brief:'双方各有一名随机队长，先消灭对方队长的一方获胜。', equipment:'侦察终端 · 消音战术包', equipmentUse:'按 F 扫描敌方队长方位', objectiveIds:[], durationSeconds:360 },
  'airborne-assault': { id:'airborne-assault', owner:'blue', title:'空降突入', brief:'空降进入战区并完成十次有效击杀；守方坚持到时限结束获胜。', equipment:'降落伞 · 轻量化背心', equipmentUse:'降落伞自动生效；按 F 标记敌军', objectiveIds:[], durationSeconds:420 },
  'intel-recovery': { id:'intel-recovery', owner:'blue', title:'情报回收', brief:'双方争夺两处前线情报点，先控制全部目标的一方获胜。', equipment:'数据扫描器 · 护送标记', equipmentUse:'按 F 扫描最近的情报点', objectiveIds:['A','C'], durationSeconds:480 },
  'hostage-rescue': {id:'hostage-rescue',owner:'blue',title:'人质营救',brief:'突入两个控制区确认人质安全并建立撤离通道；守方可重新夺回区域。',equipment:'破门工具 · 身份识别器',equipmentUse:'靠近 A、C 区域按 F 完成安全确认',objectiveIds:['A','C'],durationSeconds:420},
  'bomb-defusal': {id:'bomb-defusal',owner:'blue',title:'爆炸物排除',brief:'在时限内控制并排除两处模拟爆炸物；守方可中断排除进度。',equipment:'排爆终端 · 防爆护具',equipmentUse:'靠近 B、E 区域按 F 进行排除',objectiveIds:['B','E'],durationSeconds:360},
  'vip-escort': {id:'vip-escort',owner:'blue',title:'要员护送',brief:'护送本方要员抵达 D 撤离区并完成区域控制；要员阵亡则任务失败。',equipment:'定位信标 · 护送装具',equipmentUse:'按 F 查看要员与撤离区距离',objectiveIds:['D'],durationSeconds:480},
  'arms-seizure': {id:'arms-seizure',owner:'blue',title:'军火查缴',brief:'依次控制三处非法军火存放区，完成现场封控与证物确认。',equipment:'证物扫描器 · 封存箱',equipmentUse:'靠近 A、D、E 区域按 F 查验军火',objectiveIds:['A','D','E'],durationSeconds:510},
  'perimeter-sweep': {id:'perimeter-sweep',owner:'blue',title:'区域清剿',brief:'清理高风险区域，率先完成十四次有效击杀的一方获胜。',equipment:'热成像观察仪 · 识别终端',equipmentUse:'按 F 标记最近可见敌军',objectiveIds:[],durationSeconds:390},
  encirclement: { id:'encirclement', owner:'red', title:'包围推进', brief:'进攻方控制外围据点十五秒获胜；守方坚持到时限结束即可反制。', equipment:'望远镜 · 额外弹药包', equipmentUse:'按 F 观察最近敌军方位', objectiveIds:['A','C','D'], durationSeconds:420 },
  'sabotage-raid': { id:'sabotage-raid', owner:'red', title:'破袭行动', brief:'进攻方在两处节点安放爆破包；守方坚持到时限结束即可排除威胁。', equipment:'爆破包 · 额外手雷', equipmentUse:'在目标附近按 F 安放爆破包', objectiveIds:['B','E'], durationSeconds:450 },
  'convoy-ambush': { id:'convoy-ambush', owner:'red', title:'伏击行动', brief:'双方进行击杀竞赛，率先完成十二次有效击杀的一方获胜。', equipment:'反车辆器材 · 额外手雷', equipmentUse:'按 F 标记最近的敌军', objectiveIds:[], durationSeconds:360 },
  'command-defense': { id:'command-defense', owner:'red', title:'司令部防卫', brief:'保护随机指定的队长直到时限结束；进攻方消灭该队长即可获胜。', equipment:'重型护甲 · 医疗包', equipmentUse:'重型护甲自动生效；按 F 查看队长方位', objectiveIds:[], durationSeconds:300 },
  'cache-defense': {id:'cache-defense',owner:'red',title:'军火库防守',brief:'守住 B、E 两处军火库直到增援抵达；蓝方完全控制两处区域即可获胜。',equipment:'区域警报器 · 补给箱',equipmentUse:'按 F 查看最近军火库状态',objectiveIds:['B','E'],durationSeconds:420},
  'extraction-intercept': {id:'extraction-intercept',owner:'red',title:'撤离拦截',brief:'在蓝方要员撤离前将其拦截；蓝方坚持到时限结束即可完成撤离。',equipment:'方向侦测器 · 轻量化装具',equipmentUse:'按 F 扫描蓝方要员方位',objectiveIds:[],durationSeconds:360},
  'communications-raid': {id:'communications-raid',owner:'red',title:'通信节点突袭',brief:'夺取 A、D 两处通信节点，切断守方战区联络。',equipment:'信号干扰器 · 接入终端',equipmentUse:'靠近 A、D 区域按 F 接入节点',objectiveIds:['A','D'],durationSeconds:390},
  'corridor-denial': {id:'corridor-denial',owner:'red',title:'通道封锁',brief:'同时控制 B、C、D 三处通道二十秒；蓝方可通过反占领打断计时。',equipment:'路障信标 · 观察仪',equipmentUse:'按 F 查看最近通道状态',objectiveIds:['B','C','D'],durationSeconds:450},
  'evacuation-cover': {id:'evacuation-cover',owner:'red',title:'撤离掩护',brief:'保护本方要员抵达 E 撤离区；要员阵亡或超时则蓝方获胜。',equipment:'撤离信标 · 烟幕装具',equipmentUse:'按 F 查看要员与撤离区距离',objectiveIds:['E'],durationSeconds:420},
  'safehouse-raid': {id:'safehouse-raid',owner:'blue',title:'安全屋突入',brief:'突入并控制两处疑似安全屋，完成现场身份确认和威胁清除。',equipment:'破门锤 · 现场识别终端',equipmentUse:'靠近 B、D 区域按 F 完成突入确认',objectiveIds:['B','D'],durationSeconds:390},
  'supply-line-disruption': {id:'supply-line-disruption',owner:'red',title:'补给线破袭',brief:'袭击两处前沿补给节点并切断守方运输路线，守方可夺回节点。',equipment:'遥控破障包 · 路线标记器',equipmentUse:'靠近 A、C 区域按 F 设置破袭装置',objectiveIds:['A','C'],durationSeconds:420},
};
const MISSION_POOLS: Record<Team, MissionId[]> = {
  blue:['conquest','command-strike','airborne-assault','intel-recovery','hostage-rescue','bomb-defusal','vip-escort','arms-seizure','perimeter-sweep','safehouse-raid'],
  red:['conquest','encirclement','sabotage-raid','convoy-ambush','command-defense','cache-defense','extraction-intercept','communications-raid','corridor-denial','evacuation-cover','supply-line-disruption'],
};

interface Obstacle {
  name: string;
  minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number;
}

interface CeilingZone { minX: number; maxX: number; minZ: number; maxZ: number; clearance: number; }
interface LadderZone {
  minX: number; maxX: number; minZ: number; maxZ: number; top: number;
  centerX: number; centerZ: number; exitX: number; exitZ: number;
}
interface PlatformZone { minX: number; maxX: number; minZ: number; maxZ: number; height: number; }
interface FloorZone { minX: number; maxX: number; minZ: number; maxZ: number; height: number; }
interface RampZone extends FloorZone { fromZ: number; toZ: number; fromHeight: number; toHeight: number; }

interface CapturePoint {
  id: string;
  position: Vec3;
  owner: Team | null;
  progress: number;
  progressTeam: Team | null;
  ring: Node;
}

interface GrenadeRuntime {
  id: string;
  node: Node;
  active: boolean;
  exploded: boolean;
  owner: Actor | null;
  position: Vec3;
  velocity: Vec3;
  fuse: number;
}

interface TimedFx { node: Node; time: number; lifetime: number; velocity?: Vec3; spin?: number; }

type PickupKind = 'weapon' | 'grenade' | 'medkit';
interface WorldPickup {
  node: Node;
  halo: Node;
  kind: PickupKind;
  weaponId: WeaponId | null;
  active: boolean;
  baseY: number;
  phase: number;
  airDrop: boolean;
  dropAt: number;
  landed: boolean;
  announced: boolean;
}

interface VehicleRuntime {
  node: Node;
  active: boolean;
  health: number;
  gun: WeaponRuntime;
  occupant: Actor | null;
  yaw: number;
}

interface Actor {
  id: string;
  node: Node;
  team: Team;
  player: boolean;
  remoteHuman: boolean;
  networkId: string | null;
  health: number;
  maxHealth: number;
  isCommander: boolean;
  alive: boolean;
  lifeId: number;
  weaponId: WeaponId;
  weapon: WeaponRuntime;
  loadout: WeaponLoadout;
  primaryWeaponId: PrimaryWeaponId;
  primaryWeapon: WeaponRuntime;
  sidearm: WeaponRuntime;
  pickedWeaponId: WeaponId | null;
  pickedWeapon: WeaponRuntime | null;
  supplyWeaponId: WeaponId | null;
  supplyWeapon: WeaponRuntime | null;
  activeSlot: 1 | 2 | 3 | 4;
  vehicle: VehicleRuntime | null;
  action: ActionState;
  grenades: number;
  medkits: number;
  yaw: number;
  pitch: number;
  respawnAt: number;
  protectedUntil: number;
  target: Actor | null;
  aiState: 'patrol' | 'objective' | 'engage' | 'cover' | 'dead';
  path: Vec3[];
  pathIndex: number;
  nextThink: number;
  lastProgressPosition: Vec3;
  stuckTime: number;
  recoveryAttempts: number;
  kills: number;
  triggerLatched: boolean;
  verticalVelocity: number;
  grounded: boolean;
  nextJumpAt: number;
  nextTraversalAt: number;
  verticalTarget: Vec3 | null;
  traversalLadder: LadderZone | null;
  aiZone: 'surface' | 'subway';
  parachuting: boolean;
  aiSkill: number;
  tacticalRole: 'assault' | 'flank' | 'support' | 'marksman';
  combatWaypoint: Vec3 | null;
  reactionReadyAt: number;
  nextTacticAt: number;
  lastSeenTarget: Vec3 | null;
  lastSeenAt: number;
  nextGrenadeAt: number;
  nextHealAt: number;
  burstUntil: number;
  strafeDirection: -1 | 1;
  visualLastPosition: Vec3;
  walkPhase: number;
}

class AudioBus {
  private readonly clips = new Map<string, AudioClip>();
  private readonly sources: AudioSource[] = [];
  private cursor = 0;
  constructor(private readonly root: Node, private getVolume: () => number) {
    for (let i = 0; i < 12; i += 1) {
      const node = new Node(`Audio-${i}`);
      root.addChild(node);
      this.sources.push(node.addComponent(AudioSource));
    }
    for (const id of [
      'm16', 'm4a1', 'akm', 'ak74', 'mp5', 'm249', 'aks74u', 'pkm', 'glock17', 'explosion', 'hit', 'reload',
      'weapon-tail-indoor', 'weapon-tail-outdoor', 'footstep-concrete', 'footstep-metal', 'footstep-dirt',
      'impact-body', 'impact-metal', 'impact-concrete',
    ]) {
      resources.load(`audio/${id}`, AudioClip, (error, clip) => { if (!error && clip) this.clips.set(id, clip); });
    }
  }
  public play(id: string, volumeScale = 1): void {
    const fallback:Record<string,string>={
      m4a1:'m16',ak74:'aks74u',rpk:'akm',m107:'akm',m200:'akm',svd:'akm',m2hb:'pkm',kord:'pkm',
      mp18:'mp5',type100:'mp5','zhongzheng-shi':'akm',type38:'akm',zb26:'m249','type96-lmg':'m249','type24-hmg':'pkm','type92-hmg':'pkm',
    };
    const clip=this.clips.get(id)||this.clips.get(fallback[id]);
    if (!clip) return;
    const source = this.sources[this.cursor++ % this.sources.length];
    source.stop(); source.clip = clip; source.volume = this.getVolume() * clamp(volumeScale, 0, 1); source.play();
  }
  public playWeapon(id: string, indoor: boolean): void {
    this.play(id, 0.9);
    this.play(indoor ? 'weapon-tail-indoor' : 'weapon-tail-outdoor', indoor ? 0.34 : 0.24);
  }
  public playFootstep(surface: 'concrete' | 'metal' | 'dirt', crouched: boolean): void {
    this.play(`footstep-${surface}`, crouched ? 0.28 : 0.45);
  }
  public playImpact(surface: 'body' | 'metal' | 'concrete'): void { this.play(`impact-${surface}`, 0.52); }
  public stopAll(): void { for (const source of this.sources) source.stop(); }
}

@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
  @property(Material)
  private proceduralStandardMaterial: Material | null = null;

  private sceneRoot!: Node;
  private worldRoot!: Node;
  private uiRoot!: Node;
  private cameraNode!: Node;
  private camera!: Camera;
  private mainLight!: DirectionalLight;
  private weaponView!: Node;
  private opticView!: Node;
  private boxMesh!: Mesh;
  private sphereMesh!: Mesh;
  private cylinderMesh!: Mesh;
  private readonly materials = new Map<string, Material>();
  private readonly obstacles: Obstacle[] = [];
  private readonly ceilings: CeilingZone[] = [];
  private readonly ladders: LadderZone[] = [];
  private readonly platforms: PlatformZone[] = [];
  private readonly sublevelFloors: FloorZone[] = [];
  private readonly ramps: RampZone[] = [];
  private readonly coverPoints: Vec3[] = [];
  private readonly navPoints: Vec3[] = [];
  private readonly upperFloorNavPoints: Vec3[] = [];
  private readonly subwayNavPoints: Vec3[] = [];
  private readonly actors: Actor[] = [];
  private readonly capturePoints: CapturePoint[] = [];
  private readonly grenades: GrenadeRuntime[] = [];
  private readonly grenadePreviewDots: Node[] = [];
  private readonly effects: TimedFx[] = [];
  private readonly worldPickups: WorldPickup[] = [];
  private readonly vehicles: VehicleRuntime[] = [];
  private readonly deathEvents = new IdempotencySet();
  private readonly keyState = new Set<KeyCode>();
  private profileStore!: ProfileStore;
  private player: Actor | null = null;
  private playerTeam: Team = 'blue';
  private gameMode: 'single' | 'online' = 'single';
  private selectedMap: MapId = 'city';
  private selectedMission: MissionId = 'conquest';
  private missionOwner: Team = 'blue';
  private missionProgress = 0;
  private missionLayer: Node | null = null;
  private missionTargetId = '';
  private teamKills = { blue: 0, red: 0 };
  private lastAiGrenadeAt: Record<Team, number> = { blue: -Infinity, red: -Infinity };
  private teamCommanders: Record<Team, string> = { blue: '', red: '' };
  private lastMission: Record<Team, MissionId | null> = { blue: null, red: null };
  private readonly missionDeck:Record<Team,MissionId[]>={blue:[],red:[]};
  private builtMap: MapId | null = null;
  private selectedPrimary: Record<Team, PrimaryWeaponId> = { blue: 'type38', red: 'zhongzheng-shi' };
  private phase: MatchPhase = 'menu';
  private matchId = '';
  private matchTime = MATCH_SECONDS;
  private countdown = 0;
  private matchClock = 0;
  private score = { blue: 0, red: 0 };
  private battleRoyaleWinner = '';
  private paused = false;
  private lifecyclePaused = false;
  private cursorMode = false;
  private fireHeld = false;
  private playerClimbingLadder = false;
  private adsTarget = false;
  private currentFov = 70;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private recoilPitchVelocity = 0;
  private recoilYawVelocity = 0;
  private weaponKick = 0;
  private weaponKickVelocity = 0;
  private reloadAnimationTime = 0;
  private reloadAnimationDuration = 0;
  private zhongzheng3D:Node|null=null;
  private zhongzheng3DParts = new Map<string, Node>();
  private zhongzheng3DMuzzleFlash:Node|null=null;
  private zhongzheng3DMuzzleFlashTime=0;
  private audio!: AudioBus;
  private hudLabels = new Map<string, Label>();
  private hudActionLabels = new Map<'grenade' | 'medkit', Label>();
  private hudGraphics!: Graphics;
  private scopeOverlay!: Node;
  private scopeGraphics!: Graphics;
  private webHudRoot: HTMLDivElement | null = null;
  private webHudHealth: HTMLDivElement | null = null;
  private webHudWeapon: HTMLDivElement | null = null;
  private webHudAmmo: HTMLDivElement | null = null;
  private webHudItems: HTMLDivElement | null = null;
  private webHudSlots: HTMLDivElement | null = null;
  private webTacticalMap: HTMLCanvasElement | null = null;
  private webTacticalMapTitle: HTMLDivElement | null = null;
  private webCompass: HTMLDivElement | null = null;
  private lastTacticalMapDraw = -Infinity;
  private lastPlayerFootstepAt = -Infinity;
  private menuLayer: Node | null = null;
  private resultLayer: Node | null = null;
  private pauseLayer: Node | null = null;
  private notification = '';
  private notificationUntil = 0;
  private lastObjectiveTick = 0;
  private shotSequence = 0;
  private viewWidth = 1920;
  private viewHeight = 1080;
  private safeRect = new Rect(0, 0, 1920, 1080);
  private perfFrames = 0;
  private perfSeconds = 0;
  private perfWorstFps = 999;
  private restartCount = 0;
  private weather: 'day' | 'night' = 'day';
  private missionEquipmentReadyAt = 0;
  private lastShotInputLatencyMs = 0;
  private readonly hudActionCenters = { grenade: new Vec2(), medkit: new Vec2() };
  private lastHudAction = { id: '' as '' | 'grenade' | 'medkit', at: -Infinity };
  private contextMenuHandler: ((event: Event) => void) | null = null;
  private blurHandler: (() => void) | null = null;
  private pointerLockHandler: (() => void) | null = null;
  private pointerLockErrorHandler: (() => void) | null = null;
  private documentKeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private readonly roomClient = new RoomClient();
  private onlineLobbyLayer: Node | null = null;
  private networkStateClock = 0;
  private networkWorldClock = 0;
  private readonly networkActors = new Map<string, Actor>();

  protected onLoad(): void {
    this.sceneRoot = this.node.scene!;
    this.node.name = 'GameBootstrap';
    for (const child of [...this.sceneRoot.children]) if (child !== this.node) child.destroy();
    this.boxMesh = utils.createMesh(primitives.box({ width: 1, height: 1, length: 1 }));
    this.sphereMesh = utils.createMesh(primitives.sphere(0.5, { segments: 12 }));
    this.cylinderMesh = utils.createMesh(primitives.cylinder(0.5,0.5,1,{radialSegments:12,heightSegments:1}));
    this.profileStore = new ProfileStore(sys.localStorage);
    this.selectedPrimary={...this.profileStore.profile.selectedPrimary};
    this.configureScene();
    this.createWorld();
    this.createUi();
    this.audio = new AudioBus(this.node, () => this.profileStore.profile.settings.sfxVolume);
    this.setupRoomClient();
    this.bindInput();
    this.installTestBridge();
    this.showMainMenu();
  }

  protected onDestroy(): void {
    this.releaseAllInputs();
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    game.off(Game.EVENT_HIDE, this.onHide, this);
    game.off(Game.EVENT_SHOW, this.onShow, this);
    this.roomClient.leave();
    if (this.contextMenuHandler && typeof document !== 'undefined') document.removeEventListener('contextmenu', this.contextMenuHandler);
    if (this.blurHandler && typeof window !== 'undefined') window.removeEventListener('blur', this.blurHandler);
    if (this.pointerLockHandler && typeof document !== 'undefined') document.removeEventListener('pointerlockchange', this.pointerLockHandler);
    if (this.pointerLockErrorHandler && typeof document !== 'undefined') document.removeEventListener('pointerlockerror', this.pointerLockErrorHandler);
    if (this.documentKeyHandler && typeof document !== 'undefined') document.removeEventListener('keydown', this.documentKeyHandler);
    this.webHudRoot?.remove(); this.webHudRoot = null;
  }

  private configureScene(): void {
    view.setDesignResolutionSize(1920, 1080, 4);
    const size = view.getVisibleSize();
    this.viewWidth = size.width; this.viewHeight = size.height;
    const physical = view.getFrameSize();
    const scaleX = size.width / Math.max(1, physical.width);
    const scaleY = size.height / Math.max(1, physical.height);
    const cocosSafe = (globalThis as any).wx?.getWindowInfo?.().safeArea;
    this.safeRect = cocosSafe
      ? new Rect(cocosSafe.left * scaleX - size.width / 2,
        size.height / 2 - (cocosSafe.top + cocosSafe.height) * scaleY,
        cocosSafe.width * scaleX, cocosSafe.height * scaleY)
      : new Rect(-size.width / 2 + 28, -size.height / 2 + 28, size.width - 56, size.height - 56);
    this.mainLight = this.node.getComponent(DirectionalLight) || this.node.addComponent(DirectionalLight);
    this.mainLight.color = new Color(255, 238, 211); this.mainLight.illuminance = 55000;
    this.node.setRotationFromEuler(-48, -32, 0);
    this.worldRoot = new Node('World'); this.sceneRoot.addChild(this.worldRoot);
    this.cameraNode = new Node('PlayerCamera'); this.sceneRoot.addChild(this.cameraNode);
    this.camera = this.cameraNode.addComponent(Camera);
    this.camera.fov = 70; this.camera.near = 0.05; this.camera.far = 180;
    const fog = this.sceneRoot.scene?.globals.fog;
    if (fog) {
      fog.type = FogInfo.FogType.LINEAR;
      fog.fogColor = new Color(111, 123, 128);
      fog.fogStart = 64;
      fog.fogEnd = 172;
      fog.accurate = false;
    }
    this.applyWeatherLighting('day');
    this.applyQuality();
    this.camera.visibility = Layers.Enum.DEFAULT;
  }

  private applyWeatherLighting(weather: 'day' | 'night'): void {
    this.weather = weather;
    const day = weather === 'day';
    const map=this.selectedMap,desert=map.startsWith('desert'),forest=map.startsWith('forest'),harbor=map.startsWith('harbor'),industrial=map==='refinery'||map==='power-station',mountain=map.startsWith('mountain');
    const daySky=desert?new Color(166,207,233,255):forest?new Color(129,177,206,255):harbor?new Color(132,181,211,255):industrial?new Color(151,176,186,255):mountain?new Color(137,191,228,255):new Color(142,196,235,255);
    // The original HDRI is intentionally disabled here: its dark exposure made every
    // match read like night. A solid sky keeps the scene readable on normal displays.
    const skybox = this.sceneRoot?.scene?.globals.skybox;
    if (skybox) skybox.enabled = false;
    if (this.camera) {
      this.camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
      this.camera.clearColor = day ? daySky : new Color(17, 27, 43, 255);
    }
    if (this.mainLight) {
      this.mainLight.color = day ? new Color(255, 245, 225) : new Color(150, 175, 220);
      this.mainLight.illuminance = day ? 76000 : 30000;
    }
    const globals = this.sceneRoot?.scene?.globals;
    const ambient = globals?.ambient;
    if (ambient) {
      ambient.skyLightingColor = day ? (desert?new Color(218,224,204,255):forest?new Color(154,194,170,255):new Color(175,215,245,255)) : new Color(45,62,92,255);
      ambient.skyIllum = day ? (desert?28500:forest?22000:26000) : 7500;
      ambient.groundLightingColor = day ? (desert?new Color(151,130,92,255):forest?new Color(72,92,67,255):new Color(112,118,108,255)) : new Color(35,40,48,255);
    }
    const fog = globals?.fog;
    if (fog) fog.fogColor = day ? (desert?new Color(190,179,145,255):forest?new Color(111,140,124,255):harbor?new Color(125,157,168,255):daySky) : new Color(36,47,63,255);
  }

  private material(id: string, color: Color, metallic = 0, roughness = 0.75): Material {
    const existing = this.materials.get(id); if (existing) return existing;
    const baseMaterial = this.proceduralStandardMaterial;
    this.assertValidMaterial(baseMaterial, 'procedural-standard base asset');
    const material = new Material();
    material.copy(baseMaterial);
    material.setProperty('mainColor', color);
    material.setProperty('metallic', clamp(metallic, 0, 1));
    material.setProperty('roughness', clamp(roughness, 0.04, 1));
    this.assertValidMaterial(material, `procedural material "${id}"`);
    this.materials.set(id, material); return material;
  }

  private primitiveNode(name: string, position: Vec3, scale: Vec3, material: Material, mesh: Mesh, parent = this.worldRoot): Node {
    this.assertValidMaterial(material, `box "${name}" before renderer creation`);
    const node = new Node(name);
    node.setPosition(position); node.setScale(scale);
    const renderer = node.addComponent(MeshRenderer);
    renderer.setSharedMaterial(material, 0);
    renderer.mesh = mesh;
    this.assertValidMaterial(renderer.getSharedMaterial(0), `box "${name}" before scene attachment`);
    parent.addChild(node);
    return node;
  }

  private box(name: string, position: Vec3, scale: Vec3, material: Material, parent = this.worldRoot): Node {
    return this.primitiveNode(name, position, scale, material, this.boxMesh, parent);
  }

  private sphere(name: string, position: Vec3, scale: Vec3, material: Material, parent = this.worldRoot): Node {
    return this.primitiveNode(name, position, scale, material, this.sphereMesh, parent);
  }

  private cylinder(name:string,position:Vec3,diameter:number,length:number,material:Material,parent=this.worldRoot,axis:'x'|'y'|'z'='z'):Node{
    const node=this.primitiveNode(name,position,new Vec3(diameter,length,diameter),material,this.cylinderMesh,parent);
    if(axis==='z')node.setRotationFromEuler(90,0,0);else if(axis==='x')node.setRotationFromEuler(0,0,90);
    return node;
  }

  private assertValidMaterial(material: Material | null, context: string): asserts material is Material {
    if (!material || !material.validate() || material.passes.length === 0) {
      throw new Error(`[P0 Material] Invalid ${context}: procedural-standard.mtl or builtin-standard was not packaged.`);
    }
  }

  private addObstacle(name: string, x: number, z: number, width: number, depth: number, height: number, material: Material, bottom = 0): Node {
    const node = this.box(name, new Vec3(x, bottom + height / 2, z), new Vec3(width, height, depth), material);
    this.obstacles.push({ name, minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, minY: bottom, maxY: bottom + height });
    if(name!=='Boundary'&&name!=='SubwayRoof'){
      const inset=Math.min(0.12,width*0.08,depth*0.08);
      this.platforms.push({minX:x-width/2+inset,maxX:x+width/2-inset,minZ:z-depth/2+inset,maxZ:z+depth/2-inset,height:bottom+height});
    }
    return node;
  }

  private registerObstacleVolume(name:string,x:number,z:number,width:number,depth:number,height:number,bottom=0,walkableTop=true):void{
    this.obstacles.push({name,minX:x-width/2,maxX:x+width/2,minZ:z-depth/2,maxZ:z+depth/2,minY:bottom,maxY:bottom+height});
    if(walkableTop){
      const inset=Math.min(0.16,width*0.09,depth*0.09);
      this.platforms.push({minX:x-width/2+inset,maxX:x+width/2-inset,minZ:z-depth/2+inset,maxZ:z+depth/2-inset,height:bottom+height});
    }
  }

  private createWorld(): void {
    this.buildSelectedMap();
    this.createWeaponView();
  }

  private buildSelectedMap(): void {
    if (this.builtMap === this.selectedMap) return;
    for (const child of [...this.worldRoot.children]) child.destroy();
    this.obstacles.length = 0; this.ceilings.length = 0; this.ladders.length = 0; this.platforms.length = 0;
    this.sublevelFloors.length = 0; this.ramps.length = 0;
    this.coverPoints.length = 0; this.navPoints.length = 0; this.upperFloorNavPoints.length = 0; this.subwayNavPoints.length = 0; this.capturePoints.length = 0;
    this.grenades.length = 0; this.grenadePreviewDots.length = 0; this.effects.length = 0;
    if (this.selectedMap === 'city') this.createCityMap();
    else if (this.selectedMap === 'military-base') this.createMilitaryBaseMap();
    else this.createScenarioMap(this.selectedMap);
    this.addSceneBackdrop();
    this.addEnvironmentalDepthComposition();
    this.addBattlefieldComplexity();
    this.addSurfaceWear();
    this.rebuildNavigation();
    this.builtMap = this.selectedMap;
  }

  private createScenarioMap(id: Exclude<MapId,'city'|'military-base'>): void {
    const family=id.startsWith('city')?'city':id.startsWith('military')?'military':id.startsWith('harbor')?'harbor':id==='refinery'||id==='power-station'?'industrial':id.startsWith('mountain')?'mountain':id.startsWith('desert')?'desert':id.startsWith('forest')?'forest':'airport';
    const variant=MAP_IDS.indexOf(id)%2;
    const palettes:Record<string,{ground:Color,wall:Color,accent:Color,brick:Color,trim:Color,sky:Color}>={
      city:{ground:new Color(50,54,57),wall:new Color(105,108,105),accent:new Color(74,82,86),brick:new Color(103,74,64),trim:new Color(174,174,164),sky:new Color(143,190,224)},
      military:{ground:new Color(68,72,62),wall:new Color(62,72,60),accent:new Color(84,91,76),brick:new Color(91,91,82),trim:new Color(168,169,151),sky:new Color(151,191,215)},
      harbor:{ground:new Color(62,66,66),wall:new Color(77,83,84),accent:new Color(47,72,80),brick:new Color(89,83,76),trim:new Color(164,170,169),sky:new Color(133,183,215)},
      industrial:{ground:new Color(56,58,54),wall:new Color(83,78,67),accent:new Color(104,64,42),brick:new Color(94,77,63),trim:new Color(173,159,126),sky:new Color(153,178,187)},
      mountain:{ground:new Color(76,78,69),wall:new Color(92,94,87),accent:new Color(55,66,58),brick:new Color(99,91,79),trim:new Color(171,170,157),sky:new Color(139,190,226)},
      desert:{ground:new Color(132,116,82),wall:new Color(145,126,91),accent:new Color(91,78,55),brick:new Color(130,103,72),trim:new Color(188,167,123),sky:new Color(162,204,232)},
      forest:{ground:new Color(54,68,53),wall:new Color(75,80,68),accent:new Color(43,58,45),brick:new Color(86,76,62),trim:new Color(151,157,137),sky:new Color(129,177,206)},
      airport:{ground:new Color(60,64,65),wall:new Color(88,93,94),accent:new Color(53,65,72),brick:new Color(96,91,82),trim:new Color(178,181,176),sky:new Color(145,195,228)},
    };
    const palette=palettes[family],key=`${id}-`;
    const m:Record<string,Material>={
      asphalt:this.material(`${key}ground`,palette.ground,0.02,0.94),concrete:this.material(`${key}concrete`,palette.wall,0.02,0.86),dark:this.material(`${key}dark`,new Color(30,34,33),0.32,0.58),
      glass:this.material(`${key}glass`,new Color(40,76,88),0.42,0.18),rust:this.material(`${key}rust`,new Color(106,62,39),0.24,0.78),sandbag:this.material(`${key}sandbag`,family==='desert'?new Color(139,120,82):new Color(91,88,68),0,0.98),
      military:this.material(`${key}military`,palette.accent,0.14,0.72),sidewalk:this.material(`${key}sidewalk`,palette.wall,0,0.92),brick:this.material(`${key}brick`,palette.brick,0,0.9),trim:this.material(`${key}trim`,palette.trim,0.05,0.65),lamp:this.material(`${key}lamp`,new Color(238,214,151),0.05,0.26),
    };
    this.createMapBounds(m.asphalt,m.concrete);
    const stripe=this.material(`${key}marking`,family==='airport'?new Color(224,220,188):new Color(190,180,125),0,0.9);
    if(variant===0){this.box('MainRoute',new Vec3(0,0.025,0),new Vec3(20,0.05,174),m.dark);for(let z=-76;z<=76;z+=14)this.box('RouteMark',new Vec3(0,0.06,z),new Vec3(0.22,0.03,5),stripe);}
    else{this.box('MainRoute',new Vec3(0,0.025,0),new Vec3(174,0.05,20),m.dark);for(let x=-76;x<=76;x+=14)this.box('RouteMark',new Vec3(x,0.06,0),new Vec3(5,0.03,0.22),stripe);}
    const buildings=variant===0
      ? [[-57,-57,24,20,8,'right'],[55,55,27,23,9,'left'],[-53,48,20,25,7,'right'],[49,-47,26,20,8,'left']]
      : [[-60,51,25,22,8,'right'],[58,-52,24,26,9,'left'],[-42,-50,30,19,7,'right'],[43,48,28,21,8,'left']];
    for(const b of buildings)this.addHollowBuilding(b[0] as number,b[1] as number,b[2] as number,b[3] as number,b[4] as number,m,b[5] as 'left'|'right');
    if(family==='city'){
      this.box('Canal',new Vec3(variant?30:-30,0.015,0),new Vec3(17,0.03,176),this.material(`${key}water`,new Color(41,78,91),0.35,0.22));
      for(const z of [-52,0,52])this.box('BridgeDeck',new Vec3(variant?30:-30,0.22,z),new Vec3(23,0.42,10),m.concrete);
      for(let z=-75;z<=75;z+=25)this.addStreetLight(variant?-6:6,z,m);
    }else if(family==='military'){
      for(const [x,z] of [[-25,-27],[24,28],[42,-18],[-43,20]] as Array<[number,number]>){this.addObstacle('DepotHangar',x,z,20,13,5.5,m.military);this.box('HangarRoof',new Vec3(x,5.7,z),new Vec3(21,0.35,14),m.dark);}
      for(let x=-66;x<=66;x+=12)this.box('DepotCrate',new Vec3(x,1.2,variant?18:-18),new Vec3(5,2.4,3.2),x%24===0?m.rust:m.military);
    }else if(family==='harbor'){
      for(let i=0;i<18;i+=1){const x=-66+(i%6)*26,z=-48+Math.floor(i/6)*46+(variant?8:-8),h=i%3===0?5.2:2.6;this.addObstacle('CargoContainer',x,z,11,3.2,h,i%2?m.rust:m.military);this.box('ContainerRib',new Vec3(x,h*0.55,z-1.63),new Vec3(9.5,0.12,0.05),m.trim);}
      for(const x of [-58,58]){this.box('CraneTower',new Vec3(x,8,variant?-6:8),new Vec3(1.2,16,1.2),m.dark);this.box('CraneBoom',new Vec3(x+(x<0?8:-8),15.5,variant?-6:8),new Vec3(17,0.55,0.55),m.rust);}
    }else if(family==='industrial'){
      for(const [x,z,r] of [[-52,-22,7],[48,25,8],[-18,48,6],[22,-49,6]] as Array<[number,number,number]>){this.addObstacle('TankBase',x,z,r*1.5,r*1.5,5.5,m.concrete);this.sphere('StorageTank',new Vec3(x,5.2,z),new Vec3(r,5.5,r),m.trim);this.box('TankBand',new Vec3(x,5.3,z-r*0.76),new Vec3(r*1.25,0.22,0.12),m.rust);}
      for(const z of [-34,0,34]){this.box('PipeRack',new Vec3(0,3.5,z),new Vec3(112,0.35,0.35),m.rust);for(const x of [-52,0,52])this.box('PipeSupport',new Vec3(x,1.8,z),new Vec3(0.3,3.6,2.8),m.dark);}
    }else if(family==='mountain'){
      for(let i=0;i<18;i+=1){const x=-75+(i%6)*30+(variant?7:-5),z=-68+Math.floor(i/6)*66;const size=3+(i%4);this.addObstacle('Rock',x,z,size*1.4,size,2.2+(i%3),m.concrete);this.sphere('RockCap',new Vec3(x,1.5+(i%3),z),new Vec3(size*0.8,2.2,size*0.65),m.concrete);}
      this.addObstacle('RadarTower',variant?25:-25,variant?-22:22,9,9,11,m.military);this.sphere('RadarDish',new Vec3(variant?25:-25,13,variant?-22:22),new Vec3(5,1.2,5),m.trim);
    }else if(family==='desert'){
      for(const [x,z,w,d] of [[-32,-23,28,3],[30,25,30,3],[-6,52,3,25],[8,-52,3,23]] as Array<[number,number,number,number]>)this.addObstacle('CompoundWall',variant?-x:x,z,w,d,3,m.brick);
      for(let i=0;i<12;i+=1){const x=-70+(i%4)*46,z=-62+Math.floor(i/4)*62;this.box('MarketAwning',new Vec3(x,2.7,z),new Vec3(8,0.18,6),i%2?m.rust:m.military);for(const dx of [-3.6,3.6])this.box('AwningPost',new Vec3(x+dx,1.35,z),new Vec3(0.16,2.7,0.16),m.dark);}
    }else if(family==='forest'){
      const foliage=this.material(`${key}foliage`,new Color(43,76,43),0,0.96),bark=this.material(`${key}bark`,new Color(70,53,39),0,0.98);
      for(let i=0;i<30;i+=1){const x=-79+(i%10)*17.5,z=-72+Math.floor(i/10)*70+(i%2?6:-5);if(Math.abs(x)<18||Math.abs(z)<14)continue;this.addObstacle('TreeTrunk',x,z,0.8,0.8,5.5,bark);this.sphere('TreeCanopy',new Vec3(x,7,z),new Vec3(3.4,4.6,3.4),foliage);}
      this.addObstacle('RadioBunker',variant?25:-25,variant?22:-22,18,15,5,m.military);this.box('RadioMast',new Vec3(variant?25:-25,11,variant?22:-22),new Vec3(0.3,17,0.3),m.dark);
    }else{
      this.box('Runway',new Vec3(0,0.04,variant?23:-23),new Vec3(172,0.08,24),m.dark);for(let x=-74;x<=74;x+=16)this.box('RunwayMark',new Vec3(x,0.1,variant?23:-23),new Vec3(7,0.025,0.4),stripe);
      for(const x of [-45,45]){this.addObstacle('AirportHangar',x,variant?-35:35,30,18,7,m.concrete);this.box('HangarRoof',new Vec3(x,7.2,variant?-35:35),new Vec3(31,0.4,19),m.trim);}
      this.addObstacle('AircraftBody',0,variant?-5:5,4,24,3,m.trim);this.addObstacle('AircraftWing',0,variant?-5:5,24,5,0.45,m.trim,1.48);this.addObstacle('AircraftTail',0,variant?5:-5,5,0.5,5,m.military,1.5);
    }
    this.addLayeredDistrictDetails(family,m,variant);
    const objectives=[new Vec3(-70,0,0),new Vec3(-28,0,30),new Vec3(0,0,variant?22:-22),new Vec3(30,0,-30),new Vec3(70,0,0)];
    const coverTypes=['weapon-crate','sandbag','vehicle','barrier'];
    for(let i=0;i<28;i+=1){const x=-72+(i%7)*24,z=-66+Math.floor(i/7)*43+(variant?(i%2?7:-4):(i%2?-6:5));if(objectives.some(p=>Math.hypot(p.x-x,p.z-z)<9)||this.blocked(x,z,2))continue;this.addCover(x,z,i%3===0?7:5,i%4===2?3:2.4,i%4===1?1.05:1.4,coverTypes[i%coverTypes.length],m);}
    ['A','B','C','D','E'].forEach((name,index)=>this.createCapturePoint(name,objectives[index]));
  }

  private addSurfaceWear():void{
    const key=`wear-${this.selectedMap}`,dark=this.material(`${key}-dark`,new Color(38,41,39),0.04,0.95),dust=this.material(`${key}-dust`,this.selectedMap.startsWith('desert')?new Color(158,137,96):new Color(98,94,80),0,0.98),debris=this.material(`${key}-debris`,new Color(75,72,66),0.05,0.9),drain=this.material(`${key}-drain`,new Color(28,31,30),0.68,0.38),paint=this.material(`${key}-faded-paint`,new Color(139,137,117),0.02,0.88);
    const quality=this.profileStore.profile.settings.quality,wearCount=quality==='low'?18:quality==='medium'?27:34,debrisCount=quality==='low'?12:quality==='medium'?20:28,crackCount=quality==='low'?8:quality==='medium'?13:18,fixtureCount=quality==='low'?5:quality==='medium'?8:12;
    for(let i=0;i<wearCount;i+=1){const x=-78+(i*37)%157,z=-75+(i*61)%151,w=2.1+(i%5)*1.05,d=1.2+(i%4)*0.72;this.box('SurfaceWear',new Vec3(x,0.018,z),new Vec3(w,0.026,d),i%3===0?dust:dark).setRotationFromEuler(0,i*23,0);}
    for(let i=0;i<debrisCount;i+=1){const x=-76+(i*43)%153,z=-72+(i*29)%147;if(Math.abs(x)>84||Math.abs(z)>84)continue;this.box('SmallDebris',new Vec3(x,0.1,z),new Vec3(0.14+(i%3)*0.1,0.14+(i%2)*0.08,0.24+(i%4)*0.11),debris).setRotationFromEuler(i*17,i*31,i*9);}
    for(let i=0;i<crackCount;i+=1){const x=-72+(i*41)%145,z=-70+(i*53)%141,length=2.4+(i%5)*0.8;this.box('PavementCrack',new Vec3(x,0.035,z),new Vec3(0.045,0.012,length),dark).setRotationFromEuler(0,i*37,0);}
    for(let i=0;i<fixtureCount;i+=1){const alongX=i%2===0,x=alongX?-56+(i*19)%112:(i%4<2?-20:20),z=alongX?(i%4<2?-38:38):-58+(i*23)%116;this.box('StormDrain',new Vec3(x,0.045,z),alongX?new Vec3(1.35,0.025,0.42):new Vec3(0.42,0.025,1.35),drain);for(let slot=0;slot<5;slot++)this.box('DrainSlot',new Vec3(x+(alongX?-0.48+slot*0.24:0),0.063,z+(alongX?0:-0.48+slot*0.24)),alongX?new Vec3(0.055,0.012,0.3):new Vec3(0.3,0.012,0.055),dark);}
    for(let i=0;i<Math.max(4,fixtureCount-2);i+=1){const x=-68+(i*31)%137,z=-64+(i*47)%129;this.cylinder('RoadBollard',new Vec3(x,0.38,z),0.16,0.76,i%3===0?paint:drain,this.worldRoot,'y');this.box('BollardBand',new Vec3(x,0.53,z-0.085),new Vec3(0.17,0.08,0.025),paint);}
  }

  private addLayeredDistrictDetails(family:string,materials:Record<string,Material>,variant:number):void{
    if(!['city','military','harbor','airport'].includes(family))return;
    const candidates:Array<[number,number,number,number,number]> = variant===0
      ? [[-18,68,18,12,11],[24,-68,20,12,8],[-72,26,14,16,9],[70,-30,15,17,12]]
      : [[18,-68,18,12,10],[-24,68,20,12,8],[72,28,14,16,9],[-70,-32,15,17,12]];
    const quality=this.profileStore.profile.settings.quality;
    const buildingTarget=quality==='low'?2:3;
    let added=0;
    for(const [x,z,width,depth,height] of candidates){
      if(added>=buildingTarget||!this.areaOpen(x,z,width,depth))continue;
      this.addFacadeBuilding(x,z,width,depth,height,materials);
      this.box('LayeredParapetFront',new Vec3(x,height+0.48,z+depth*0.38),new Vec3(width*0.78,0.75,0.24),materials.concrete);
      this.box('LayeredBalcony',new Vec3(x-width*0.18,4.15,z+depth/2+0.48),new Vec3(width*0.42,0.18,1.05),materials.dark);
      for(const bx of [x-width*0.34,x-width*0.02])this.box('BalconyRail',new Vec3(bx,4.65,z+depth/2+0.9),new Vec3(0.08,0.92,0.08),materials.rust);
      this.box('LayeredAwning',new Vec3(x+width*0.22,2.55,z+depth/2+0.72),new Vec3(width*0.36,0.16,1.45),family==='harbor'?materials.military:materials.rust);
      this.cylinder('RooftopWaterTank',new Vec3(x+width*0.25,height+1.45,z-depth*0.18),1.7,2.4,materials.dark,this.worldRoot,'y');
      if(added===0)this.addLadder(x+width/2+0.58,z-depth*0.18,height+0.2,false,materials,-1,0);
      added+=1;
    }
    const alleyZ=variant===0?42:-42;
    for(const x of [-46,-14,18,50]){
      if(!this.areaOpen(x,alleyZ,7,2))continue;
      this.addObstacle('LayeredAlleyWall',x,alleyZ,6.5,0.45,2.1,materials.brick);
      this.box('AlleyWallCap',new Vec3(x,2.18,alleyZ),new Vec3(6.8,0.15,0.62),materials.trim);
    }
    this.addSceneStreetscape(family,materials,variant);
  }

  private addSceneStreetscape(family:string,materials:Record<string,Material>,variant:number):void{
    const orientation=variant===0?1:-1;
    if(family==='city'){
      const awningA=this.material(`streetscape-awning-a-${this.selectedMap}`,new Color(104,47,39),0.04,0.76);
      const awningB=this.material(`streetscape-awning-b-${this.selectedMap}`,new Color(39,71,78),0.06,0.69);
      for(const [x,z,width] of [[-34,48,7],[0,-61,8],[37,49,7]] as Array<[number,number,number]>){
        if(!this.areaOpen(x,z,4,2.5))continue;
        this.box('StreetShopAwning',new Vec3(x,2.55,z),new Vec3(width,0.18,2.15),x<0?awningA:awningB).setRotationFromEuler(0,orientation<0?180:0,0);
        for(const dx of [-width*0.42,width*0.42])this.box('AwningPost',new Vec3(x+dx,1.27,z+orientation*0.72),new Vec3(0.12,2.55,0.12),materials.dark);
        this.box('ShopCounter',new Vec3(x,0.78,z-orientation*0.45),new Vec3(width*0.72,1.45,0.72),materials.brick);
      }
      const scaffoldX=variant===0?55:-55,scaffoldZ=20;
      if(this.areaOpen(scaffoldX,scaffoldZ,7,4)){
        for(const dx of [-2.6,0,2.6])this.box('ConstructionScaffoldPost',new Vec3(scaffoldX+dx,3.1,scaffoldZ),new Vec3(0.13,6.2,0.13),materials.rust);
        for(const y of [1.3,3.1,4.9])this.box('ConstructionScaffoldDeck',new Vec3(scaffoldX,y,scaffoldZ),new Vec3(6.1,0.13,2.25),materials.dark);
      }
      return;
    }
    if(family==='military'){
      const camo=this.material(`camo-net-${this.selectedMap}`,new Color(73,80,61),0.02,0.92);
      for(const [x,z] of [[-24,53],[27,-55]] as Array<[number,number]>){
        if(!this.areaOpen(x,z,10,7))continue;
        this.box('VehicleMaintenanceCanopy',new Vec3(x,3.05,z),new Vec3(10,0.22,7),camo);
        for(const dx of [-4.5,4.5])for(const dz of [-3,3])this.box('MaintenanceCanopyPost',new Vec3(x+dx,1.52,z+dz),new Vec3(0.18,3.05,0.18),materials.dark);
        this.box('MaintenanceBench',new Vec3(x,0.72,z+2.15),new Vec3(5.5,1.25,0.85),materials.rust);
      }
      return;
    }
    if(family==='harbor'){
      const dock=this.material(`dock-timber-${this.selectedMap}`,new Color(76,58,42),0.03,0.91);
      for(const [x,z] of [[-34,59],[36,-59]] as Array<[number,number]>){
        if(!this.areaOpen(x,z,11,4))continue;
        this.box('DockLoadingPlatform',new Vec3(x,0.42,z),new Vec3(11,0.8,4),dock);
        this.box('DockRamp',new Vec3(x,1.25,z),new Vec3(8.5,0.18,2.1),materials.rust).setRotationFromEuler(0,0,x<0?8:-8);
        for(const dx of [-4.5,4.5])this.cylinder('DockBollard',new Vec3(x+dx,0.9,z-1.5),0.42,1.8,materials.dark,this.worldRoot,'y');
      }
      return;
    }
    if(family==='airport'){
      for(const [x,z] of [[-26,56],[29,-57]] as Array<[number,number]>){
        if(!this.areaOpen(x,z,12,5))continue;
        this.box('BaggageShelter',new Vec3(x,2.45,z),new Vec3(12,0.22,5),materials.trim);
        for(const dx of [-5.4,0,5.4])this.box('BaggageShelterPost',new Vec3(x+dx,1.2,z),new Vec3(0.18,2.4,0.18),materials.dark);
        for(const offset of [-3.2,0,3.2])this.box('BaggageCart',new Vec3(x+offset,0.55,z),new Vec3(2.4,1.05,1.25),materials.military);
      }
    }
  }

  private addSceneBackdrop():void{
    const map=this.selectedMap;
    const family=map.startsWith('city')?'city':map.startsWith('military')?'military':map.startsWith('harbor')?'harbor':map==='refinery'||map==='power-station'?'industrial':map.startsWith('mountain')?'mountain':map.startsWith('desert')?'desert':map.startsWith('forest')?'forest':'airport';
    const variant=MAP_IDS.indexOf(map)%2,quality=this.profileStore.profile.settings.quality;
    const count=quality==='low'?8:quality==='medium'?12:16;
    const concrete=this.material(`backdrop-concrete-${map}`,family==='desert'?new Color(127,112,82):family==='forest'?new Color(62,72,62):new Color(78,84,84),0.02,0.94);
    const shadow=this.material(`backdrop-shadow-${map}`,family==='desert'?new Color(91,80,62):new Color(43,50,52),0.08,0.88);
    const glass=this.material(`backdrop-glass-${map}`,new Color(49,82,94),0.3,0.3);
    const foliage=this.material(`backdrop-foliage-${map}`,new Color(48,73,49),0,0.98);
    const place=(index:number):{x:number,z:number}=>{
      const side=index%4,slot=Math.floor(index/4),offset=-70+slot*(140/Math.max(1,Math.ceil(count/4)-1));
      if(side===0)return{x:offset,z:-99-(index%3)*3};
      if(side===1)return{x:99+(index%3)*3,z:offset};
      if(side===2)return{x:-offset,z:99+(index%3)*3};
      return{x:-99-(index%3)*3,z:-offset};
    };
    for(let i=0;i<count;i+=1){
      const {x,z}=place(i),edgeX=Math.abs(x)>90;
      if(family==='city'){
        const width=12+(i%3)*4,depth=9+(i%2)*4,height=14+(i*7)%19;
        this.box('DistantCityBlock',new Vec3(x,height/2,z),new Vec3(width,height,depth),i%3===0?shadow:concrete);
        const stepHeight=3+(i%3),stepWidth=width*0.68,stepDepth=depth*0.7;
        this.box('DistantCityStep',new Vec3(x,height+stepHeight/2,z),new Vec3(stepWidth,stepHeight,stepDepth),concrete);
        const bandCount=quality==='low'?1:2;
        for(let band=0;band<bandCount;band++)this.box('DistantWindowBand',new Vec3(x+(edgeX?-Math.sign(x)*width/2-Math.sign(x)*0.035:0),5+band*5,z+(edgeX?0:-Math.sign(z)*depth/2-Math.sign(z)*0.035)),edgeX?new Vec3(0.04,1.1,depth*0.72):new Vec3(width*0.72,1.1,0.04),glass);
      }else if(family==='military'||family==='airport'){
        const width=family==='airport'?22:17,depth=10+(i%2)*4,height=family==='airport'?6+(i%3)*2:5+(i%4);
        this.box('DistantServiceBuilding',new Vec3(x,height/2,z),new Vec3(width,height,depth),i%2?concrete:shadow);
        this.box('DistantHangarRoof',new Vec3(x,height+0.45,z),new Vec3(width+1.2,0.5,depth+1.2),concrete);
        if(i%4===0){this.box('DistantTowerMast',new Vec3(x,15,z),new Vec3(0.28,22,0.28),shadow);for(const y of [9,14,19])this.box('DistantTowerBrace',new Vec3(x,y,z),new Vec3(edgeX?0.25:5,0.16,edgeX?5:0.25),shadow);}
      }else if(family==='harbor'){
        const width=16+(i%2)*6,height=7+(i%3)*2;
        this.box('DistantWarehouse',new Vec3(x,height/2,z),new Vec3(width,height,12),i%2?concrete:shadow);
        if(i%3===0){this.box('DistantCraneTower',new Vec3(x,13,z),new Vec3(0.6,24,0.6),shadow);this.box('DistantCraneBoom',new Vec3(x+(edgeX?0:7),24,z+(edgeX?7:0)),edgeX?new Vec3(0.45,0.45,16):new Vec3(16,0.45,0.45),concrete);}
      }else if(family==='industrial'){
        const tankHeight=8+(i%3)*3;
        this.cylinder('DistantProcessTank',new Vec3(x,tankHeight/2,z),5+(i%2)*2,tankHeight,concrete,this.worldRoot,'y');
        this.box('DistantPipeStack',new Vec3(x+(edgeX?0:7),14,z+(edgeX?7:0)),new Vec3(1.1,28,1.1),shadow);
      }else if(family==='mountain'){
        const height=12+(i*5)%15;
        this.sphere('DistantMountainMass',new Vec3(x,height*0.25-1,z),new Vec3(15+(i%3)*5,height,13+(i%2)*6),concrete).setRotationFromEuler(0,i*29,(i%3-1)*9);
      }else if(family==='forest'){
        const height=11+(i%4)*2;
        this.cylinder('DistantTreeTrunk',new Vec3(x,height*0.28,z),0.9,height*0.55,shadow,this.worldRoot,'y');
        this.sphere('DistantTreeCrown',new Vec3(x,height*0.72,z),new Vec3(5+(i%2),height*0.58,5+(i%3)),foliage);
      }else{
        const width=13+(i%3)*3,height=7+(i%4)*2;
        this.box('DistantVillageBlock',new Vec3(x,height/2,z),new Vec3(width,height,11+(i%2)*3),i%2?concrete:shadow);
        this.box('DistantVillageParapet',new Vec3(x,height+0.45,z),new Vec3(width+0.6,0.9,11+(i%2)*3),concrete);
      }
    }
  }

  private addEnvironmentalDepthComposition():void{
    const map=this.selectedMap;
    const family=map.startsWith('city')?'city':map.startsWith('military')?'military':map.startsWith('harbor')?'harbor':map==='airport-cargo'||map==='airport-perimeter'?'airport':'';
    if(!family)return;
    const variant=MAP_IDS.indexOf(map)%2,materials=this.baseMapMaterials();
    const quality=this.profileStore.profile.settings.quality;
    const detailCount=quality==='low'?1:quality==='medium'?2:3;

    // Frame long sightlines with traversable portals. They create a readable
    // foreground/midground/background rhythm without closing the route.
    const portalCandidates:Record<string,Array<[number,number,number,'x'|'z']>>={
      city:variant===0?[[0,61,10,'x'],[-56,16,9,'z'],[52,-20,9,'z']]:[[61,0,10,'z'],[16,-56,9,'x'],[-20,52,9,'x']],
      military:variant===0?[[-18,-18,11,'x'],[43,18,10,'z'],[-46,20,10,'z']]:[[-18,18,11,'x'],[43,-18,10,'z'],[-46,-20,10,'z']],
      harbor:variant===0?[[0,-42,12,'x'],[-38,20,10,'z'],[42,24,10,'z']]:[[-42,0,12,'z'],[20,-38,10,'x'],[24,42,10,'x']],
      airport:variant===0?[[0,48,13,'x'],[-48,-8,11,'z'],[50,-12,11,'z']]:[[48,0,13,'z'],[-8,-48,11,'x'],[-12,50,11,'x']],
    };
    let portals=0;
    for(const [x,z,width,axis] of portalCandidates[family]){
      const footprintX=axis==='x'?width:1.1,footprintZ=axis==='x'?1.1:width;
      if(portals>=detailCount||!this.areaOpen(x,z,footprintX,footprintZ))continue;
      this.addSightlinePortal(x,z,width,axis,materials,family);
      portals+=1;
    }

    if(family==='city')this.addUrbanDepthLayer(materials,variant,detailCount);
    else if(family==='military')this.addMilitaryDepthLayer(materials,variant,detailCount);
    else if(family==='harbor')this.addHarborDepthLayer(materials,variant,detailCount);
    else this.addAirportDepthLayer(materials,variant,detailCount);
  }

  private addSightlinePortal(x:number,z:number,width:number,axis:'x'|'z',materials:Record<string,Material>,family:string):void{
    const pillar=1.05,depth=1.05,clearance=3.15,headerHeight=0.85;
    const structural=family==='military'?materials.military:family==='harbor'?materials.rust:materials.brick;
    if(axis==='x'){
      for(const side of [-1,1])this.addObstacle('SightlinePortalPillar',x+side*(width/2-pillar/2),z,pillar,depth,clearance,structural);
      this.addObstacle('SightlinePortalHeader',x,z,width,depth,headerHeight,materials.dark,clearance);
      this.box('PortalLintel',new Vec3(x,clearance+headerHeight+0.12,z),new Vec3(width+0.45,0.22,depth+0.28),materials.trim);
    }else{
      for(const side of [-1,1])this.addObstacle('SightlinePortalPillar',x,z+side*(width/2-pillar/2),depth,pillar,clearance,structural);
      this.addObstacle('SightlinePortalHeader',x,z,depth,width,headerHeight,materials.dark,clearance);
      this.box('PortalLintel',new Vec3(x,clearance+headerHeight+0.12,z),new Vec3(depth+0.28,0.22,width+0.45),materials.trim);
    }
    this.coverPoints.push(axis==='x'?new Vec3(x-width/2-1.4,0,z):new Vec3(x,0,z-width/2-1.4));
  }

  private addUrbanDepthLayer(materials:Record<string,Material>,variant:number,detailCount:number):void{
    const facade=this.material(`urban-depth-facade-${this.selectedMap}`,new Color(88,82,76),0.02,0.9);
    const muted=this.material(`urban-depth-muted-${this.selectedMap}`,new Color(61,70,72),0.08,0.78);
    const rows:Array<[number,number,number,number]> = variant===0
      ? [[-94,-38,4,13],[-94,12,5,17],[94,42,6,15]]
      : [[-38,-94,4,13],[12,-94,5,17],[42,94,6,15]];
    for(let i=0;i<Math.min(rows.length,detailCount+1);i+=1){
      const [x,z,floors,length]=rows[i],height=3.15*floors;
      const edgeX=Math.abs(x)>80,width=edgeX?5.5:length,depth=edgeX?length:5.5;
      this.box('UrbanMidgroundBlock',new Vec3(x,height/2,z),new Vec3(width,height,depth),i%2?facade:materials.brick);
      this.box('UrbanRoofSetback',new Vec3(x,height+1.25,z),new Vec3(width*0.68,2.5,depth*0.68),muted);
      for(let floor=1;floor<floors;floor+=1){
        const y=floor*3.15-0.45;
        this.box('UrbanWindowBand',new Vec3(x+(edgeX?-Math.sign(x)*(width/2+0.025):0),y,z+(edgeX?0:-Math.sign(z)*(depth/2+0.025))),edgeX?new Vec3(0.05,0.8,depth*0.72):new Vec3(width*0.72,0.8,0.05),materials.glass);
      }
      if(i===0)this.cylinder('UrbanRoofTank',new Vec3(x,height+3.25,z),1.45,2.8,materials.dark,this.worldRoot,'y');
    }
    const courtX=variant===0?32:-32,courtZ=variant===0?51:-51;
    if(this.areaOpen(courtX,courtZ,12,7)){
      this.addObstacle('UrbanCourtyardWall',courtX,courtZ,12,0.45,2.15,materials.brick);
      this.addObstacle('UrbanCourtyardReturn',courtX-5.75,courtZ-2.7,0.45,5.8,2.15,materials.brick);
      this.box('UrbanCourtyardCap',new Vec3(courtX,2.22,courtZ),new Vec3(12.4,0.14,0.64),materials.trim);
    }
  }

  private addMilitaryDepthLayer(materials:Record<string,Material>,variant:number,detailCount:number):void{
    const revetment=this.material(`military-revetment-${this.selectedMap}`,new Color(78,76,63),0.02,0.97);
    const positions:Array<[number,number,number]> = variant===0?[[-70,28,16],[66,-34,18],[-18,66,14]]:[[70,-28,16],[-66,34,18],[18,-66,14]];
    for(let i=0;i<Math.min(detailCount,positions.length);i+=1){
      const [x,z,length]=positions[i];if(!this.areaOpen(x,z,length,5))continue;
      this.addObstacle('MilitaryRevetment',x,z,length,2.2,1.65,revetment);
      for(const side of [-1,1])this.addObstacle('MilitaryRevetmentReturn',x+side*(length/2-0.7),z+1.65,1.4,3.4,1.65,revetment);
      this.box('RevetmentTop',new Vec3(x,1.78,z),new Vec3(length+0.35,0.2,2.5),materials.military);
    }
    const towerX=variant===0?94:-94,towerZ=variant===0?60:-60;
    this.box('MilitaryMidgroundTower',new Vec3(towerX,7.5,towerZ),new Vec3(5.5,15,5.5),materials.military);
    this.box('MilitaryTowerCab',new Vec3(towerX,15.5,towerZ),new Vec3(8,2.4,8),materials.glass);
    this.box('MilitaryTowerRoof',new Vec3(towerX,16.9,towerZ),new Vec3(9,0.38,9),materials.dark);
  }

  private addHarborDepthLayer(materials:Record<string,Material>,variant:number,detailCount:number):void{
    const steel=this.material(`harbor-depth-steel-${this.selectedMap}`,new Color(79,70,61),0.68,0.38);
    const lines:Array<[number,number,'x'|'z']>=variant===0?[[-52,54,'x'],[48,-52,'x'],[66,12,'z']]:[[54,-52,'z'],[-52,48,'z'],[12,66,'x']];
    for(let i=0;i<Math.min(detailCount,lines.length);i+=1){
      const [x,z,axis]=lines[i],span=13;if(!this.areaOpen(x,z,axis==='x'?span:4,axis==='x'?4:span))continue;
      for(const side of [-1,1])this.addObstacle('CargoGantryPost',axis==='x'?x+side*span/2:x,axis==='x'?z:z+side*span/2,0.45,0.45,6.8,steel);
      this.box('CargoGantryBeam',new Vec3(x,6.65,z),axis==='x'?new Vec3(span+1,0.5,0.5):new Vec3(0.5,0.5,span+1),materials.rust);
      this.box('CargoGantryCab',new Vec3(x,5.45,z),new Vec3(2.5,1.6,2.2),materials.military);
    }
    const warehouseX=variant===0?-94:58,warehouseZ=variant===0?22:-94;
    const edgeX=Math.abs(warehouseX)>90;
    this.box('HarborMidgroundWarehouse',new Vec3(warehouseX,5.2,warehouseZ),edgeX?new Vec3(9,10.4,30):new Vec3(30,10.4,9),materials.concrete);
    this.box('HarborSawtoothRoof',new Vec3(warehouseX,10.8,warehouseZ),edgeX?new Vec3(9.8,1.15,31):new Vec3(31,1.15,9.8),materials.trim).setRotationFromEuler(0,0,edgeX?0:5);
  }

  private addAirportDepthLayer(materials:Record<string,Material>,variant:number,detailCount:number):void{
    const terminal=this.material(`airport-terminal-${this.selectedMap}`,new Color(86,94,97),0.18,0.54);
    const edgeZ=variant===0?92:-92;
    this.box('AirportTerminalBand',new Vec3(0,6.5,edgeZ),new Vec3(108,13,8),terminal);
    for(let x=-45;x<=45;x+=15){
      this.box('AirportTerminalGlass',new Vec3(x,7.2,edgeZ-Math.sign(edgeZ)*4.03),new Vec3(10.5,3.1,0.06),materials.glass);
      this.box('AirportTerminalColumn',new Vec3(x-6.3,6.2,edgeZ-Math.sign(edgeZ)*4.15),new Vec3(0.45,8.5,0.45),materials.dark);
    }
    for(let i=0;i<detailCount;i+=1){
      const x=-36+i*36,z=variant===0?60:-60;if(!this.areaOpen(x,z,11,4.5))continue;
      this.addObstacle('AirportServiceBridge',x,z,11,2.7,1.9,materials.trim,2.45);
      for(const side of [-1,1])this.addObstacle('AirportServiceBridgePost',x+side*4.7,z,0.35,0.35,3.4,materials.dark);
      this.box('AirportServiceBridgeGlass',new Vec3(x,3.45,z-1.38),new Vec3(8.8,1.15,0.06),materials.glass);
    }
  }

  private areaOpen(x:number,z:number,width:number,depth:number):boolean {
    const margin=1.2,minX=x-width/2-margin,maxX=x+width/2+margin,minZ=z-depth/2-margin,maxZ=z+depth/2+margin;
    if(minX<-MAP_HALF+4||maxX>MAP_HALF-4||minZ<-MAP_HALF+4||maxZ>MAP_HALF-4)return false;
    if(this.capturePoints.some(point=>point.position.x>minX-5&&point.position.x<maxX+5&&point.position.z>minZ-5&&point.position.z<maxZ+5))return false;
    return !this.obstacles.some(obstacle=>obstacle.name!=='Boundary'&&maxX>obstacle.minX&&minX<obstacle.maxX&&maxZ>obstacle.minZ&&minZ<obstacle.maxZ);
  }

  private addBattlefieldComplexity():void {
    const materials=this.baseMapMaterials(),seed=MAP_IDS.indexOf(this.selectedMap)+1;
    const shelterCandidates:Array<[number,number,'left'|'right']>=[
      [-52,-42,'right'],[52,42,'left'],[-48,44,'right'],[48,-44,'left'],[-36,58,'right'],[36,-58,'left'],[-58,8,'right'],[58,-8,'left'],
    ];
    const builtFamily=this.selectedMap.startsWith('city')||this.selectedMap.startsWith('military')||this.selectedMap.startsWith('harbor')||this.selectedMap==='refinery'||this.selectedMap==='power-station'||this.selectedMap.startsWith('airport')||this.selectedMap.startsWith('desert');
    if(builtFamily){
      let shelters=0;
      for(let offset=0;offset<shelterCandidates.length&&shelters<2;offset+=1){
        const candidate=shelterCandidates[(offset+seed)%shelterCandidates.length],x=candidate[0],z=candidate[1];
        if(!this.areaOpen(x,z,13,11))continue;
        this.addHollowBuilding(x,z,13,11,4.4,materials,candidate[2]);shelters+=1;
      }
    }
    this.addNaturalCover(materials,seed);
    const quality=this.profileStore.profile.settings.quality,clusterTarget=quality==='low'?8:quality==='medium'?12:16;
    const types=['sandbag','weapon-crate','barrier','vehicle'];let added=0;
    for(let attempt=0;attempt<clusterTarget*4&&added<clusterTarget;attempt+=1){
      const x=-66+((attempt*37+seed*19)%133),z=-62+((attempt*53+seed*29)%125),type=types[(attempt+seed)%types.length];
      const width=type==='vehicle'?6.5:type==='barrier'?6:3.4+(attempt%3),depth=type==='vehicle'?2.8:type==='barrier'?1.2:2.2+(attempt%2),height=type==='vehicle'?1.35:type==='barrier'?1.05:1.2;
      if(!this.areaOpen(x,z,width,depth))continue;
      this.addCover(x,z,width,depth,height,type,materials);
      if(type!=='vehicle'){
        const side=attempt%2===0?1:-1;
        this.box('SupplyPallet',new Vec3(x+side*(width/2+0.65),0.12,z),new Vec3(1.05,0.24,1.4),materials.rust);
      }
      added+=1;
    }
    for(const team of ['blue','red'] as Team[]){
      const side=team==='blue'?-1:1;
      for(const z of [-48,0,48]){
        const x=side*76;if(!this.areaOpen(x,z,7,4))continue;
        this.addCover(x,z,6.5,2.2,1.15,'sandbag',materials);
        this.box('SpawnMarkerPost',new Vec3(x-side*2.6,1.65,z),new Vec3(0.16,3.3,0.16),materials.dark);
        this.box('SpawnMarkerFlag',new Vec3(x-side*3.15,2.65,z),new Vec3(1.1,0.65,0.08),team==='blue'?this.material('blueSpawnFlag',new Color(38,86,145),0.05,0.72):this.material('redSpawnFlag',new Color(132,48,42),0.05,0.76));
      }
    }
  }

  private addNaturalCover(materials:Record<string,Material>,seed:number):void{
    const map=this.selectedMap;
    // Natural silhouettes belong to the terrain family. Urban, military,
    // harbor, industrial and airport maps use man-made cover instead.
    const forest=map.startsWith('forest'),mountain=map.startsWith('mountain'),desert=map.startsWith('desert');
    if(!forest&&!mountain&&!desert)return;
    const quality=this.profileStore.profile.settings.quality;
    const target=quality==='low'?6:quality==='medium'?9:12;
    const rock=this.material(`natural-rock-${map}`,desert?new Color(124,105,73):new Color(82,86,78),0.02,0.96);
    const bark=this.material(`natural-bark-${map}`,new Color(70,53,38),0.01,0.97);
    const foliage=this.material(`natural-foliage-${map}`,desert?new Color(92,91,58):new Color(44,75,47),0,0.98);
    let added=0;
    for(let attempt=0;attempt<target*6&&added<target;attempt+=1){
      const x=-72+((attempt*43+seed*31)%145),z=-70+((attempt*67+seed*17)%141);
      const kind=forest?(attempt+seed)%4:mountain?((attempt+seed)%2)*2:2+((attempt+seed)%2);
      const width=kind===0?5.4:kind===1?7.4:kind===2?4.2:3.6,depth=kind===0?4.5:kind===1?1.8:kind===2?4.2:3.6;
      if(!this.areaOpen(x,z,width,depth))continue;
      if(kind===0){
        this.sphere('NaturalBoulder',new Vec3(x,1.15,z),new Vec3(2.7,2.25,2.2),rock).setRotationFromEuler(0,(attempt*29)%180,(attempt%3-1)*8);
        this.sphere('NaturalBoulderDetail',new Vec3(x+1.55,0.72,z-0.65),new Vec3(1.55,1.4,1.35),rock).setRotationFromEuler(12,(attempt*41)%180,6);
        this.registerObstacleVolume('NaturalBoulder',x,z,5.1,4.1,1.85);
        this.coverPoints.push(new Vec3(x+3.15,0,z));
      }else if(kind===1){
        const log=this.cylinder('FallenLog',new Vec3(x,0.7,z),1.35,7.2,bark,this.worldRoot,'x');log.setRotationFromEuler(0,(attempt%2)*18,90);
        for(const side of [-1,1])this.cylinder('BrokenBranch',new Vec3(x+side*2.1,1.05,z+side*0.35),0.28,1.7,bark,this.worldRoot,'y').setRotationFromEuler(side*28,0,side*24);
        this.registerObstacleVolume('FallenLog',x,z,7.2,1.55,1.25);
        this.coverPoints.push(new Vec3(x,z+1.85));
      }else if(kind===2){
        this.sphere('RubbleMound',new Vec3(x,0.58,z),new Vec3(4.2,1.15,3.9),rock);
        for(let piece=0;piece<5;piece+=1)this.box('RubbleStone',new Vec3(x-1.5+piece*0.72,0.88+(piece%2)*0.18,z-0.7+(piece%3)*0.55),new Vec3(0.8+(piece%2)*0.35,0.55,0.7),rock).setRotationFromEuler(piece*11,piece*37,piece*8);
        this.registerObstacleVolume('RubbleMound',x,z,4.0,3.7,1.05);
        this.coverPoints.push(new Vec3(x+2.7,0,z));
      }else{
        if(desert){
          this.sphere('DryShrub',new Vec3(x,0.65,z),new Vec3(2.6,1.3,2.1),foliage);
          for(const side of [-1,1])this.cylinder('DryBranch',new Vec3(x+side*0.55,0.88,z),0.16,1.75,bark,this.worldRoot,'y').setRotationFromEuler(0,0,side*28);
          this.registerObstacleVolume('DryShrubCover',x,z,2.8,2.2,1.05);
          this.coverPoints.push(new Vec3(x+2.1,0,z));
        }else{
          this.cylinder('NaturalTreeTrunk',new Vec3(x,2.45,z),0.72,4.9,bark,this.worldRoot,'y');
          this.sphere('NaturalTreeCrown',new Vec3(x,5.45,z),new Vec3(3.2,3.4,3.2),foliage);
          this.sphere('NaturalShrub',new Vec3(x+1.45,0.72,z+0.9),new Vec3(2.2,1.45,1.9),foliage);
          this.registerObstacleVolume('NaturalTreeTrunk',x,z,0.85,0.85,4.9,0,false);
          this.coverPoints.push(new Vec3(x+1.35,0,z));
        }
      }
      added+=1;
    }
  }

  private baseMapMaterials(): Record<string, Material> {
    return {
      asphalt: this.material('asphalt', new Color(43, 47, 49), 0, 0.9),
      concrete: this.material('concrete', new Color(102, 105, 101), 0, 0.85),
      dark: this.material('dark', new Color(27, 30, 31), 0.1, 0.72),
      glass: this.material('glass', new Color(39, 76, 94), 0.3, 0.25),
      rust: this.material('rust', new Color(103, 57, 37), 0.15, 0.82),
      sandbag: this.material('sandbag', new Color(88, 85, 67), 0, 1),
      military: this.material('military', new Color(63, 73, 61), 0.08, 0.86),
      sidewalk: this.material('sidewalk', new Color(129, 130, 124), 0, 0.92),
      brick: this.material('brick', new Color(92, 68, 58), 0, 0.9),
      trim: this.material('trim', new Color(171, 169, 154), 0.05, 0.72),
      lamp: this.material('lamp', new Color(241, 216, 151), 0.05, 0.3),
    };
  }

  private createMapBounds(ground: Material, wall: Material, opening?: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    if (!opening) this.box('Ground', new Vec3(0, -0.3, 0), new Vec3(180, 0.6, 180), ground);
    else {
      const leftWidth = opening.minX + 90; const rightWidth = 90 - opening.maxX;
      const southDepth = opening.minZ + 90; const northDepth = 90 - opening.maxZ;
      this.box('Ground-West', new Vec3(-90 + leftWidth / 2, -0.3, 0), new Vec3(leftWidth, 0.6, 180), ground);
      this.box('Ground-East', new Vec3(opening.maxX + rightWidth / 2, -0.3, 0), new Vec3(rightWidth, 0.6, 180), ground);
      this.box('Ground-South', new Vec3((opening.minX + opening.maxX) / 2, -0.3, -90 + southDepth / 2), new Vec3(opening.maxX - opening.minX, 0.6, southDepth), ground);
      this.box('Ground-North', new Vec3((opening.minX + opening.maxX) / 2, -0.3, opening.maxZ + northDepth / 2), new Vec3(opening.maxX - opening.minX, 0.6, northDepth), ground);
    }
    for (const x of [-90, 90]) this.addObstacle('Boundary', x, 0, 2, 182, 9, wall);
    for (const z of [-90, 90]) this.addObstacle('Boundary', 0, z, 182, 2, 9, wall);
  }

  private addCover(x: number, z: number, width: number, depth: number, height: number, type: string, materials: Record<string, Material>): void {
    const mat = type === 'vehicle' ? materials.rust : type === 'sandbag' ? materials.sandbag : type === 'weapon-crate' ? materials.military : materials.dark;
    this.addObstacle(`Cover-${type}`, x, z, width, depth, height, mat);
    const offsetX = width <= depth ? width / 2 + 1 : 0;
    const offsetZ = width > depth ? depth / 2 + 1 : 0;
    this.coverPoints.push(new Vec3(x + offsetX, 0, z + offsetZ));
    if (type === 'vehicle') {
      this.addObstacle('VehicleCab', x, z, width * 0.52, depth * 0.72, 0.6, mat, height);
      this.box('VehicleGlass', new Vec3(x, height + 0.32, z - depth * 0.19), new Vec3(width * 0.32, 0.34, 0.06), materials.glass);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.cylinder('Wheel',new Vec3(x+sx*width*0.34,0.34,z+sz*depth*0.38),0.68,0.3,materials.dark,this.worldRoot,'x');
      for (const sx of [-1, 1]) this.box('Headlight', new Vec3(x + sx * width * 0.31, 0.72, z - depth / 2 - 0.035), new Vec3(0.34, 0.18, 0.07), materials.lamp);
      this.box('VehicleBumper', new Vec3(x, 0.48, z - depth / 2 - 0.1), new Vec3(width * 0.82, 0.16, 0.16), materials.dark);
    }
    if (type === 'weapon-crate') {
      this.box('CrateBand', new Vec3(x, height * 0.62, z - depth / 2 - 0.02), new Vec3(width * 0.82, 0.12, 0.05), materials.rust);
    }
  }

  private addStreetLight(x: number, z: number, materials: Record<string, Material>): void {
    this.cylinder('StreetLightPost',new Vec3(x,2.7,z),0.16,5.4,materials.dark,this.worldRoot,'y');
    this.cylinder('StreetLightArm',new Vec3(x+0.48,5.32,z),0.12,1.05,materials.dark,this.worldRoot,'x');
    this.box('StreetLightLamp', new Vec3(x + 0.92, 5.18, z), new Vec3(0.42, 0.14, 0.28), materials.lamp);
  }

  private addFacadeBuilding(x: number, z: number, width: number, depth: number, height: number, materials: Record<string, Material>): void {
    this.addObstacle('Apartment', x, z, width, depth, height, materials.brick);
    const quality=this.profileStore.profile.settings.quality;
    const columns = Math.max(3, Math.floor(width / 5)); const rows = Math.max(2, Math.floor(height / 4));
    const facadeAccent=this.material(`facade-accent-${this.selectedMap}`,this.selectedMap.startsWith('desert')?new Color(113,86,58):this.selectedMap.startsWith('military')?new Color(60,70,57):new Color(72,77,74),0.08,0.78);
    const entranceX=x-width*0.29;
    this.box('ApartmentEntrance',new Vec3(entranceX,1.3,z+depth/2+0.06),new Vec3(2.5,2.6,0.12),materials.dark);
    this.box('EntranceCanopy',new Vec3(entranceX,2.72,z+depth/2+0.75),new Vec3(3.7,0.16,1.45),facadeAccent);
    for(const side of [-1,1])this.box('EntranceCanopyPost',new Vec3(entranceX+side*1.55,1.35,z+depth/2+1.23),new Vec3(0.13,2.7,0.13),materials.dark);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const wx = x - width * 0.38 + column * (width * 0.76 / Math.max(1, columns - 1));
      this.box('ApartmentWindow', new Vec3(wx, 2.2 + row * 3.1, z + depth / 2 + 0.025), new Vec3(1.45, 1.55, 0.05), materials.glass);
      this.box('WindowSill', new Vec3(wx, 1.37 + row * 3.1, z + depth / 2 + 0.055), new Vec3(1.7, 0.12, 0.11), materials.trim);
      if(quality==='high')for(const side of [-1,1])this.box('WindowFrame',new Vec3(wx+side*0.73,2.2+row*3.1,z+depth/2+0.07),new Vec3(0.07,1.68,0.08),materials.trim);
    }
    if(quality!=='low'){
      const sideRows=Math.max(2,Math.floor(height/4.5)),sideColumns=Math.max(2,Math.floor(depth/6));
      for(const side of [-1,1])for(let row=0;row<sideRows;row+=1)for(let column=0;column<sideColumns;column+=1){
        const wz=z-depth*0.32+column*(depth*0.64/Math.max(1,sideColumns-1));
        this.box('ApartmentSideWindow',new Vec3(x+side*(width/2+0.025),2.25+row*3.3,wz),new Vec3(0.05,1.35,1.25),materials.glass);
      }
      const balconyY=Math.min(height-1.8,4.7),balconyX=x+width*0.25;
      this.box('ApartmentBalconyDeck',new Vec3(balconyX,balconyY,z+depth/2+0.65),new Vec3(width*0.34,0.16,1.35),facadeAccent);
      this.box('ApartmentBalconyRail',new Vec3(balconyX,balconyY+0.62,z+depth/2+1.26),new Vec3(width*0.34,0.78,0.09),materials.dark);
      for(const side of [-1,1])this.box('BalconyEndRail',new Vec3(balconyX+side*width*0.17,balconyY+0.62,z+depth/2+0.65),new Vec3(0.08,0.78,1.25),materials.dark);
    }
    const parapetHeight=0.72;
    this.box('RoofParapetFront',new Vec3(x,height+parapetHeight/2,z+depth/2-0.18),new Vec3(width,parapetHeight,0.36),materials.trim);
    this.box('RoofParapetBack',new Vec3(x,height+parapetHeight/2,z-depth/2+0.18),new Vec3(width,parapetHeight,0.36),materials.trim);
    for(const side of [-1,1])this.box('RoofParapetSide',new Vec3(x+side*(width/2-0.18),height+parapetHeight/2,z),new Vec3(0.36,parapetHeight,depth),materials.trim);
    this.box('RooftopUnit', new Vec3(x - width * 0.22, height + 0.55, z), new Vec3(2.8, 1.1, 2.2), materials.dark);
    if(height>=13){
      const stepHeight=Math.min(4.2,height*0.23);
      this.box('ApartmentRoofStep',new Vec3(x+width*0.18,height+stepHeight/2,z-depth*0.08),new Vec3(width*0.42,stepHeight,depth*0.48),facadeAccent);
      this.box('RoofStepCap',new Vec3(x+width*0.18,height+stepHeight+0.16,z-depth*0.08),new Vec3(width*0.45,0.32,depth*0.52),materials.trim);
    }
  }

  private addLadder(x: number, z: number, top: number, alongX: boolean, materials: Record<string, Material>, exitX = 0, exitZ = 0): void {
    const railOffset = 0.42;
    if (alongX) {
      this.box('LadderRail', new Vec3(x - railOffset, top / 2, z), new Vec3(0.08, top, 0.08), materials.dark);
      this.box('LadderRail', new Vec3(x + railOffset, top / 2, z), new Vec3(0.08, top, 0.08), materials.dark);
    } else {
      this.box('LadderRail', new Vec3(x, top / 2, z - railOffset), new Vec3(0.08, top, 0.08), materials.dark);
      this.box('LadderRail', new Vec3(x, top / 2, z + railOffset), new Vec3(0.08, top, 0.08), materials.dark);
    }
    for (let y = 0.45; y < top; y += 0.55) this.box('LadderRung', new Vec3(x, y, z), alongX ? new Vec3(0.95, 0.07, 0.07) : new Vec3(0.07, 0.07, 0.95), materials.rust);
    this.ladders.push({ minX: x - 1.25, maxX: x + 1.25, minZ: z - 1.25, maxZ: z + 1.25, top, centerX: x, centerZ: z, exitX, exitZ });
  }

  private addHollowBuilding(x: number, z: number, width: number, depth: number, height: number, materials: Record<string, Material>, ladderSide: 'left' | 'right'): void {
    const wall = 0.55; const door = 4.8;
    this.box('InteriorFloor', new Vec3(x, 0.03, z), new Vec3(width - wall, 0.06, depth - wall), materials.dark);
    this.addObstacle('Roof', x, z, width + 0.2, depth + 0.2, 0.35, materials.concrete, height - 0.175);
    this.platforms.push({ minX: x - width / 2 + 0.4, maxX: x + width / 2 - 0.4, minZ: z - depth / 2 + 0.4, maxZ: z + depth / 2 - 0.4, height: height + 0.18 });
    this.ceilings.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, clearance: height });

    const sideWidth = (width - door) / 2;
    this.addObstacle('FrontWall', x - (door + sideWidth) / 2, z - depth / 2, sideWidth, wall, height, materials.concrete);
    this.addObstacle('FrontWall', x + (door + sideWidth) / 2, z - depth / 2, sideWidth, wall, height, materials.concrete);
    this.addObstacle('BackSill', x, z + depth / 2, width, wall, 0.88, materials.concrete);
    this.addObstacle('BackHeader', x, z + depth / 2, width, wall, height - 2.35, materials.concrete, 2.35);
    this.addObstacle('LeftWall', x - width / 2, z, wall, depth, height, materials.concrete);
    this.addObstacle('RightWall', x + width / 2, z, wall, depth, height, materials.concrete);
    this.box('WindowGlass', new Vec3(x, 1.6, z + depth / 2 + 0.02), new Vec3(width * 0.62, 1.25, 0.04), materials.glass);
    this.box('DoorFrameTop', new Vec3(x, 2.65, z - depth / 2 - 0.05), new Vec3(door + 0.35, 0.18, 0.18), materials.trim);
    for (const side of [-1, 1]) this.box('DoorFrameSide', new Vec3(x + side * (door / 2 + 0.08), 1.3, z - depth / 2 - 0.05), new Vec3(0.18, 2.7, 0.18), materials.trim);
    this.addObstacle('InteriorDivider', x + width * 0.17, z + depth * 0.12, 0.35, depth * 0.42, 2.7, materials.brick);
    this.box('CeilingLight', new Vec3(x - width * 0.18, height - 0.22, z), new Vec3(1.4, 0.08, 0.35), materials.lamp);
    this.box('RooftopHVAC', new Vec3(x - width * 0.2, height + 0.55, z - depth * 0.12), new Vec3(2.4, 1.1, 1.8), materials.dark);
    this.addCover(x - width * 0.22, z + depth * 0.12, 2.4, 1.4, 1.15, 'crate', materials);
    if(height>=6.5)this.addUpperBuildingFloor(x,z,width,depth,height,materials);
    const ladderX = x + (ladderSide === 'right' ? width / 2 + 0.58 : -width / 2 - 0.58);
    this.addLadder(ladderX, z + depth * 0.22, height + 0.2, false, materials, ladderSide === 'right' ? -1 : 1, 0);
  }

  private addUpperBuildingFloor(x:number,z:number,width:number,depth:number,height:number,materials:Record<string,Material>):void{
    const floorY=3.18,stairHalf=1.65,interiorWidth=width-1.15,sideWidth=Math.max(1.2,(interiorWidth-stairHalf*2)/2);
    const leftX=x-interiorWidth/2+sideWidth/2,rightX=x+interiorWidth/2-sideWidth/2;
    this.addObstacle('UpperFloorLeft',leftX,z,sideWidth,depth-1.1,0.18,materials.dark,floorY);
    this.addObstacle('UpperFloorRight',rightX,z,sideWidth,depth-1.1,0.18,materials.dark,floorY);
    const landingDepth=Math.max(1.5,depth*0.22),landingZ=z+depth/2-0.55-landingDepth/2;
    this.addObstacle('UpperFloorLanding',x,landingZ,stairHalf*2,landingDepth,0.18,materials.dark,floorY);
    const rampMin=z-depth*0.38,rampMax=z+depth*0.25,rampTop=floorY+0.18;
    this.ramps.push({minX:x-stairHalf,maxX:x+stairHalf,minZ:rampMin,maxZ:rampMax,height:rampTop,fromZ:rampMin,toZ:rampMax,fromHeight:0,toHeight:rampTop});
    const stepCount=11;
    for(let step=0;step<stepCount;step+=1){
      const t=(step+0.5)/stepCount,stepZ=rampMin+(rampMax-rampMin)*t,stepY=rampTop*t;
      this.box('InteriorStair',new Vec3(x,stepY-0.055,stepZ),new Vec3(stairHalf*2,0.11,(rampMax-rampMin)/stepCount+0.05),materials.concrete);
    }
    const railing=this.material(`building-railing-${this.selectedMap}`,new Color(67,72,69),0.88,0.27);
    for(const side of [-1,1]){
      const railX=x+side*(stairHalf+0.08);
      this.box('StairRailing',new Vec3(railX,2.0,(rampMin+rampMax)/2),new Vec3(0.075,1.0,rampMax-rampMin),railing).setRotationFromEuler(-25,0,0);
      for(let index=0;index<5;index+=1){const t=index/4;this.box('StairRailPost',new Vec3(railX,0.9+rampTop*t,rampMin+(rampMax-rampMin)*t),new Vec3(0.08,1.35,0.08),railing);}
    }
    const grate=this.material(`building-grate-${this.selectedMap}`,new Color(54,60,58),0.92,0.24);
    for(const side of [-1,1])for(let strip=0;strip<5;strip+=1){
      const gx=x+side*(stairHalf+0.35+strip*Math.max(0.2,(sideWidth-0.5)/5));
      this.box('UpperGrating',new Vec3(gx,rampTop+0.11,z),new Vec3(0.075,0.035,depth-1.35),grate);
    }
    for(const side of [-1,1]){
      const railX=x+side*(width/2-0.62);
      this.box('UpperGuardRail',new Vec3(railX,rampTop+0.78,z),new Vec3(0.09,0.09,depth-1.5),railing);
      for(const dz of [-depth*0.32,0,depth*0.32])this.box('UpperGuardPost',new Vec3(railX,rampTop+0.45,z+dz),new Vec3(0.09,0.9,0.09),railing);
    }
    this.addObstacle('UpperSupplyCrate',x-width*0.3,z+depth*0.25,1.8,1.25,0.9,materials.military,rampTop);
    this.addObstacle('UpperWorkBench',x+width*0.3,z-depth*0.24,2.2,0.8,0.82,materials.rust,rampTop);
    this.box('UpperShelf',new Vec3(x+width*0.3,rampTop+1.55,z+depth*0.32),new Vec3(2.2,2.7,0.42),materials.dark);
    this.box('UpperCeilingLight',new Vec3(x,height-0.22,z),new Vec3(1.8,0.08,0.32),materials.lamp);
    this.coverPoints.push(new Vec3(x-width*0.3,rampTop,z+depth*0.05),new Vec3(x+width*0.3,rampTop,z-depth*0.08));
  }

  private addCityStreetDetails(materials: Record<string, Material>): void {
    for (const x of [-19, 19]) this.box('Sidewalk', new Vec3(x, 0.07, 0), new Vec3(4.8, 0.14, 176), materials.sidewalk);
    for (const z of [-36, 36]) this.box('CrossStreetWalk', new Vec3(0, 0.075, z), new Vec3(176, 0.15, 4.5), materials.sidewalk);
    const white = this.material('roadWhite', new Color(211, 211, 199), 0, 0.85);
    for (const z of [-39, -33, 33, 39]) for (let x = -12; x <= 12; x += 3) this.box('CrosswalkStripe', new Vec3(x, 0.16, z), new Vec3(1.5, 0.025, 0.45), white);
    for (const [x,z] of [[-23,-55],[23,-55],[-23,-8],[23,-8],[-23,55],[23,55]] as Array<[number,number]>) this.addStreetLight(x,z,materials);
    for (const [x,z] of [[-25,-39],[25,39],[-25,36],[25,-36]] as Array<[number,number]>) {
      this.box('UtilityBox', new Vec3(x,0.72,z), new Vec3(1.1,1.44,0.72), materials.military);
      this.box('UtilityDoor', new Vec3(x,0.76,z-0.38), new Vec3(0.72,0.94,0.04), materials.dark);
    }
  }

  private addSubway(materials: Record<string, Material>, attacker: Team): void {
    const floorY=-4,entryX=attacker==='blue'?-70:70;
    const rampMinZ=attacker==='blue'?6:-24,rampMaxZ=attacker==='blue'?24:-6;
    this.sublevelFloors.push({minX:-76,maxX:76,minZ:-32,maxZ:38,height:floorY});
    this.ramps.push({minX:entryX-4,maxX:entryX+4,minZ:rampMinZ,maxZ:rampMaxZ,height:floorY,
      fromZ:rampMinZ,toZ:rampMaxZ,fromHeight:attacker==='blue'?floorY:0,toHeight:attacker==='blue'?0:floorY});
    this.box('SubwayFloor',new Vec3(0,floorY-0.12,3),new Vec3(152,0.24,70),materials.concrete);
    this.addObstacle('SubwayWestWall',-76,3,0.5,70,3.45,materials.brick,floorY);
    this.addObstacle('SubwayEastWall',76,3,0.5,70,3.45,materials.brick,floorY);
    this.addObstacle('SubwaySouthWall',0,-32,152,0.5,3.45,materials.brick,floorY);
    this.addObstacle('SubwayNorthWall',0,38,152,0.5,3.45,materials.brick,floorY);
    this.addObstacle('SubwayRoof',0,3,152,70,0.35,materials.dark,-0.72);
    this.ceilings.push({minX:-76,maxX:76,minZ:-32,maxZ:38,clearance:3.25});
    for(let x=-60;x<=60;x+=15)for(const z of [-22,0,22]){this.addObstacle('SubwayColumn',x,z,0.8,0.8,3.25,materials.concrete,floorY);this.box('ColumnBand',new Vec3(x,floorY+1.45,z),new Vec3(0.88,0.22,0.88),materials.trim);}
    for(let i=0;i<9;i+=1){const t=(i+0.5)/9,z=attacker==='blue'?24-(i+0.5)*2:-24+(i+0.5)*2,y=-t*4;this.box('SubwayStep',new Vec3(entryX,y-0.08,z),new Vec3(8,0.16,2.05),materials.concrete);}
    this.addObstacle('EntranceWestWall',entryX-4.3,(rampMinZ+rampMaxZ)/2,0.5,18,4.5,materials.brick,floorY);
    this.addObstacle('EntranceEastWall',entryX+4.3,(rampMinZ+rampMaxZ)/2,0.5,18,4.5,materials.brick,floorY);
    const surfaceZ=attacker==='blue'?24:-24;
    this.box('MetroCanopy',new Vec3(entryX,2.7,surfaceZ),new Vec3(10,0.28,3.4),materials.dark);
    for(const x of [entryX-4.6,entryX+4.6])this.box('MetroCanopyPost',new Vec3(x,1.35,surfaceZ),new Vec3(0.2,2.7,0.2),materials.dark);
    this.box('MetroSign',new Vec3(entryX,2.25,surfaceZ+(attacker==='blue'?1.8:-1.8)),new Vec3(4.2,0.75,0.18),this.material('metroSign',new Color(34,78,128),0.12,0.45));
    this.box('SubwayPlatform',new Vec3(0,floorY+0.12,-12),new Vec3(140,0.24,10),materials.sidewalk);
    this.box('SubwayTrackBed',new Vec3(0,floorY+0.03,7),new Vec3(140,0.08,15),materials.dark);
    for(const z of [3,11])this.box('SubwayRail',new Vec3(0,floorY+0.12,z),new Vec3(140,0.12,0.15),materials.rust);
    for(let x=-60;x<=60;x+=20)this.box('SubwayLight',new Vec3(x,-0.95,0),new Vec3(5.5,0.08,0.32),materials.lamp);
    for(const [x,z,w,d,h,type] of [[-62,-18,4,2,1.2,'crate'],[-38,16,5,2,1.15,'sandbag'],[-10,-20,3,3,1.35,'crate'],[18,16,4,2,1.2,'barrier'],[42,-15,5,2,1.15,'sandbag'],[64,18,3,3,1.35,'crate']] as Array<[number,number,number,number,number,string]>){this.addObstacle(`SubwayCover-${type}`,x,z,w,d,h,type==='sandbag'?materials.sandbag:materials.dark,floorY);this.coverPoints.push(new Vec3(x,floorY,z+d/2+1));}
  }

  private addMilitaryDetails(materials: Record<string, Material>): void {
    const marking=this.material('baseMarking',new Color(211,205,164),0,0.88);
    this.box('ServiceRoad',new Vec3(0,0.025,-18),new Vec3(174,0.05,18),this.material('serviceRoad',new Color(54,57,53),0,0.94));
    for(let x=-72;x<=72;x+=12)this.box('RunwayDash',new Vec3(x,0.07,-18),new Vec3(5,0.025,0.22),marking);
    this.box('Helipad',new Vec3(-28,0.055,28),new Vec3(22,0.08,22),this.material('helipad',new Color(72,76,70),0,0.9));
    this.box('HelipadH1',new Vec3(-31,0.11,28),new Vec3(0.7,0.025,9),marking);
    this.box('HelipadH2',new Vec3(-25,0.11,28),new Vec3(0.7,0.025,9),marking);
    this.box('HelipadH3',new Vec3(-28,0.11,28),new Vec3(6,0.025,0.7),marking);
    for(const x of [-82,82])for(let z=-72;z<=72;z+=12){this.box('FencePost',new Vec3(x,1.25,z),new Vec3(0.16,2.5,0.16),materials.dark);this.box('FenceRail',new Vec3(x,1.45,z+5.8),new Vec3(0.1,0.1,11.4),materials.rust);}
    this.box('CheckpointRoof',new Vec3(-66,3.2,-17),new Vec3(13,0.3,8),materials.military);
    for(const x of [-72,-60])for(const z of [-20,-14])this.box('CheckpointPost',new Vec3(x,1.6,z),new Vec3(0.24,3.2,0.24),materials.dark);
    for(const [x,z] of [[-62,-6],[62,3],[-9,48],[12,-56]] as Array<[number,number]>){
      this.box('FloodlightPost',new Vec3(x,3.8,z),new Vec3(0.2,7.6,0.2),materials.dark);
      this.box('FloodlightBar',new Vec3(x,7.45,z),new Vec3(2.2,0.14,0.14),materials.dark);
      for(const dx of [-0.7,0.7])this.box('Floodlight',new Vec3(x+dx,7.3,z),new Vec3(0.55,0.32,0.3),materials.lamp);
    }
    this.box('AntennaMast',new Vec3(0,16.2,35),new Vec3(0.22,8,0.22),materials.dark);
    for(const y of [14,16,18])this.box('AntennaCrossbar',new Vec3(0,y,35),new Vec3(3.2,0.1,0.1),materials.rust);
    for(const [x,z] of [[-12,-31],[-8,-31],[-4,-31],[45,12],[49,12],[53,12]] as Array<[number,number]>) {
      this.cylinder('FuelDrum',new Vec3(x,0.55,z),0.78,1.1,materials.rust,this.worldRoot,'y');
      for(const y of [0.2,0.55,0.9])this.cylinder('DrumBand',new Vec3(x,y,z),0.83,0.055,materials.dark,this.worldRoot,'y');
    }
  }

  private createCityMap(): void {
    const asphalt = this.material('asphalt', new Color(48, 52, 55), 0, 0.9);
    const m = this.baseMapMaterials();m.asphalt=asphalt;const entryX=this.missionOwner==='blue'?-70:70;const entryZ=this.missionOwner==='blue'?{min:6,max:24}:{min:-24,max:-6};this.createMapBounds(m.asphalt,m.concrete,{minX:entryX-4,maxX:entryX+4,minZ:entryZ.min,maxZ:entryZ.max});
    this.addCityStreetDetails(m);
    for (const x of [-63, -28, 28, 63]) this.addFacadeBuilding(x, -67, 22, 18, 13 + Math.abs(x % 3), m);
    for (const x of [-64, 64]) this.addFacadeBuilding(x, 55, 24, 28, 16, m);
    this.addHollowBuilding(-42, 30, 20, 22, 8, m, 'right');
    this.addHollowBuilding(39, 33, 22, 20, 9, m, 'left');
    this.addHollowBuilding(-6, -43, 24, 18, 7, m, 'right');
    this.addHollowBuilding(-65, -5, 18, 18, 7, m, 'right');
    this.addHollowBuilding(64, -12, 18, 20, 8, m, 'left');
    this.addLayeredDistrictDetails('city',m,0);
    for (let z = -80; z <= 80; z += 12) this.box('RoadMark', new Vec3(0, 0.02, z), new Vec3(0.18, 0.03, 5), this.material('roadMark', new Color(205, 194, 139), 0, 0.9));
    const covers: Array<[number,number,number,number,number,string]> = [
      [-66,-38,7,2.8,1.45,'vehicle'],[-51,-22,4,4,1.4,'crate'],[-37,-16,2,8,1.2,'barrier'],[-21,-29,7,2,1.1,'sandbag'],
      [-8,-18,5,2,1.4,'crate'],[10,-28,7,2.8,1.45,'vehicle'],[25,-18,2,8,1.2,'barrier'],[42,-29,5,3,1.4,'crate'],
      [63,-36,7,2.8,1.45,'vehicle'],[-70,1,5,3,1.4,'crate'],[-54,12,2,8,1.2,'barrier'],[-34,4,7,2.8,1.45,'vehicle'],
      [-18,11,5,2,1.35,'crate'],[0,5,9,1.3,1.0,'sandbag'],[17,-2,4,4,1.4,'crate'],[33,9,2,8,1.2,'barrier'],
      [51,1,7,2.8,1.45,'vehicle'],[68,15,5,3,1.4,'crate'],[-66,45,2,8,1.2,'barrier'],[-52,64,5,3,1.4,'crate'],
      [-27,58,7,2.8,1.45,'vehicle'],[-12,42,2,8,1.2,'barrier'],[8,55,5,3,1.4,'crate'],[23,46,8,1.3,1.0,'sandbag'],
      [49,60,7,2.8,1.45,'vehicle'],[69,44,2,8,1.2,'barrier'],[-30,25,4,3,1.3,'crate'],[26,26,4,3,1.3,'crate'],
    ];
    for (const cover of covers) this.addCover(...cover, m);
    this.addSubway(m,this.missionOwner);
    this.createCapturePoint('A', this.openObjectivePosition(-55,-30)); this.createCapturePoint('B', this.openObjectivePosition(-24,24));
    this.createCapturePoint('C', this.openObjectivePosition(0,16)); this.createCapturePoint('D', this.openObjectivePosition(34,-24));
    this.createCapturePoint('E', this.openObjectivePosition(this.missionOwner==='blue'?58:-58,16,-4));
  }

  private createMilitaryBaseMap(): void {
    const m = this.baseMapMaterials(); const ground = this.material('baseGround', new Color(67, 72, 62), 0, 0.95); this.createMapBounds(ground, m.military);
    this.addMilitaryDetails(m);
    this.addHollowBuilding(-48, -48, 28, 22, 8, m, 'right');
    this.addHollowBuilding(45, 44, 30, 24, 9, m, 'left');
    this.addHollowBuilding(42, -49, 34, 25, 10, m, 'left');
    this.addHollowBuilding(-52, 48, 25, 30, 8, m, 'right');
    this.addLayeredDistrictDetails('military',m,0);
    this.addObstacle('ControlTower', 0, 35, 10, 10, 12, m.military);
    this.box('TowerRoof', new Vec3(0, 12.2, 35), new Vec3(12, 0.4, 12), m.concrete);
    this.platforms.push({ minX: -5, maxX: 5, minZ: 30, maxZ: 40, height: 12.4 });
    this.addLadder(5.55, 35, 12.4, false, m, -1, 0);
    const covers: Array<[number,number,number,number,number,string]> = [
      [-72,-58,6,4,1.6,'weapon-crate'],[-62,-29,8,2,1.1,'sandbag'],[-49,-10,7,3,1.5,'vehicle'],[-29,-56,5,4,1.6,'weapon-crate'],
      [-22,-35,2,10,1.4,'barrier'],[-5,-52,6,4,1.6,'weapon-crate'],[13,-61,8,2,1.1,'sandbag'],[24,-38,7,3,1.5,'vehicle'],
      [58,-25,5,4,1.6,'weapon-crate'],[72,-8,2,10,1.4,'barrier'],[-70,5,7,3,1.5,'vehicle'],[-53,21,5,4,1.6,'weapon-crate'],
      [-34,8,8,2,1.1,'sandbag'],[-18,22,2,10,1.4,'barrier'],[0,-4,6,4,1.6,'weapon-crate'],[18,12,7,3,1.5,'vehicle'],
      [38,-2,8,2,1.1,'sandbag'],[58,18,5,4,1.6,'weapon-crate'],[73,34,7,3,1.5,'vehicle'],[-68,69,5,4,1.6,'weapon-crate'],
      [-38,70,2,10,1.4,'barrier'],[-19,56,7,3,1.5,'vehicle'],[4,66,8,2,1.1,'sandbag'],[25,56,5,4,1.6,'weapon-crate'],
      [48,71,2,10,1.4,'barrier'],[67,61,6,4,1.6,'weapon-crate'],[-8,-24,10,1.4,1.05,'sandbag'],[8,27,10,1.4,1.05,'sandbag'],
      [-42,-18,5,3,1.45,'weapon-crate'],[-16,2,7,2.8,1.45,'vehicle'],[31,29,6,3,1.45,'weapon-crate'],[54,-58,8,1.3,1.0,'sandbag'],
    ];
    for (const cover of covers) this.addCover(...cover, m);
    this.createCapturePoint('A', this.openObjectivePosition(-58,-28)); this.createCapturePoint('B', this.openObjectivePosition(-28,28));
    this.createCapturePoint('C', this.openObjectivePosition(0,-15)); this.createCapturePoint('D', this.openObjectivePosition(30,-26));
    this.createCapturePoint('E', this.openObjectivePosition(58,30));
  }

  private rebuildNavigation(): void {
    for (let x = -82; x <= 82; x += 6) for (let z = -82; z <= 82; z += 6) {
      if (!this.blocked(x, z, 0.65)) this.navPoints.push(new Vec3(x, 0, z));
    }
    for(const platform of this.platforms){
      if(platform.height<3||platform.height>13)continue;
      for(let x=platform.minX+0.7;x<=platform.maxX-0.7;x+=2.8)for(let z=platform.minZ+0.7;z<=platform.maxZ-0.7;z+=2.8){
        if(!this.blocked(x,z,0.48,platform.height,PLAYER_HEIGHT.stand))this.upperFloorNavPoints.push(new Vec3(x,platform.height,z));
      }
    }
    for (let x = -72; x <= 72; x += 4) for (let z = -30; z <= 36; z += 4) {
      if (this.isSublevelFloor(x,z) && !this.blocked(x,z,0.55,-4)) this.subwayNavPoints.push(new Vec3(x,-4,z));
    }
  }

  private createCapturePoint(id: string, position: Vec3): void {
    const mat = this.material(`point-${id}`, new Color(225, 190, 55), 0.15, 0.5);
    const ring = this.box(`Point-${id}`, new Vec3(position.x, position.y + 0.04, position.z), new Vec3(6, 0.08, 6), mat);
    this.capturePoints.push({ id, position, owner: null, progress: 0, progressTeam: null, ring });
  }

  private openObjectivePosition(x:number,z:number,y=0):Vec3{
    const offsets:Array<[number,number]>=[[0,0],[6,0],[-6,0],[0,6],[0,-6],[6,6],[-6,6],[6,-6],[-6,-6],[12,0],[-12,0],[0,12],[0,-12]];
    for(const [dx,dz] of offsets){const px=clamp(x+dx,-MAP_HALF+7,MAP_HALF-7),pz=clamp(z+dz,-MAP_HALF+7,MAP_HALF-7);if(!this.blocked(px,pz,3,y,0.2))return new Vec3(px,y,pz);}
    return new Vec3(x,y,z);
  }

  private createWeaponView(): void {
    this.weaponView = new Node('WeaponView'); this.cameraNode.addChild(this.weaponView);
    this.weaponView.setPosition(0.34, -0.32, -0.72);
    const metal = this.material('weaponMetal', new Color(35, 39, 39), 0.94, 0.2);
    const steel = this.material('weaponSteel', new Color(74, 77, 74), 0.98, 0.14);
    const polymer = this.material('weaponPolymer', new Color(20, 23, 22), 0.16, 0.68);
    const wood = this.material('weaponWood', new Color(104, 62, 34), 0.03, 0.62);
    this.box('Receiver', new Vec3(0, 0, 0), new Vec3(0.16, 0.14, 0.62), metal, this.weaponView);
    this.box('UpperReceiver',new Vec3(0,0.085,-0.02),new Vec3(0.145,0.055,0.48),steel,this.weaponView);
    this.box('TopRail', new Vec3(0, 0.09, -0.03), new Vec3(0.11, 0.035, 0.52), metal, this.weaponView);
    this.box('Handguard', new Vec3(0, -0.005, -0.3), new Vec3(0.14, 0.12, 0.34), polymer, this.weaponView);
    this.box('GasTube',new Vec3(0,0.075,-0.38),new Vec3(0.065,0.055,0.4),steel,this.weaponView);
    this.box('Barrel', new Vec3(0, 0.02, -0.48), new Vec3(0.055, 0.055, 0.48), metal, this.weaponView);
    this.box('MuzzleBrake', new Vec3(0, 0.02, -0.735), new Vec3(0.075, 0.075, 0.12), metal, this.weaponView);
    this.box('Stock', new Vec3(0, -0.03, 0.42), new Vec3(0.13, 0.15, 0.32), polymer, this.weaponView);
    this.box('StockPad',new Vec3(0,-0.03,0.59),new Vec3(0.145,0.17,0.055),polymer,this.weaponView);
    this.box('Magazine', new Vec3(0, -0.14, 0.04), new Vec3(0.11, 0.26, 0.16), polymer, this.weaponView);
    this.box('MagazineLower',new Vec3(0,-0.27,0.065),new Vec3(0.105,0.16,0.14),polymer,this.weaponView);
    this.box('BoxMagazine',new Vec3(0,-0.13,0.02),new Vec3(0.25,0.23,0.26),polymer,this.weaponView);
    this.box('PistolGrip',new Vec3(0,-0.16,0.24),new Vec3(0.105,0.24,0.13),polymer,this.weaponView);
    this.box('TriggerGuard',new Vec3(0,-0.105,0.12),new Vec3(0.09,0.035,0.15),steel,this.weaponView);
    this.box('VerticalGrip',new Vec3(0,-0.17,-0.28),new Vec3(0.08,0.25,0.09),polymer,this.weaponView).active=false;
    for(const [name,position,scale] of [
      ['AKMagazineCurve',new Vec3(0,-0.2,0.04),new Vec3(0.13,0.34,0.18)],
      ['AKGasBlock',new Vec3(0,0.08,-0.52),new Vec3(0.1,0.12,0.12)],
      ['AKFrontSightBlock',new Vec3(0,0.14,-0.68),new Vec3(0.12,0.18,0.1)],
      ['AKStockAngle',new Vec3(0,-0.04,0.49),new Vec3(0.14,0.17,0.38)],
      ['M16CarryHandleDetail',new Vec3(0,0.2,0),new Vec3(0.12,0.12,0.38)],
      ['M16TriangleHandguard',new Vec3(0,-0.005,-0.3),new Vec3(0.18,0.15,0.36)],
      ['M16FrontPost',new Vec3(0,0.16,-0.64),new Vec3(0.045,0.16,0.045)],
      ['MP5CockingTube',new Vec3(-0.09,0.09,-0.28),new Vec3(0.05,0.05,0.42)],
      ['MP5RetractStock',new Vec3(0,-0.03,0.42),new Vec3(0.04,0.04,0.38)],
      ['MP5MagazineCurve',new Vec3(0,-0.2,0.05),new Vec3(0.11,0.3,0.15)],
      ['RPKBipodMount',new Vec3(0,-0.12,-0.5),new Vec3(0.18,0.08,0.1)],
      ['PKMFeedTray',new Vec3(0,0.16,-0.04),new Vec3(0.25,0.08,0.4)],
      ['SniperBoltBody',new Vec3(0.1,0.04,0.12),new Vec3(0.04,0.04,0.3)],
      ['SniperCheekPiece',new Vec3(0,0.06,0.4),new Vec3(0.16,0.1,0.3)],
      ['HMGReceiverTop',new Vec3(0,0.18,0),new Vec3(0.3,0.1,0.42)],
    ] as Array<[string,Vec3,Vec3]>){this.box(name,position,scale,metal,this.weaponView).active=false;}
    this.box('BarrelSleeve',new Vec3(0,0.02,-0.62),new Vec3(0.085,0.085,0.42),steel,this.weaponView).active=false;
    this.box('ChargingHandle',new Vec3(-0.095,0.08,0.13),new Vec3(0.09,0.035,0.13),steel,this.weaponView);
    this.box('Bolt',new Vec3(0.085,0.025,-0.01),new Vec3(0.016,0.07,0.24),steel,this.weaponView);
    this.box('CarryHandle',new Vec3(0,0.17,0),new Vec3(0.11,0.1,0.32),polymer,this.weaponView);
    this.box('CarryHandleTop',new Vec3(0,0.23,0),new Vec3(0.08,0.045,0.34),steel,this.weaponView).active=false;
    this.box('CarryHandleFront',new Vec3(0,0.18,-0.14),new Vec3(0.075,0.12,0.045),steel,this.weaponView).active=false;
    this.box('CarryHandleRear',new Vec3(0,0.18,0.14),new Vec3(0.075,0.12,0.045),steel,this.weaponView).active=false;
    this.box('ReceiverSidePanel',new Vec3(0.09,0,-0.02),new Vec3(0.018,0.1,0.34),steel,this.weaponView).active=false;
    this.box('StockCheek',new Vec3(0,0.06,0.42),new Vec3(0.12,0.07,0.24),polymer,this.weaponView).active=false;
    this.box('MagazineBase',new Vec3(0,-0.38,0.07),new Vec3(0.13,0.055,0.16),steel,this.weaponView).active=false;
    for(let i=0;i<5;i+=1)this.box(`HandguardRib${i}`,new Vec3(0,0,-0.22-i*0.065),new Vec3(0.155,0.135,0.018),steel,this.weaponView).active=false;
    this.box('BipodLeft',new Vec3(-0.1,-0.17,-0.48),new Vec3(0.035,0.34,0.035),steel,this.weaponView);
    this.box('BipodRight',new Vec3(0.1,-0.17,-0.48),new Vec3(0.035,0.34,0.035),steel,this.weaponView);
    this.opticView = this.box('Optic', new Vec3(0, 0.14, -0.05), new Vec3(0.1, 0.12, 0.18), polymer, this.weaponView);
    this.opticView.active = false;
    const lens = this.box('OpticLens', new Vec3(0, 0.14, -0.15), new Vec3(0.085, 0.085, 0.02), this.material('opticLens',new Color(48,96,112),0.35,0.18), this.weaponView);
    lens.active = false;
    this.box('ScopeTube',new Vec3(0,0.16,-0.02),new Vec3(0.12,0.12,0.42),metal,this.weaponView).active=false;
    this.box('ScopeBell',new Vec3(0,0.16,-0.25),new Vec3(0.17,0.17,0.13),metal,this.weaponView).active=false;
    this.box('ScopeEyepiece',new Vec3(0,0.16,0.22),new Vec3(0.145,0.145,0.12),metal,this.weaponView).active=false;
    this.box('ScopeMountFront',new Vec3(0,0.105,-0.13),new Vec3(0.12,0.1,0.045),steel,this.weaponView).active=false;
    this.box('ScopeMountRear',new Vec3(0,0.105,0.12),new Vec3(0.12,0.1,0.045),steel,this.weaponView).active=false;
    this.box('RearSight', new Vec3(0, 0.135, 0.12), new Vec3(0.08, 0.08, 0.035), metal, this.weaponView);
    this.box('FrontSight', new Vec3(0, 0.14, -0.56), new Vec3(0.035, 0.12, 0.035), metal, this.weaponView);
    this.box('EjectionPort', new Vec3(0.083, 0.025, -0.04), new Vec3(0.012, 0.07, 0.2), this.material('ejectionPort',new Color(16,17,16),0.6,0.3), this.weaponView);
    const detailDark=this.material('weaponDetailDark',new Color(11,13,13),0.78,0.27),edge=this.material('weaponEdge',new Color(94,97,91),0.97,0.16);
    this.cylinder('BarrelTube',new Vec3(0,0.02,-0.48),0.055,0.48,metal,this.weaponView).active=false;
    this.cylinder('GasTubeRound',new Vec3(0,0.075,-0.38),0.055,0.4,steel,this.weaponView).active=false;
    this.cylinder('MuzzleTube',new Vec3(0,0.02,-0.735),0.075,0.12,steel,this.weaponView).active=false;
    this.cylinder('DeltaRing',new Vec3(0,0.01,-0.2),0.16,0.08,edge,this.weaponView).active=false;
    this.cylinder('ForwardAssist',new Vec3(0.1,0.065,0.12),0.055,0.06,edge,this.weaponView,'x').active=false;
    this.cylinder('Selector',new Vec3(0.1,-0.015,0.14),0.045,0.025,edge,this.weaponView,'x').active=false;
    this.cylinder('MagRelease',new Vec3(0.1,-0.045,0.01),0.035,0.025,edge,this.weaponView,'x').active=false;
    this.cylinder('ReceiverPinFront',new Vec3(0.1,-0.02,-0.18),0.035,0.025,edge,this.weaponView,'x').active=false;
    this.cylinder('ReceiverPinRear',new Vec3(0.1,-0.02,0.18),0.035,0.025,edge,this.weaponView,'x').active=false;
    this.box('BoltCatch',new Vec3(0.095,0.015,-0.08),new Vec3(0.018,0.07,0.035),edge,this.weaponView).active=false;
    this.box('Trigger',new Vec3(0,-0.15,0.1),new Vec3(0.025,0.09,0.025),edge,this.weaponView).active=false;
    this.box('HeatShieldTop',new Vec3(0,0.105,-0.34),new Vec3(0.13,0.03,0.34),steel,this.weaponView).active=false;
    for(let i=0;i<12;i+=1)this.box(`RailTooth${i}`,new Vec3(0,0.125,-0.25+i*0.045),new Vec3(0.14,0.025,0.018),edge,this.weaponView).active=false;
    for(let i=0;i<8;i+=1)for(const side of [-1,1])this.box(`Vent${side<0?'L':'R'}${i}`,new Vec3(side*0.08,0,-0.24-i*0.035),new Vec3(0.012,0.045,0.022),detailDark,this.weaponView).active=false;
    for(let i=0;i<6;i+=1)this.box(`GripRib${i}`,new Vec3(0,-0.09-i*0.026,0.25),new Vec3(0.115,0.012,0.14),edge,this.weaponView).active=false;
    this.box('StockRodL',new Vec3(-0.055,-0.015,0.43),new Vec3(0.025,0.025,0.36),edge,this.weaponView).active=false;
    this.box('StockRodR',new Vec3(0.055,-0.015,0.43),new Vec3(0.025,0.025,0.36),edge,this.weaponView).active=false;
    this.box('SlingLoopFront',new Vec3(-0.09,-0.08,-0.4),new Vec3(0.025,0.11,0.04),edge,this.weaponView).active=false;
    this.box('SlingLoopRear',new Vec3(-0.09,-0.08,0.44),new Vec3(0.025,0.11,0.04),edge,this.weaponView).active=false;
    for(const side of [-1,1])this.box(`MuzzlePort${side<0?'L':'R'}`,new Vec3(side*0.041,0.02,-0.75),new Vec3(0.018,0.025,0.055),detailDark,this.weaponView).active=false;
    this.box('FeedCover',new Vec3(0,0.14,-0.02),new Vec3(0.25,0.07,0.34),steel,this.weaponView).active=false;
    for(let i=0;i<6;i++)this.cylinder(`AmmoLink${i}`,new Vec3(-0.17-i*0.035,-0.06,0.01),0.025,0.055,this.material('cartridge',new Color(175,127,45),0.88,0.22),this.weaponView,'y').active=false;
    this.cylinder('BoltHandle',new Vec3(0.13,0.04,0.16),0.035,0.18,edge,this.weaponView,'x').active=false;
    this.box('SpadeGripL',new Vec3(-0.13,-0.1,0.46),new Vec3(0.08,0.24,0.12),polymer,this.weaponView).active=false;
    this.box('SpadeGripR',new Vec3(0.13,-0.1,0.46),new Vec3(0.08,0.24,0.12),polymer,this.weaponView).active=false;
    this.box('FrontSightGuardL',new Vec3(-0.045,0.14,-0.56),new Vec3(0.025,0.14,0.025),edge,this.weaponView).active=false;
    this.box('FrontSightGuardR',new Vec3(0.045,0.14,-0.56),new Vec3(0.025,0.14,0.025),edge,this.weaponView).active=false;
    this.cylinder('OpticBodyRound',new Vec3(0,0.15,-0.03),0.11,0.2,polymer,this.weaponView).active=false;
    this.cylinder('ScopeTubeRound',new Vec3(0,0.17,-0.02),0.12,0.44,metal,this.weaponView).active=false;
    this.cylinder('ScopeBellRound',new Vec3(0,0.17,-0.29),0.18,0.16,metal,this.weaponView).active=false;
    this.cylinder('ScopeEyepieceRound',new Vec3(0,0.17,0.25),0.15,0.14,metal,this.weaponView).active=false;
    this.cylinder('ScopeTurretTop',new Vec3(0,0.26,-0.02),0.055,0.08,edge,this.weaponView,'y').active=false;
    this.cylinder('ScopeTurretSide',new Vec3(0.1,0.17,-0.02),0.05,0.08,edge,this.weaponView,'x').active=false;
    this.cylinder('OpticLensRound',new Vec3(0,0.17,-0.38),0.16,0.018,this.material('opticLensRound',new Color(38,86,104),0.42,0.12),this.weaponView).active=false;
    this.box('LeftHand', new Vec3(-0.09, -0.12, -0.2), new Vec3(0.11, 0.12, 0.32), this.material('glove', new Color(31, 37, 36), 0.05, 0.9), this.weaponView);
    this.box('RightHand', new Vec3(0.11, -0.14, 0.2), new Vec3(0.12, 0.15, 0.25), this.material('glove', new Color(31, 37, 36), 0.05, 0.9), this.weaponView);
    this.createZhongzheng3DView();
    void wood;
  }

  /** A dedicated, all-geometry viewmodel for the Chinese rifle.
   *
   * PNG assets remain available under assets/resources for catalogue/reference
   * screens, but this node is the first-person source of truth. Keeping the
   * parts in a separate root lets ADS hide the stock and handguard instead of
   * dragging a full horizontal image through the sight picture.
   */
  private createZhongzheng3DView(): void {
    const root = new Node('Zhongzheng3DViewModel');
    root.active = false;
    this.weaponView.addChild(root);
    this.zhongzheng3D = root;
    const wood = this.material('zhongzhengWood3D', new Color(132, 78, 38), 0.04, 0.86);
    const woodDark = this.material('zhongzhengWoodDark3D', new Color(92, 50, 25), 0.03, 0.9);
    const metal = this.material('zhongzhengMetal3D', new Color(62, 68, 68), 0.62, 0.46);
    const steel = this.material('zhongzhengSteel3D', new Color(126, 132, 128), 0.72, 0.3);
    const dark = this.material('zhongzhengDetail3D', new Color(42, 46, 45), 0.48, 0.52);
    const glove = this.material('zhongzhengGlove3D', new Color(53, 59, 55), 0.05, 0.92);
    const addBox = (name: string, position: Vec3, scale: Vec3, material: Material): Node => {
      const node = this.box(`Zhongzheng3D:${name}`, position, scale, material, root);
      this.zhongzheng3DParts.set(name, node);
      return node;
    };
    const addCylinder = (name: string, position: Vec3, diameter: number, length: number, material: Material, axis: 'x'|'y'|'z' = 'z'): Node => {
      const node = this.cylinder(`Zhongzheng3D:${name}`, position, diameter, length, material, root, axis);
      this.zhongzheng3DParts.set(name, node);
      return node;
    };
    addBox('Stock', new Vec3(0, -0.01, 0.53), new Vec3(0.16, 0.2, 0.68), wood);
    addBox('StockComb', new Vec3(0, 0.105, 0.4), new Vec3(0.15, 0.075, 0.34), woodDark);
    addBox('ButtPad', new Vec3(0, -0.01, 0.89), new Vec3(0.175, 0.21, 0.065), dark);
    addBox('Receiver', new Vec3(0, 0.015, 0.01), new Vec3(0.2, 0.17, 0.74), metal);
    addBox('ReceiverTop', new Vec3(0, 0.112, -0.01), new Vec3(0.17, 0.045, 0.67), steel);
    addBox('ReceiverBand', new Vec3(0, 0.01, -0.31), new Vec3(0.215, 0.19, 0.08), steel);
    addBox('Handguard', new Vec3(0, -0.005, -0.61), new Vec3(0.165, 0.15, 0.58), wood);
    addBox('HandguardTip', new Vec3(0, 0.005, -0.91), new Vec3(0.175, 0.16, 0.08), steel);
    addCylinder('Barrel', new Vec3(0, 0.06, -0.93), 0.065, 1.18, metal);
    addCylinder('BarrelSleeve', new Vec3(0, 0.06, -1.48), 0.095, 0.11, steel);
    addBox('MuzzleCrown', new Vec3(0, 0.06, -1.56), new Vec3(0.11, 0.11, 0.06), dark);
    addBox('FrontSightPost', new Vec3(0, 0.155, -1.3), new Vec3(0.035, 0.15, 0.035), steel);
    addBox('FrontSightGuardL', new Vec3(-0.052, 0.145, -1.3), new Vec3(0.025, 0.14, 0.03), steel);
    addBox('FrontSightGuardR', new Vec3(0.052, 0.145, -1.3), new Vec3(0.025, 0.14, 0.03), steel);
    addBox('RearSightBase', new Vec3(0, 0.155, 0.25), new Vec3(0.12, 0.055, 0.14), steel);
    addBox('RearSightAperture', new Vec3(0, 0.205, 0.21), new Vec3(0.035, 0.09, 0.035), dark);
    addBox('BoltBody', new Vec3(0.115, 0.075, 0.21), new Vec3(0.035, 0.07, 0.34), steel);
    addCylinder('BoltHandle', new Vec3(0.16, 0.075, 0.3), 0.045, 0.18, steel, 'x');
    addBox('BoltKnob', new Vec3(0.26, 0.075, 0.3), new Vec3(0.08, 0.08, 0.08), dark);
    addBox('Magazine', new Vec3(0, -0.16, 0.02), new Vec3(0.115, 0.3, 0.18), dark);
    addBox('MagazineFloorplate', new Vec3(0, -0.325, 0.02), new Vec3(0.13, 0.045, 0.2), steel);
    addBox('TriggerGuard', new Vec3(0, -0.105, 0.16), new Vec3(0.1, 0.04, 0.2), steel);
    addBox('Trigger', new Vec3(0, -0.145, 0.18), new Vec3(0.03, 0.09, 0.03), dark);
    addBox('FrontBand', new Vec3(0, -0.005, -0.93), new Vec3(0.2, 0.18, 0.06), steel);
    addBox('LeftHand', new Vec3(-0.105, -0.13, -0.55), new Vec3(0.12, 0.14, 0.28), glove);
    addBox('RightHand', new Vec3(0.12, -0.14, 0.28), new Vec3(0.13, 0.16, 0.25), glove);
    const flash = addBox('MuzzleFlash', new Vec3(0, 0.06, -1.66), new Vec3(0.18, 0.18, 0.28), this.material('zhongzhengMuzzleFlash3D', new Color(255, 174, 55), 0.05, 0.2));
    flash.active = false;
    this.zhongzheng3DMuzzleFlash = flash;
  }

  private updateZhongzheng3DViewModel(dt = 0): void {
    const root = this.zhongzheng3D;
    const p = this.player;
    const active = Boolean(root && p?.alive && !p.vehicle && p.weaponId === 'zhongzheng-shi');
    if (!root) return;
    root.active = active;
    if (!active) { this.zhongzheng3DMuzzleFlashTime=0; if(this.zhongzheng3DMuzzleFlash)this.zhongzheng3DMuzzleFlash.active=false; return; }
    const profile = WEAPON_VIEWMODEL_PROFILES['zhongzheng-shi']!;
    const stance = p!.action.stance;
    const ads = this.adsTarget;
    const reload = p!.weapon.reloading;
    const moving = this.keyState.has(KeyCode.KEY_W) || this.keyState.has(KeyCode.KEY_A) || this.keyState.has(KeyCode.KEY_S) || this.keyState.has(KeyCode.KEY_D);
    const bob = moving && !ads ? Math.sin(this.matchClock * (stance === 'stand' ? 10.5 : stance === 'crouch' ? 8 : 5.5)) : 0;
    const stanceY = stance === 'prone' ? -0.17 : stance === 'crouch' ? -0.085 : 0;
    const stancePitch = stance === 'prone' ? 7 : stance === 'crouch' ? 3 : 0;
    const stanceRoll = stance === 'prone' ? -4 : stance === 'crouch' ? -2 : 0;
    const [px, py, pz] = ads ? profile.adsPosition : profile.hipPosition;
    const [rx, ry, rz] = ads ? profile.adsRotation : profile.hipRotation;
    const swayX = bob * (stance === 'stand' ? 0.018 : 0.009);
    const swayY = moving && !ads ? Math.abs(bob) * 0.011 : 0;
    const reloadT = this.reloadAnimationDuration > 0 ? Math.min(1, this.reloadAnimationTime / this.reloadAnimationDuration) : 0;
    const reloadEase = Math.sin(reloadT * Math.PI);
    root.setPosition(px + swayX, py + stanceY - swayY + (reload ? profile.reloadDrop * reloadEase : 0), pz + this.weaponKick * 0.42);
    root.setRotationFromEuler(rx + stancePitch + (reload ? -10 * reloadEase : 0), ry, rz + stanceRoll + (reload ? -12 * reloadEase : 0));
    const scale = ads ? profile.adsScale : stance === 'prone' ? profile.hipScale * 0.92 : stance === 'crouch' ? profile.hipScale * 0.96 : profile.hipScale;
    root.setScale(scale, scale, scale);
    const part = (name: string): Node | undefined => this.zhongzheng3DParts.get(name);
    const full = !ads;
    for (const name of ['Stock','StockComb','ButtPad','Handguard','HandguardTip','Magazine','MagazineFloorplate','LeftHand','RightHand']) {
      const node = part(name); if (node) node.active = full;
    }
    for (const name of ['Receiver','ReceiverTop','ReceiverBand','Barrel','BarrelSleeve','MuzzleCrown','FrontBand','FrontSightPost','FrontSightGuardL','FrontSightGuardR','RearSightBase','RearSightAperture','BoltBody','BoltHandle','BoltKnob','TriggerGuard','Trigger']) {
      const node = part(name); if (node) node.active = true;
    }
    const hand = part('LeftHand');
    const magazine = part('Magazine');
    const magazineFloorplate = part('MagazineFloorplate');
    const reloadOffset = reload ? -0.24 * reloadEase : 0;
    if (magazine) magazine.setPosition(0, -0.16 + reloadOffset, 0.02);
    if (magazineFloorplate) magazineFloorplate.setPosition(0, -0.325 + reloadOffset, 0.02);
    if (hand) hand.setPosition(full ? new Vec3(-0.105, -0.13 - 0.16 * reloadEase, -0.55 + 0.18 * reloadEase) : new Vec3(-0.085, -0.09, -0.12));
    const bolt = part('BoltHandle');
    if (bolt) bolt.setPosition(reload ? new Vec3(0.205, 0.075, 0.34 + 0.11 * reloadEase) : new Vec3(0.16, 0.075, 0.3));
    this.zhongzheng3DMuzzleFlashTime = Math.max(0, this.zhongzheng3DMuzzleFlashTime - dt);
    // The flash is attached to the local muzzle, so it remains visible during
    // ADS without adding another world-space flash or gameplay event.
    if (this.zhongzheng3DMuzzleFlash) this.zhongzheng3DMuzzleFlash.active = this.zhongzheng3DMuzzleFlashTime > 0;
    void dt;
  }

  private createUi(): void {
    const uiCameraNode = new Node('UICamera'); this.sceneRoot.addChild(uiCameraNode); uiCameraNode.layer = Layers.Enum.UI_2D;
    const uiCamera = uiCameraNode.addComponent(Camera); uiCamera.projection = Camera.ProjectionType.ORTHO;
    uiCamera.orthoHeight = this.viewHeight / 2; uiCamera.visibility = Layers.Enum.UI_2D; uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
    this.uiRoot = new Node('Canvas'); this.sceneRoot.addChild(this.uiRoot); this.uiRoot.layer = Layers.Enum.UI_2D;
    const transform = this.uiRoot.addComponent(UITransform); transform.setContentSize(this.viewWidth, this.viewHeight);
    const canvas = this.uiRoot.addComponent(Canvas); canvas.cameraComponent = uiCamera; canvas.alignCanvasWithScreen = true;
    const hud = new Node('HUD'); hud.layer = Layers.Enum.UI_2D; this.uiRoot.addChild(hud);
    const ht = hud.addComponent(UITransform); ht.setContentSize(this.viewWidth, this.viewHeight);
    this.hudGraphics = hud.addComponent(Graphics);
    const hudLeft=this.safeRect.x,hudRight=this.safeRect.x+this.safeRect.width,hudBottom=this.safeRect.y;
    const combatPanelX=hudRight-230;
    this.createLabel('score', new Vec3(0, this.viewHeight / 2 - 54), 30, hud);
    this.createLabel('time', new Vec3(0, this.viewHeight / 2 - 94), 26, hud);
    this.createLabel('health',new Vec3(hudLeft+180,hudBottom+72),28,hud,300);
    this.createLabel('ammo',new Vec3(combatPanelX,hudBottom+208),32,hud,410);
    this.createLabel('items',new Vec3(combatPanelX,hudBottom+169),21,hud,410);
    this.createLabel('slots',new Vec3(combatPanelX,hudBottom+132),16,hud,430);
    this.createLabel('weapon',new Vec3(combatPanelX,hudBottom+250),22,hud,410);
    const objectiveLabel=this.createLabel('objective', new Vec3(0, this.viewHeight / 2 - 136), 20, hud);objectiveLabel.node.getComponent(UITransform)?.setContentSize(1500,48);
    this.createLabel('message', new Vec3(0, 105), 28, hud);
    this.createLabel('respawn', new Vec3(0, 20), 46, hud);
    this.drawHud();
    this.scopeOverlay = new Node('ScopeOverlay'); this.scopeOverlay.layer = Layers.Enum.UI_2D; hud.addChild(this.scopeOverlay);
    this.scopeOverlay.addComponent(UITransform).setContentSize(this.viewWidth,this.viewHeight);
    this.scopeGraphics = this.scopeOverlay.addComponent(Graphics);this.scopeOverlay.setSiblingIndex(0);this.scopeOverlay.active=false;
    this.makeHudActionButton('手雷 [G] · 2','grenade',new Vec3(hudRight-315,hudBottom+68),new Vec2(170,54),new Color(67,73,64,235));
    this.makeHudActionButton('医疗 [H] · 1','medkit',new Vec3(hudRight-120,hudBottom+68),new Vec2(170,54),new Color(52,83,71,235));
    this.hudActionCenters.grenade.set(hudRight-315,hudBottom+68);
    this.hudActionCenters.medkit.set(hudRight-120,hudBottom+68);
    this.createWebCombatHud();
  }

  private createWebCombatHud(): void {
    if (typeof document === 'undefined' || this.webHudRoot) return;
    const root = document.createElement('div');
    root.id = 'city-front-combat-hud';
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '2147483000', display: 'none',
      pointerEvents: 'none', color: '#f4f7f2', fontFamily: 'Arial, Helvetica, sans-serif',
      letterSpacing: '0', textShadow: '0 2px 4px rgba(0,0,0,.95)',
    });

    const health = document.createElement('div');
    Object.assign(health.style, {
      position: 'absolute', left: 'max(24px, env(safe-area-inset-left))',
      bottom: 'max(24px, env(safe-area-inset-bottom))', minWidth: '210px',
      padding: '12px 18px', boxSizing: 'border-box', border: '1px solid rgba(205,220,211,.72)',
      borderLeft: '5px solid #68d38a', background: 'rgba(5,10,12,.82)', borderRadius: '5px',
      fontSize: '24px', fontWeight: '700', lineHeight: '1.2',
    });

    const combat = document.createElement('div');
    Object.assign(combat.style, {
      position: 'absolute', right: 'max(24px, env(safe-area-inset-right))',
      bottom: 'max(24px, env(safe-area-inset-bottom))', width: 'min(390px, calc(100vw - 48px))',
      padding: '13px 18px 14px', boxSizing: 'border-box', border: '1px solid rgba(205,220,211,.72)',
      borderRight: '5px solid #e1bd55', background: 'rgba(5,10,12,.86)', borderRadius: '5px',
    });
    const weapon = document.createElement('div');
    Object.assign(weapon.style, { color: '#cbd4cf', fontSize: '16px', lineHeight: '1.25', marginBottom: '2px' });
    const ammo = document.createElement('div');
    Object.assign(ammo.style, { fontSize: '34px', fontWeight: '800', lineHeight: '1.1', whiteSpace: 'nowrap' });
    const items = document.createElement('div');
    Object.assign(items.style, { color: '#f1d77d', fontSize: '18px', fontWeight: '700', lineHeight: '1.3', marginTop: '7px', whiteSpace: 'nowrap' });
    const slots = document.createElement('div');
    Object.assign(slots.style, { color: '#bfc9c4', fontSize: '12px', fontWeight: '700', lineHeight: '1.45', marginTop: '8px', whiteSpace: 'normal' });
    const mapPanel = document.createElement('div');
    Object.assign(mapPanel.style, {
      position: 'absolute', left: 'max(24px, env(safe-area-inset-left))',
      top: 'max(24px, env(safe-area-inset-top))', width: 'clamp(190px, 18vw, 260px)',
      padding: '9px', boxSizing: 'border-box', border: '1px solid rgba(205,220,211,.72)',
      background: 'rgba(5,10,12,.84)', borderRadius: '5px',
    });
    const mapTitle = document.createElement('div');
    Object.assign(mapTitle.style, { color: '#e4e9e5', fontSize: '14px', fontWeight: '700', lineHeight: '1.2', margin: '0 2px 7px' });
    const compass = document.createElement('div');
    Object.assign(compass.style, { color: '#f1d77d', fontSize: '13px', fontWeight: '800', lineHeight: '1.2', margin: '0 2px 7px', textAlign: 'center', letterSpacing: '0' });
    const tacticalMap = document.createElement('canvas'); tacticalMap.width = 520; tacticalMap.height = 520;
    Object.assign(tacticalMap.style, { display: 'block', width: '100%', height: 'auto', aspectRatio: '1 / 1', background: '#111719' });
    const legend = document.createElement('div');
    Object.assign(legend.style, { color: '#cbd4cf', fontSize: '11px', lineHeight: '1.35', margin: '7px 2px 0', whiteSpace: 'nowrap' });
    legend.textContent = '深蓝 蓝军   深红 红军   浅色 队长';
    mapPanel.append(mapTitle, compass, tacticalMap, legend);
    combat.append(weapon, ammo, items, slots); root.append(health, combat, mapPanel); document.body.appendChild(root);
    this.webHudRoot = root; this.webHudHealth = health; this.webHudWeapon = weapon; this.webHudAmmo = ammo; this.webHudItems = items; this.webHudSlots=slots;
    this.webTacticalMap = tacticalMap; this.webTacticalMapTitle = mapTitle; this.webCompass=compass;
  }

  private missionUsesCommanders(): boolean {
    return ['command-strike','command-defense','vip-escort','extraction-intercept','evacuation-cover'].includes(this.selectedMission);
  }

  private updateTacticalMap(): void {
    const canvas = this.webTacticalMap; if (!canvas || !this.player) return;
    const heading=((this.player.yaw%360)+360)%360,directions=['N','NE','E','SE','S','SW','W','NW'];
    if(this.webCompass)this.webCompass.textContent=`${directions[Math.round(heading/45)%8]}  ${Math.round(heading).toString().padStart(3,'0')}°`;
    if (this.matchClock >= this.lastTacticalMapDraw && this.matchClock - this.lastTacticalMapDraw < 0.1) return;
    this.lastTacticalMapDraw = this.matchClock;
    const context = canvas.getContext('2d'); if (!context) return;
    const width=canvas.width,height=canvas.height,padding=22,span=MAP_HALF*2+4,inner=width-padding*2;
    const mapX=(x:number)=>padding+(x+MAP_HALF+2)/span*inner;
    const mapY=(z:number)=>padding+(MAP_HALF+2-z)/span*inner;
    context.clearRect(0,0,width,height);context.fillStyle='#101719';context.fillRect(0,0,width,height);
    context.strokeStyle='rgba(196,207,201,.11)';context.lineWidth=1;
    for(let i=1;i<6;i+=1){const p=padding+inner*i/6;context.beginPath();context.moveTo(p,padding);context.lineTo(p,height-padding);context.moveTo(padding,p);context.lineTo(width-padding,p);context.stroke();}
    const underground=this.player.node.worldPosition.y<-1.4;
    for(const obstacle of this.obstacles){
      if(obstacle.name==='Boundary'||obstacle.name==='SubwayRoof')continue;
      const subway=obstacle.name.startsWith('Subway')||obstacle.name.startsWith('Entrance');
      if(underground!==subway&&subway)continue;
      const x=mapX(obstacle.minX),y=mapY(obstacle.maxZ),w=Math.max(2,mapX(obstacle.maxX)-x),h=Math.max(2,mapY(obstacle.minZ)-y);
      const cover=obstacle.name.startsWith('Cover')||obstacle.name.includes('Vehicle')||obstacle.name.includes('Column');
      context.fillStyle=cover?'rgba(129,116,86,.48)':'rgba(126,139,143,.52)';context.fillRect(x,y,w,h);
      context.strokeStyle=cover?'rgba(196,174,118,.58)':'rgba(194,205,207,.58)';context.lineWidth=1;context.strokeRect(x,y,w,h);
    }
    for(const point of this.capturePoints){if(!point.ring.active)continue;const x=mapX(point.position.x),y=mapY(point.position.z);context.fillStyle='#e0bd55';context.font='bold 18px Arial';context.textAlign='center';context.textBaseline='middle';context.fillText(point.id,x,y);}
    const commanderMission=this.missionUsesCommanders();
    for(const actor of this.actors){
      if(!actor.alive||(this.selectedMission==='battle-royale'&&!actor.player))continue;const position=actor.node.worldPosition,x=mapX(position.x),y=mapY(position.z);
      const commander=commanderMission&&this.teamCommanders[actor.team]===actor.id;
      context.beginPath();context.arc(x,y,commander?8:5.5,0,Math.PI*2);
      context.fillStyle=this.selectedMission==='battle-royale'?'#aeb5b2':actor.team==='blue'?(commander?'#79cfff':'#174c91'):(commander?'#ff8f8f':'#8f232a');context.fill();
      context.strokeStyle=actor.player?'#ffffff':'rgba(0,0,0,.82)';context.lineWidth=actor.player?3:1.5;context.stroke();
      if(actor.player){const angle=actor.yaw*Math.PI/180;context.beginPath();context.moveTo(x,y);context.lineTo(x-Math.sin(angle)*18,y-Math.cos(angle)*18);context.strokeStyle='#ffffff';context.lineWidth=3;context.stroke();}
    }
    context.strokeStyle='rgba(225,233,228,.72)';context.lineWidth=2;context.strokeRect(padding,padding,inner,inner);
    context.fillStyle='#e8ede9';context.font='bold 16px Arial';context.textAlign='center';context.textBaseline='top';context.fillText('N',width/2,3);
    if(this.webTacticalMapTitle)this.webTacticalMapTitle.textContent=`战术地图 · ${MAP_DISPLAY_NAMES[this.selectedMap]}${underground?' · 地下层':''}`;
  }

  private createLabel(id: string, position: Vec3, size: number, parent: Node, width = 620): Label {
    const node = new Node(id); node.layer = Layers.Enum.UI_2D; parent.addChild(node); node.setPosition(position);
    node.addComponent(UITransform).setContentSize(width, size + 18);
    const label = node.addComponent(Label); label.fontSize = size; label.lineHeight = size + 6; label.color = Color.WHITE;
    this.hudLabels.set(id, label); return label;
  }

  private drawHud(): void {
    const g = this.hudGraphics; g.clear(); g.lineWidth = 3; g.strokeColor = new Color(235, 238, 230, 220);
    g.moveTo(-15, 0); g.lineTo(-4, 0); g.moveTo(4, 0); g.lineTo(15, 0); g.moveTo(0, -15); g.lineTo(0, -4); g.moveTo(0, 4); g.lineTo(0, 15); g.stroke();
    g.fillColor = new Color(5, 8, 9, 90);
    g.rect(-this.viewWidth / 2, -this.viewHeight / 2, this.viewWidth, 28); g.fill();
    g.rect(-this.viewWidth / 2, this.viewHeight / 2 - 28, this.viewWidth, 28); g.fill();
    const left=this.safeRect.x,right=this.safeRect.x+this.safeRect.width,bottom=this.safeRect.y;
    g.fillColor=new Color(7,11,13,205);g.roundRect(left+18,bottom+24,325,96,5);g.fill();
    g.fillColor=new Color(7,11,13,210);g.roundRect(right-455,bottom+24,435,272,5);g.fill();
    g.lineWidth=2;g.strokeColor=new Color(185,198,190,150);g.roundRect(left+18,bottom+24,325,96,5);g.stroke();g.roundRect(right-455,bottom+24,435,272,5);g.stroke();
  }

  private normalizedUi(x: number, y: number): Vec2 { return new Vec2(this.safeRect.x + this.safeRect.width * x, this.safeRect.y + this.safeRect.height * y); }

  private makeHudActionButton(text: string, action: 'grenade' | 'medkit', position: Vec3, size: Vec2, color: Color): Node {
    const hud = this.uiRoot.getChildByName('HUD')!;
    const node = new Node(`HudAction-${text}`); node.layer = Layers.Enum.UI_2D; hud.addChild(node); node.setPosition(position);
    node.addComponent(UITransform).setContentSize(size.x, size.y);
    const g = node.addComponent(Graphics); g.fillColor = color; g.roundRect(-size.x / 2, -size.y / 2, size.x, size.y, 4); g.fill();
    const label = this.makeText(text, Vec3.ZERO, 19, node, Color.WHITE);
    this.hudActionLabels.set(action, label);
    node.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; this.triggerHudAction(action); });
    return node;
  }

  private bindInput(): void {
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this); input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this); input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this); input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    game.on(Game.EVENT_HIDE, this.onHide, this); game.on(Game.EVENT_SHOW, this.onShow, this);
    if (typeof document !== 'undefined') {
      this.contextMenuHandler = (event: Event) => event.preventDefault();
      document.addEventListener('contextmenu', this.contextMenuHandler);
      this.blurHandler = () => this.handleFocusLoss();
      window.addEventListener('blur', this.blurHandler);
      this.pointerLockHandler = () => this.onPointerLockChange();
      this.pointerLockErrorHandler = () => { this.releaseAllInputs(); if (this.phase === 'playing' && !this.cursorMode) this.showPauseMenu(); };
      this.documentKeyHandler = (event: KeyboardEvent) => {
        if (this.phase !== 'playing') return;
        if (event.code === 'Tab') { event.preventDefault(); this.toggleCursorMode(); }
        if (event.code === 'Escape' && !this.isPointerLocked()) { event.preventDefault(); this.showPauseMenu(); }
      };
      document.addEventListener('pointerlockchange', this.pointerLockHandler);
      document.addEventListener('pointerlockerror', this.pointerLockErrorHandler);
      document.addEventListener('keydown', this.documentKeyHandler);
    }
  }

  private onKeyDown(event: EventKeyboard): void {
    if (this.phase !== 'playing' || this.paused || this.lifecyclePaused || !this.player?.alive) return;
    this.keyState.add(event.keyCode);
    if (event.keyCode === KeyCode.KEY_R) this.beginReload();
    if (event.keyCode === KeyCode.KEY_G) this.throwGrenade();
    if (event.keyCode === KeyCode.KEY_H) this.beginHeal();
    if (event.keyCode === KeyCode.KEY_F) this.useMissionEquipment();
    if (event.keyCode === KeyCode.KEY_Z) this.toggleCrouch();
    if (event.keyCode === KeyCode.KEY_X) this.toggleProne();
    if (event.keyCode === KeyCode.DIGIT_1) this.switchWeapon(1);
    if (event.keyCode === KeyCode.DIGIT_2) this.switchWeapon(2);
    if (event.keyCode === KeyCode.DIGIT_3) this.switchWeapon(3);
    if (event.keyCode === KeyCode.DIGIT_4) this.switchWeapon(4);
    if (event.keyCode === KeyCode.KEY_V) this.toggleVehicle();
    if (event.keyCode === KeyCode.SPACE) this.jump();
  }
  private onKeyUp(event: EventKeyboard): void { this.keyState.delete(event.keyCode); }
  private onMouseMove(event: EventMouse): void {
    if (this.phase !== 'playing' || this.paused || this.lifecyclePaused || !this.player?.alive || !this.isPointerLocked()) return;
    const d = event.getDelta(); this.applyLook(d.x, d.y);
  }
  private onMouseDown(event: EventMouse): void {
    if (this.phase !== 'playing' || this.paused || this.lifecyclePaused || !this.player?.alive) return;
    const hudAction = this.cursorMode ? this.hudActionAt(event.getLocation()) : null;
    if (hudAction) {
      if (event.getButton() === EventMouse.BUTTON_LEFT) { this.triggerHudAction(hudAction); this.cursorMode = false; this.requestPointerLock(); }
      return;
    }
    if (!this.isPointerLocked()) { this.cursorMode = false; this.releaseAllInputs(); this.requestPointerLock(); return; }
    if (event.getButton() === EventMouse.BUTTON_LEFT) this.pressFire();
    if (event.getButton() === EventMouse.BUTTON_RIGHT) this.setAds(!this.adsTarget);
  }
  private onMouseUp(event: EventMouse): void {
    if (event.getButton() === EventMouse.BUTTON_LEFT) this.releaseFire();
    // ADS is a click-to-toggle action. Mouse-up must not cancel it.
  }

  private hudActionAt(location: Vec2): 'grenade' | 'medkit' | null {
    const frame = view.getFrameSize();
    const ui = new Vec2(location.x / frame.width * this.viewWidth - this.viewWidth / 2, location.y / frame.height * this.viewHeight - this.viewHeight / 2);
    if (Math.abs(ui.x - this.hudActionCenters.grenade.x) <= 85 && Math.abs(ui.y - this.hudActionCenters.grenade.y) <= 27) return 'grenade';
    if (Math.abs(ui.x - this.hudActionCenters.medkit.x) <= 85 && Math.abs(ui.y - this.hudActionCenters.medkit.y) <= 27) return 'medkit';
    return null;
  }

  private triggerHudAction(action: 'grenade' | 'medkit'): void {
    if (this.phase !== 'playing' || this.paused || this.lifecyclePaused || !this.player?.alive) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.lastHudAction.id === action && now - this.lastHudAction.at < 120) return;
    this.lastHudAction = { id: action, at: now };
    if (action === 'grenade') this.throwGrenade(); else this.beginHeal();
  }

  private releaseAllInputs(): void {
    this.keyState.clear();
    this.fireHeld = false; if (this.player) this.player.triggerLatched = false;
    this.showGrenadePreview(false);
    this.lastHudAction = { id: '', at: -Infinity };
  }
  private onHide(): void { this.lifecyclePaused = true; this.releaseAllInputs(); this.releasePointerLock(); this.audio?.stopAll(); this.profileStore.save(); }
  private onShow(): void { this.lifecyclePaused = false; this.releaseAllInputs(); if (this.phase === 'playing' && this.player?.alive) this.showPauseMenu(); }

  private isPointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === document.querySelector('canvas');
  }

  private requestPointerLock(): void {
    if (typeof document === 'undefined' || this.paused || this.lifecyclePaused || this.cursorMode || !this.player?.alive || (this.phase !== 'playing' && this.phase !== 'countdown')) return;
    const canvas = document.querySelector('canvas');
    if (!canvas || document.pointerLockElement === canvas) return;
    try {
      void Promise.resolve(canvas.requestPointerLock()).catch(() => this.releaseAllInputs());
    } catch { this.releaseAllInputs(); }
  }

  private releasePointerLock(): void {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
  }

  private onPointerLockChange(): void {
    this.releaseAllInputs();
    if (this.isPointerLocked()) { this.cursorMode = false; return; }
    if (this.phase === 'playing' && this.player?.alive && !this.cursorMode && !this.lifecyclePaused && !this.paused) this.showPauseMenu();
  }

  private toggleCursorMode(): void {
    if (this.phase !== 'playing' || this.paused || this.lifecyclePaused || !this.player?.alive) return;
    this.releaseAllInputs();
    if (this.isPointerLocked()) { this.cursorMode = true; this.releasePointerLock(); }
    else { this.cursorMode = false; this.requestPointerLock(); }
  }

  private handleFocusLoss(): void {
    this.releaseAllInputs(); this.releasePointerLock();
    if (this.phase === 'playing' && this.player?.alive) this.showPauseMenu();
  }

  private showPauseMenu(): void {
    if (this.phase !== 'playing' || !this.player?.alive || this.pauseLayer?.isValid) return;
    this.paused = true; this.cursorMode = false; this.setHudVisible(false); this.releaseAllInputs(); this.releasePointerLock();
    this.pauseLayer = this.panel('Pause', new Color(7,10,12,225));
    this.makeText('游戏暂停', new Vec3(0,150), 54, this.pauseLayer, Color.WHITE);
    this.makeButton('继续游戏',new Vec3(0,35),new Vec2(340,76),new Color(52,112,75),()=>this.resumeGame());
    this.makeButton('返回主菜单',new Vec3(0,-75),new Vec2(340,76),new Color(76,67,58),()=>{this.paused=false;this.destroyLayer(this.pauseLayer);this.pauseLayer=null;if(this.gameMode==='online')this.roomClient.leave();this.clearMatch();this.showMainMenu();});
  }

  private resumeGame(): void {
    if (!this.paused) return;
    this.destroyLayer(this.pauseLayer); this.pauseLayer = null; this.paused = false; this.cursorMode = false; this.setHudVisible(true); this.releaseAllInputs(); this.requestPointerLock();
  }

  private setupRoomClient(): void {
    this.roomClient.onRoom = () => { if (this.phase === 'menu' && this.roomClient.code) this.showOnlineLobby(); };
    this.roomClient.onError = message => this.notify(message);
    this.roomClient.onMatchStart = (map, mission, missionTeam, players) => this.startOnlineMatch(map, mission, missionTeam, players);
    this.roomClient.onPlayerState = (id, state) => this.applyRemotePlayerState(id, state);
    this.roomClient.onRemoteFire = (id,weaponId) => { const actor=this.networkActors.get(id);if(!actor||!this.roomClient.isHost)return;if(actor.vehicle)this.fireVehicleGun(actor.vehicle,actor);else if(this.selectNetworkWeapon(actor,weaponId))this.fireActor(actor); };
    this.roomClient.onRemoteReload = (id,weaponId) => { const actor=this.networkActors.get(id);if(actor&&this.roomClient.isHost&&this.selectNetworkWeapon(actor,weaponId))this.beginReload(actor); };
    this.roomClient.onUseItem = (id,item) => { const actor=this.networkActors.get(id);if(!actor||!this.roomClient.isHost)return;if(item==='grenade')this.throwGrenade(actor);else this.beginHeal(actor); };
    this.roomClient.onWorld = snapshot => { if (!this.roomClient.isHost) this.applyWorldSnapshot(snapshot); };
    this.roomClient.onHostMigration = snapshot => { if(snapshot)this.applyWorldSnapshot(snapshot);this.networkStateClock=0;this.networkWorldClock=0;this.notify('房主已迁移 · 本机继续权威模拟'); };
  }

  private showMainMenu(): void {
    for(const team of ['blue','red'] as Team[]){const unlocked=unlockedPrimaryWeapons(team,this.profileStore.profile.level);if(!unlocked.includes(this.selectedPrimary[team]))this.selectedPrimary[team]=unlocked[0];}
    this.phase = 'menu'; this.paused = false; this.cursorMode = false; this.releaseAllInputs(); this.releasePointerLock(); this.destroyLayer(this.pauseLayer); this.pauseLayer = null; this.destroyLayer(this.missionLayer);this.missionLayer=null;this.setHudVisible(false); this.destroyLayer(this.resultLayer); this.resultLayer = null; this.destroyLayer(this.menuLayer);
    this.menuLayer = this.panel('MainMenu', new Color(8, 12, 14, 225));
    this.makeText('CITY FRONT', new Vec3(0, 250), 64, this.menuLayer, new Color(230, 235, 228));
    this.makeText('桌面战术 FPS', new Vec3(0, 185), 26, this.menuLayer, new Color(165, 175, 170));
    this.makeButton('单机模式', new Vec3(-230, 45), new Vec2(390, 96), new Color(52, 104, 76), () => { this.gameMode='single';this.showSingleSetup(); });
    this.makeButton('联机模式', new Vec3(230, 45), new Vec2(390, 96), new Color(42, 79, 112), () => { this.gameMode='online';this.showOnlineSetup(); });
    this.makeButton('武器库 / 改枪台', new Vec3(-190, -105), new Vec2(330, 66), new Color(52, 59, 62), () => this.showArmory());
    this.makeButton('设置', new Vec3(190, -105), new Vec2(330, 66), new Color(52, 59, 62), () => this.showSettings());
    const level=this.profileStore.profile.level;const nextXp=experienceForLevel(level+1);
    this.makeText(`等级 ${level} · XP ${this.profileStore.profile.xp}/${nextXp}`, new Vec3(0, -178), 22, this.menuLayer, new Color(170,190,185));
    this.makeText(`金币 ${this.profileStore.profile.coins}`, new Vec3(0, -215), 26, this.menuLayer, new Color(235, 199, 75));
  }

  private showSingleSetup(): void {
    this.destroyLayer(this.menuLayer); this.menuLayer=this.panel('SingleSetup',new Color(8,12,14,230));
    this.makeText('单机模式', new Vec3(0, 350), 52, this.menuLayer, Color.WHITE);
    this.makeText('12 对 12 · 随机战场 · 随机任务 · 5 至 10 分钟', new Vec3(0, 292), 25, this.menuLayer, new Color(165,175,170));
    this.makeButton(`日军${this.playerTeam === 'blue' ? ' · 已选择' : ''}`, new Vec3(-260, 150), new Vec2(430, 68), new Color(104, 86, 52), () => { this.playerTeam = 'blue'; this.showSingleSetup(); });
    this.makeButton(`中国军队${this.playerTeam === 'red' ? ' · 已选择' : ''}`, new Vec3(260, 150), new Vec2(430, 68), new Color(91, 101, 77), () => { this.playerTeam = 'red'; this.showSingleSetup(); });
    this.makeText(`武器库装备 · 日军 ${WEAPONS[this.selectedPrimary.blue].displayName}   /   中国军队 ${WEAPONS[this.selectedPrimary.red].displayName}`,new Vec3(0,55),22,this.menuLayer,new Color(188,199,194));
    this.makeButton('开始随机作战', new Vec3(-225, -35), new Vec2(400, 82), new Color(54, 122, 78), () => this.startMatch());
    this.makeButton('大逃杀 · 16 人', new Vec3(225, -35), new Vec2(400, 82), new Color(105, 78, 46), () => this.startBattleRoyale());
    const nextWeapon=([...PRIMARY_WEAPONS.blue,...PRIMARY_WEAPONS.red] as PrimaryWeaponId[]).filter(id=>WEAPON_UNLOCK_LEVEL[id]>this.profileStore.profile.level).sort((a,b)=>WEAPON_UNLOCK_LEVEL[a]-WEAPON_UNLOCK_LEVEL[b])[0];
    this.makeText(nextWeapon?`当前等级 ${this.profileStore.profile.level} · ${WEAPON_UNLOCK_LEVEL[nextWeapon]} 级解锁 ${WEAPONS[nextWeapon].displayName}`:`当前等级 ${this.profileStore.profile.level} · 已解锁全部武器`,new Vec3(0,-125),20,this.menuLayer,new Color(165,175,170));
    this.makeButton('返回', new Vec3(0, -205), new Vec2(260, 62), new Color(76,67,58), () => this.showMainMenu());
  }

  private showOnlineSetup(): void {
    this.destroyLayer(this.menuLayer);this.menuLayer=this.panel('OnlineSetup',new Color(8,12,14,235));
    this.makeText('联机房间',new Vec3(0,245),52,this.menuLayer,Color.WHITE);
    this.makeButton(`阵营 · ${this.playerTeam==='blue'?'日军':'中国军队'}`,new Vec3(0,140),new Vec2(390,64),this.playerTeam==='blue'?new Color(104,86,52):new Color(91,101,77),()=>{this.playerTeam=oppositeTeam(this.playerTeam);this.showOnlineSetup();});
    this.makeText(`武器库装备 · ${WEAPONS[this.selectedPrimary[this.playerTeam]].displayName}`,new Vec3(0,60),23,this.menuLayer,new Color(188,199,194));
    this.makeButton('创建房间',new Vec3(-210,-55),new Vec2(350,76),new Color(52,104,76),()=>void this.createOnlineRoom());
    this.makeButton('输入房间码加入',new Vec3(210,-55),new Vec2(350,76),new Color(42,79,112),()=>void this.joinOnlineRoom());
    this.makeButton('返回',new Vec3(0,-180),new Vec2(260,62),new Color(76,67,58),()=>this.showMainMenu());
  }

  private async createOnlineRoom(): Promise<void> { const entered=typeof window!=='undefined'?window.prompt('自定义 6 位房间码（字母或数字）',''):'';const code=String(entered||'').trim().toUpperCase();if(!code)return;if(!/^[A-Z0-9]{6}$/.test(code)){if(typeof window!=='undefined')window.alert('房间码必须是 6 位字母或数字');return;}try{await this.roomClient.connect();this.roomClient.createRoom(code,this.defaultPlayerName(),this.playerTeam,this.selectedPrimary[this.playerTeam]);}catch(error){this.notify(error instanceof Error?error.message:'无法创建房间');} }
  private async joinOnlineRoom(): Promise<void> { const entered=typeof window!=='undefined'?window.prompt('输入 6 位房间码',''):'';if(!entered)return;try{await this.roomClient.connect();this.roomClient.joinRoom(entered,this.defaultPlayerName(),this.playerTeam,this.selectedPrimary[this.playerTeam]);}catch(error){this.notify(error instanceof Error?error.message:'无法加入房间');} }
  private defaultPlayerName(): string { const key='city-front-player-name';let value=sys.localStorage.getItem(key);if(!value){value=`Player${Math.floor(1000+Math.random()*9000)}`;sys.localStorage.setItem(key,value);}return value; }

  private showOnlineLobby(): void {
    this.destroyLayer(this.menuLayer);this.menuLayer=this.panel('OnlineLobby',new Color(8,12,14,240));
    this.makeText(`房间 ${this.roomClient.code}`,new Vec3(0,300),48,this.menuLayer,new Color(230,235,228));
    this.makeText(`真人 ${this.roomClient.players.length} / 24 · 空位由 AI 补齐`,new Vec3(0,245),24,this.menuLayer,new Color(165,175,170));
    this.roomClient.players.forEach((player,index)=>this.makeText(`${player.team==='blue'?'日':'中'} · ${player.name} · ${WEAPONS[player.weapon].displayName}${player.id===this.roomClient.hostId?' · 房主':''}`,new Vec3(index<12?-300:300,190-(index%12)*31),18,this.menuLayer,player.team==='blue'?new Color(208,176,104):new Color(159,181,133)));
    if(this.roomClient.isHost){this.makeButton('开始随机作战',new Vec3(-190,-175),new Vec2(330,62),new Color(54,122,78),()=>this.startRandomOnlineMatch());this.makeButton('大逃杀',new Vec3(190,-175),new Vec2(300,62),new Color(105,78,46),()=>{if(this.roomClient.players.length>BATTLE_ROYALE_SIZE){this.notify(`大逃杀最多允许 ${BATTLE_ROYALE_SIZE} 名真人`);return;}this.roomClient.startMatch(this.randomMap(),'battle-royale','blue');});}
    this.makeButton('退出房间',new Vec3(0,-275),new Vec2(260,58),new Color(92,55,52),()=>{this.roomClient.leave();this.showMainMenu();});
  }

  private showArmory(): void {
    if (this.menuLayer) this.menuLayer.active = false;
    const layer = this.panel('Armory', new Color(11, 15, 17, 235));
    this.makeText(`武器库 · 金币 ${this.profileStore.profile.coins}`,new Vec3(0,475),38,layer,Color.WHITE);
    this.makeText('点击已解锁武器即可装备并进入改枪台',new Vec3(0,432),19,layer,new Color(165,175,170));
    this.makeText('日军',new Vec3(-450,382),28,layer,new Color(208,176,104));
    this.makeText('中国军队',new Vec3(450,382),28,layer,new Color(159,181,133));
    for(const [team,x] of [['blue',-450],['red',450]] as const)PRIMARY_WEAPONS[team].forEach((id,index)=>this.makeWeaponCard(layer,team,id,new Vec3(x,325-index*82)));
    const sidearm=new Node('WeaponCard-glock17');sidearm.layer=Layers.Enum.UI_2D;layer.addChild(sidearm);sidearm.setPosition(0,-245);sidearm.addComponent(UITransform).setContentSize(720,58);const sidearmBg=sidearm.addComponent(Graphics);sidearmBg.fillColor=new Color(43,48,50,235);sidearmBg.roundRect(-360,-29,720,58,5);sidearmBg.fill();sidearmBg.strokeColor=new Color(119,130,126);sidearmBg.roundRect(-360,-29,720,58,5);sidearmBg.stroke();const sidearmPreview=new Node('WeaponPreview-glock17');sidearmPreview.layer=Layers.Enum.UI_2D;sidearm.addChild(sidearmPreview);sidearmPreview.setPosition(-185,0);sidearmPreview.addComponent(UITransform).setContentSize(210,50);this.drawWeaponPreview(sidearmPreview,'glock17',180);const sidearmLabel=this.makeText('制式手枪 · 双方固定副武器',new Vec3(120,0),20,sidearm,Color.WHITE);sidearmLabel.node.getComponent(UITransform)?.setContentSize(390,48);
    this.makeButton('返回主菜单',new Vec3(0,-335),new Vec2(300,60),new Color(80,62,48),()=>{layer.destroy();if(this.menuLayer)this.menuLayer.active=true;this.showMainMenu();});
  }

  private makeWeaponCard(layer:Node,team:Team,weaponId:PrimaryWeaponId,position:Vec3):void{
    const unlocked=this.profileStore.profile.level>=WEAPON_UNLOCK_LEVEL[weaponId],selected=this.selectedPrimary[team]===weaponId;
    const node=new Node(`WeaponCard-${weaponId}`);node.layer=Layers.Enum.UI_2D;layer.addChild(node);node.setPosition(position);node.addComponent(UITransform).setContentSize(820,70);
    const background=node.addComponent(Graphics);background.fillColor=!unlocked?new Color(33,37,39,225):selected?(team==='blue'?new Color(35,83,126,245):new Color(105,48,45,245)):new Color(48,54,56,235);background.roundRect(-410,-35,820,70,5);background.fill();background.strokeColor=selected?new Color(235,199,75):new Color(119,130,126);background.lineWidth=selected?3:1;background.roundRect(-410,-35,820,70,5);background.stroke();
    const preview=new Node(`WeaponPreview-${weaponId}`);preview.layer=Layers.Enum.UI_2D;node.addChild(preview);preview.setPosition(-230,0);preview.addComponent(UITransform).setContentSize(300,64);this.drawWeaponPreview(preview,weaponId,275);this.addWeaponIcon(preview,weaponId,new Vec2(300,64));
    const suffix=!unlocked?` · ${WEAPON_UNLOCK_LEVEL[weaponId]} 级解锁`:selected?' · 已装备':' · 点击装备';const label=this.makeText(`${WEAPONS[weaponId].displayName}${suffix}`,new Vec3(165,0),20,node,unlocked?Color.WHITE:new Color(125,132,129));label.node.getComponent(UITransform)?.setContentSize(440,52);
    node.on(Node.EventType.TOUCH_END,(event:EventTouch)=>{event.propagationStopped=true;if(!unlocked){this.notify(`${WEAPONS[weaponId].displayName} 需要 ${WEAPON_UNLOCK_LEVEL[weaponId]} 级`);return;}this.selectPrimary(team,weaponId);layer.destroy();this.showWorkbench(team,weaponId);});
  }

  private addWeaponIcon(parent:Node,weaponId:WeaponId,size:Vec2):void{
    if(weaponId==='glock17')return;
    const iconNode=new Node(`Icon-${weaponId}`);iconNode.layer=Layers.Enum.UI_2D;parent.addChild(iconNode);
    iconNode.addComponent(UITransform).setContentSize(size.x,size.y);
    const sprite=iconNode.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;
    resources.load(`ww2/weapons/${weaponId}/icon`,SpriteFrame,(error,frame)=>{if(!error&&frame)sprite.spriteFrame=frame;});
  }

  private drawWeaponPreview(parent:Node,weaponId:WeaponId,width:number):void{
    const spec=WEAPON_VISUALS[weaponId],def=WEAPONS[weaponId],total=spec.barrel+spec.receiver+Math.max(0.05,spec.stock),scale=width/Math.max(0.5,total),g=parent.addComponent(Graphics),receiverW=spec.receiver*scale,receiverH=Math.max(13,spec.width*scale*0.78),receiverL=-receiverW/2,receiverR=receiverW/2,handW=spec.handguard*scale,handL=receiverL-handW+7,stockW=spec.stock*scale,barrelL=receiverL-spec.barrel*scale;
    const steel=new Color(82,87,83),steelHi=new Color(126,130,122),gunmetal=new Color(45,49,47),recess=new Color(13,15,15),polymer=new Color(25,29,28),wood=weaponId==='type38'?new Color(126,78,40):weaponId==='zhongzheng-shi'?new Color(108,63,31):new Color(118,72,39),woodHi=weaponId==='type38'?new Color(170,113,63):weaponId==='zhongzheng-shi'?new Color(151,95,49):new Color(158,105,61),body=spec.wood?wood:polymer;
    g.fillColor=new Color(0,0,0,75);g.roundRect(barrelL-8,-receiverH/2-8,total*scale+14,receiverH+24,4);g.fill();
    g.fillColor=steel;g.roundRect(receiverL,-receiverH/2,receiverW,receiverH,3);g.fill();g.fillColor=steelHi;g.rect(receiverL+4,receiverH*0.16,receiverW-8,2);g.fill();
    if(def.category!=='pistol'){
      g.fillColor=body;g.roundRect(handL,-receiverH*0.43,handW,receiverH*0.86,4);g.fill();g.fillColor=spec.wood?woodHi:steelHi;g.rect(handL+4,receiverH*0.18,handW-8,2);g.fill();
      if(spec.wood){g.strokeColor=new Color(72,43,26);g.lineWidth=1.5;for(let i=0;i<4;i++){const x=handL+handW*(i+1)/5;g.moveTo(x,-receiverH*0.34);g.lineTo(x+5,receiverH*0.3);}g.stroke();}
      else{g.fillColor=recess;for(let i=0;i<6;i++)g.roundRect(handL+7+i*(Math.max(8,(handW-20)/6)),-3,Math.max(4,(handW-28)/8),6,2);g.fill();}
      g.fillColor=body;if(['mp18','type100'].includes(weaponId)){g.rect(receiverR-2,-2,stockW*0.7,4);g.fill();g.rect(receiverR-2,-receiverH*0.28,stockW*0.7,3);g.fill();g.roundRect(receiverR+stockW*0.62,-receiverH*0.48,stockW*0.34,receiverH*0.96,4);g.fill();}else{g.moveTo(receiverR-4,-receiverH*0.38);g.lineTo(receiverR+stockW,-receiverH*0.52);g.lineTo(receiverR+stockW,receiverH*0.48);g.lineTo(receiverR+stockW*0.18,receiverH*0.36);g.close();g.fill();}
    }
    g.fillColor=steel;g.rect(barrelL,-2,spec.barrel*scale,4);g.fill();g.fillColor=steelHi;g.rect(barrelL,-2,spec.barrel*scale,1);g.fill();g.fillColor=gunmetal;g.roundRect(barrelL-11,-5,13,10,3);g.fill();g.fillColor=recess;g.rect(barrelL-8,-3,3,2);g.rect(barrelL-3,-3,3,2);g.fill();
    g.fillColor=gunmetal;g.roundRect(receiverL+receiverW*0.17,receiverH*0.12,receiverW*0.52,receiverH*0.32,2);g.fill();g.fillColor=recess;g.roundRect(receiverL+receiverW*0.48,-receiverH*0.08,receiverW*0.32,receiverH*0.23,2);g.fill();g.fillColor=steelHi;g.circle(receiverR-10,0,2.2);g.circle(receiverR-25,0,2.2);g.fill();
    g.fillColor=body;if(spec.magazine==='box')g.roundRect(-18,-receiverH/2-24,44,27,5);else if(spec.magazine==='pistol')g.roundRect(receiverR*0.25,-receiverH/2-28,10,31,2);else{g.moveTo(-8,-receiverH/2);g.lineTo(16,-receiverH/2);g.lineTo(25,-receiverH/2-29);g.lineTo(4,-receiverH/2-27);g.close();}g.fill();g.fillColor=steelHi;g.rect(spec.magazine==='box'?-13:1,-receiverH/2-(spec.magazine==='box'?22:27),spec.magazine==='box'?34:19,2);g.fill();
    g.fillColor=body;g.moveTo(receiverR*0.18,-receiverH/2);g.lineTo(receiverR*0.48,-receiverH/2);g.lineTo(receiverR*0.58,-receiverH/2-25);g.lineTo(receiverR*0.3,-receiverH/2-27);g.close();g.fill();g.strokeColor=steelHi;g.lineWidth=2;g.moveTo(receiverR*0.06,-receiverH/2-2);g.lineTo(receiverR*0.06,-receiverH/2-14);g.lineTo(receiverR*0.22,-receiverH/2-14);g.stroke();
    if(def.category!=='pistol'&&!spec.wood){g.fillColor=steel;g.rect(receiverL+3,receiverH/2+2,receiverW-6,3);g.fill();g.fillColor=steelHi;for(let i=0;i<10;i++)g.rect(receiverL+7+i*(receiverW-18)/10,receiverH/2+4,2,3);g.fill();}
    const lmgPreview=['zb26','type96-lmg'].includes(weaponId),boltPreview=['zhongzheng-shi','type38'].includes(weaponId),hmgPreview=['type24-hmg','type92-hmg'].includes(weaponId);
    if(lmgPreview){
      g.fillColor=steel;g.rect(receiverL-2,receiverH*0.27,Math.max(20,handW*0.88),4);g.fill();
      g.fillColor=gunmetal;const gasX=barrelL+spec.barrel*scale*0.35;g.roundRect(gasX,receiverH*0.15,12,receiverH*0.7,2);g.fill();
      g.fillColor=wood;g.moveTo(receiverR-3,-receiverH*0.33);g.lineTo(receiverR+stockW,-receiverH*0.5);g.lineTo(receiverR+stockW,receiverH*0.46);g.lineTo(receiverR+stockW*0.18,receiverH*0.31);g.close();g.fill();
    }
    if(boltPreview){
      g.fillColor=gunmetal;g.rect(receiverR-3,receiverH*0.15,4,receiverH*0.75);g.fill();g.strokeColor=woodHi;g.lineWidth=2;g.moveTo(receiverR+stockW*0.2,receiverH*0.15);g.lineTo(receiverR+stockW*0.88,receiverH*0.28);g.stroke();
    }
    if(hmgPreview){
      g.strokeColor=steelHi;g.lineWidth=3;const bx=barrelL+spec.barrel*scale*0.42;g.moveTo(bx,0);g.lineTo(bx-14,-28);g.moveTo(bx+8,0);g.lineTo(bx+22,-28);g.stroke();
    }
    const optic=opticForWeapon(weaponId,this.profileStore.profile.loadouts[weaponId].optic);if(optic!=='none'){const long=optic==='4x'||optic==='6x',oy=receiverH/2+11;g.fillColor=gunmetal;if(long){g.roundRect(-30,oy-5,60,10,5);g.fill();g.circle(-30,oy,8);g.circle(30,oy,7);g.fill();g.fillColor=steelHi;g.rect(-8,oy+5,3,5);g.rect(5,oy+5,3,5);g.fill();}else{g.roundRect(-15,oy-7,30,14,5);g.fill();g.strokeColor=new Color(52,112,130);g.lineWidth=2;g.circle(-12,oy,5);g.stroke();}}
    else if(def.category!=='pistol'){g.fillColor=gunmetal;g.rect(receiverR-18,receiverH/2+2,3,9);g.rect(barrelL+spec.barrel*scale*0.18,2,3,12);g.fill();}
    if(spec.bipod){g.strokeColor=steelHi;g.lineWidth=3;const bx=barrelL+spec.barrel*scale*0.42;g.moveTo(bx,0);g.lineTo(bx-14,-28);g.moveTo(bx+8,0);g.lineTo(bx+22,-28);g.stroke();g.fillColor=gunmetal;g.rect(bx-18,-29,9,3);g.rect(bx+18,-29,9,3);g.fill();}
  }

  private selectPrimary(team:Team,weaponId:PrimaryWeaponId):void{
    if(!PRIMARY_WEAPONS[team].includes(weaponId)||this.profileStore.profile.level<WEAPON_UNLOCK_LEVEL[weaponId])return;
    this.selectedPrimary[team]=weaponId;this.profileStore.profile.selectedPrimary[team]=weaponId;this.profileStore.save();
  }

  private showWorkbench(team:Team,selectedWeapon:PrimaryWeaponId):void{
    const layer=this.panel('Armory',new Color(11,15,17,242)),builtInOptic=BUILT_IN_OPTICS[selectedWeapon];
    this.makeText(`改枪台 · ${team==='blue'?'日军':'中国军队'} ${WEAPONS[selectedWeapon].displayName} · 金币 ${this.profileStore.profile.coins}`,new Vec3(0,410),34,layer,Color.WHITE);
    const preview=new Node(`WorkbenchPreview-${selectedWeapon}`);preview.layer=Layers.Enum.UI_2D;layer.addChild(preview);preview.setPosition(0,300);preview.addComponent(UITransform).setContentSize(620,110);this.drawWeaponPreview(preview,selectedWeapon,560);this.addWeaponIcon(preview,selectedWeapon,new Vec2(620,110));
    this.makeText(builtInOptic?`自带${builtInOptic==='4x'?'四':'六'}倍镜，无需购买`:'点击配件购买，已拥有的配件再次点击可装备或卸下',new Vec3(0,225),19,layer,builtInOptic?new Color(235,199,75):new Color(165,175,170));
    const ids: AttachmentId[] = ['red-dot','2x','4x','6x','grip','collapsible-stock','folding-stock','barrel','heavy-barrel','precision-barrel'];
    const names: Record<AttachmentId,string> = {'red-dot':'红点镜','2x':'二倍镜','4x':'四倍镜','6x':'六倍镜',grip:'握把','collapsible-stock':'伸缩枪托','folding-stock':'折叠枪托',barrel:'强化枪管','heavy-barrel':'重型枪管','precision-barrel':'加长精密枪管'};
    ids.forEach((id,index) => { const column=index%2,row=Math.floor(index/2),x=column===0?-235:235,y=145-row*75;const owned=this.profileStore.profile.ownedAttachments.includes(id);const equipped=this.attachmentEquipped(selectedWeapon,id);const price=ATTACHMENT_PRICES[id];const optic=id==='red-dot'||id==='2x'||id==='4x'||id==='6x';const fixed=optic&&Boolean(builtInOptic);
      const label=fixed?`${names[id]} · ${id===builtInOptic?'武器自带':'不可替换'}`:owned?`${names[id]} · ${equipped?'已装备':'点击装备'}`:`${names[id]} · ${price} 金币`;this.makeButton(label,new Vec3(x,y),new Vec2(420,58),fixed?new Color(54,74,80):equipped?new Color(50,102,68):owned?new Color(48,76,60):new Color(62,66,68),()=>{if(fixed){this.notify(`${WEAPONS[selectedWeapon].displayName} 固定使用${builtInOptic==='4x'?'四':'六'}倍镜`);}else if(!owned){const result=purchaseAttachment(this.profileStore.profile,id);this.profileStore.save();this.notify(result==='purchased'?'购买成功':'金币不足');}else{this.toggleAttachment(selectedWeapon,id);this.profileStore.save();this.notify(this.attachmentEquipped(selectedWeapon,id)?'配件已装备':'配件已卸下');}layer.destroy();this.showWorkbench(team,selectedWeapon);});
    });
    this.makeButton('返回武器库',new Vec3(0,-280),new Vec2(280,62),new Color(80,62,48),()=>{layer.destroy();this.showArmory();});
  }

  private attachmentEquipped(weapon:WeaponId,id:AttachmentId):boolean{const l=this.profileStore.profile.loadouts[weapon];if(id==='red-dot'||id==='2x'||id==='4x'||id==='6x')return opticForWeapon(weapon,l.optic)===id;if(id==='collapsible-stock'||id==='folding-stock')return l.stock===id;if(id==='barrel'||id==='heavy-barrel'||id==='precision-barrel')return l.barrel===id;return l.grip;}
  private toggleAttachment(weapon:WeaponId,id:AttachmentId):void{const enabled=!this.attachmentEquipped(weapon,id),l=this.profileStore.profile.loadouts[weapon];if(id==='red-dot'||id==='2x'||id==='4x'||id==='6x'){if(!BUILT_IN_OPTICS[weapon])l.optic=enabled?id:'none';}else if(id==='collapsible-stock'||id==='folding-stock')l.stock=enabled?id:'none';else if(id==='barrel'||id==='heavy-barrel'||id==='precision-barrel')l.barrel=enabled?id:'none';else l.grip=enabled;}

  private showSettings(): void {
    if (this.menuLayer) this.menuLayer.active = false;
    const layer = this.panel('Settings', new Color(11, 15, 17, 235)); const settings = this.profileStore.profile.settings;
    this.makeText('设置', new Vec3(0, 310), 44, layer, Color.WHITE);
    const rows: Array<[string, () => string, () => void, () => void]> = [
      ['视角灵敏度', () => settings.lookSensitivity.toFixed(2), () => settings.lookSensitivity = clamp(settings.lookSensitivity - 0.02, 0.04, 0.5), () => settings.lookSensitivity = clamp(settings.lookSensitivity + 0.02, 0.04, 0.5)],
      ['开镜灵敏度', () => settings.adsSensitivity.toFixed(2), () => settings.adsSensitivity = clamp(settings.adsSensitivity - 0.01, 0.02, 0.3), () => settings.adsSensitivity = clamp(settings.adsSensitivity + 0.01, 0.02, 0.3)],
      ['音效音量', () => `${Math.round(settings.sfxVolume * 100)}%`, () => settings.sfxVolume = clamp(settings.sfxVolume - 0.1, 0, 1), () => settings.sfxVolume = clamp(settings.sfxVolume + 0.1, 0, 1)],
    ];
    rows.forEach((row, i) => { const y = 190 - i * 100; this.makeText(row[0], new Vec3(-250,y), 28, layer, Color.WHITE); const value = this.makeText(row[1](), new Vec3(100,y), 28, layer, new Color(220,190,75));
      this.makeButton('-', new Vec3(10,y), new Vec2(60,60), new Color(60,65,68), () => { row[2](); value.string = row[1](); this.profileStore.save(); });
      this.makeButton('+', new Vec3(190,y), new Vec2(60,60), new Color(60,65,68), () => { row[3](); value.string = row[1](); this.profileStore.save(); });
    });
    this.makeText('反转垂直视角', new Vec3(-250,-90), 28, layer, Color.WHITE);
    this.makeButton(settings.invertVerticalLook ? '开启' : '关闭', new Vec3(135,-90), new Vec2(180,58), settings.invertVerticalLook ? new Color(56,104,74) : new Color(58,63,66), () => { settings.invertVerticalLook = !settings.invertVerticalLook; this.profileStore.save(); layer.destroy(); this.showSettings(); });
    this.makeText(`画质 ${settings.quality.toUpperCase()}`, new Vec3(-170,-180), 28, layer, Color.WHITE);
    for (const [quality,x] of [['low',30],['medium',170],['high',310]] as const) this.makeButton(quality.toUpperCase(), new Vec3(x,-180), new Vec2(120,58), settings.quality === quality ? new Color(56,104,74) : new Color(58,63,66), () => { settings.quality = quality; this.applyQuality(); this.profileStore.save(); layer.destroy(); this.showSettings(); });
    this.makeButton('重置存档', new Vec3(-170,-285), new Vec2(280,70), new Color(110,55,48), () => {
      const confirmed=typeof window==='undefined'||window.confirm('重置金币、等级、经验、配件和设置，并恢复初始 1000 金币？');
      if(!confirmed)return;
      this.profileStore.reset();this.applyQuality();layer.destroy();this.notify('存档已重置 · 金币 1000');this.showMainMenu();
    });
    this.makeButton('返回', new Vec3(170,-285), new Vec2(280,70), new Color(80,62,48), () => { layer.destroy(); this.showMainMenu(); });
  }

  private panel(name: string, color: Color): Node {
    this.destroyLayer(this.menuLayer && this.menuLayer.name === name ? this.menuLayer : null);
    const node = new Node(name); node.layer = Layers.Enum.UI_2D; this.uiRoot.addChild(node); node.addComponent(UITransform).setContentSize(this.viewWidth, this.viewHeight);
    const g = node.addComponent(Graphics); g.fillColor = color; g.rect(-this.viewWidth/2,-this.viewHeight/2,this.viewWidth,this.viewHeight); g.fill(); return node;
  }
  private makeText(text: string, position: Vec3, size: number, parent: Node, color: Color): Label {
    const node = new Node(`Text-${text}`); node.layer = Layers.Enum.UI_2D; parent.addChild(node); node.setPosition(position); node.addComponent(UITransform).setContentSize(760,size+18);
    const label = node.addComponent(Label); label.string = text; label.fontSize = size; label.lineHeight = size + 6; label.color = color; return label;
  }
  private makeButton(text: string, position: Vec3, size: Vec2, color: Color, callback: () => void): Node {
    const node = new Node(`Button-${text}`); node.layer = Layers.Enum.UI_2D;
    const layers = this.uiRoot.children.filter(n => ['Settings','Armory','MainMenu','SingleSetup','OnlineSetup','OnlineLobby','Pause','Result'].includes(n.name));
    (layers[layers.length - 1] || this.uiRoot).addChild(node);
    node.setPosition(position); node.addComponent(UITransform).setContentSize(size.x,size.y); const g = node.addComponent(Graphics); g.fillColor = color; g.roundRect(-size.x/2,-size.y/2,size.x,size.y,6); g.fill();
    this.makeText(text, Vec3.ZERO, Math.min(28,size.y*0.38), node, Color.WHITE);
    node.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; callback(); }); return node;
  }
  private destroyLayer(layer: Node | null): void { if (layer?.isValid) layer.destroy(); }
  private setHudVisible(active: boolean): void {
    const hud = this.uiRoot?.getChildByName('HUD');
    if (hud) { hud.active = active; if (active) hud.setSiblingIndex(this.uiRoot.children.length - 1); }
    if (this.webHudRoot) this.webHudRoot.style.display = active ? 'block' : 'none';
  }

  private randomMap(): MapId { const candidates=MAP_IDS.filter(id=>id!==this.selectedMap);return candidates[Math.floor(Math.random()*candidates.length)]; }
  private randomMission(team:Team):MissionId{
    if(this.missionDeck[team].length===0){const deck=[...MISSION_POOLS[team]];for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}if(deck.length>1&&deck[0]===this.lastMission[team])[deck[0],deck[1]]=[deck[1],deck[0]];this.missionDeck[team].push(...deck);}
    const mission=this.missionDeck[team].shift()!;this.lastMission[team]=mission;return mission;
  }
  private missionGrenades(team:Team):number{return team===this.missionOwner&&['sabotage-raid','convoy-ambush','communications-raid'].includes(this.selectedMission)?3:2;}
  private missionMedkits(team:Team):number{return team===this.missionOwner&&['command-defense','vip-escort','evacuation-cover'].includes(this.selectedMission)?2:1;}
  private useMissionEquipment(): void {
    const player=this.player;if(this.phase!=='playing'||!player?.alive||player.action.exclusive!=='idle')return;
    const mission=MISSION_DEFINITIONS[this.selectedMission];
    if(this.matchClock<this.missionEquipmentReadyAt){this.notify(`装备冷却 ${Math.ceil(this.missionEquipmentReadyAt-this.matchClock)} 秒`);return;}
    if(this.selectedMission==='conquest'){this.notify('标准战斗装具无需主动使用');return;}
    this.missionEquipmentReadyAt=this.matchClock+3;
    if(['command-strike','command-defense','vip-escort','extraction-intercept','evacuation-cover'].includes(this.selectedMission)){
      const targetTeam=this.selectedMission==='command-strike'?oppositeTeam(player.team):this.selectedMission==='extraction-intercept'?oppositeTeam(this.missionOwner):this.missionOwner;
      const commander=this.actors.find(actor=>actor.id===this.teamCommanders[targetTeam]);
      if(!commander?.alive){this.notify('目标队长已经阵亡');return;}
      const pointId=this.selectedMission==='vip-escort'?'D':this.selectedMission==='evacuation-cover'?'E':'';const point=pointId?this.capturePoints.find(item=>item.id===pointId):null;
      this.notify(`要员方位已扫描 · 距离 ${Math.round(Vec3.distance(player.node.worldPosition,commander.node.worldPosition))} 米${point?` · 撤离区 ${Math.round(Vec3.distance(commander.node.worldPosition,point.position))} 米`:''}`);return;
    }
    if(['encirclement','convoy-ambush','perimeter-sweep'].includes(this.selectedMission)){
      const enemy=this.actors.filter(actor=>actor.alive&&actor.team!==player.team).sort((a,b)=>Vec3.distance(player.node.worldPosition,a.node.worldPosition)-Vec3.distance(player.node.worldPosition,b.node.worldPosition))[0];
      this.notify(enemy?`已标记最近敌军 · 距离 ${Math.round(Vec3.distance(player.node.worldPosition,enemy.node.worldPosition))} 米`:'未发现敌军');return;
    }
    const points=mission.objectiveIds.map(id=>this.capturePoints.find(point=>point.id===id)).filter((point):point is CapturePoint=>Boolean(point));
    const nearest=points.sort((a,b)=>Vec3.distance(player.node.worldPosition,a.position)-Vec3.distance(player.node.worldPosition,b.position))[0];
    if(!nearest){this.notify('当前没有可操作的任务目标');return;}
    const distance=Vec3.distance(player.node.worldPosition,nearest.position);
    if(this.selectedMission==='airborne-assault'||this.selectedMission==='intel-recovery'){
      this.notify(`${nearest.id} 点距离 ${Math.round(distance)} 米${distance<7?' · 已进入操作范围':''}`);return;
    }
    if(distance>6.5){this.notify(`请靠近 ${nearest.id} 点使用装备 · 还差 ${Math.max(0,Math.round(distance-6.5))} 米`);return;}
    if(player.team===this.missionOwner){
      if(nearest.owner===player.team){this.notify(`${nearest.id} 点已经完成`);return;}
      nearest.progressTeam=player.team;nearest.progress=Math.min(8,nearest.progress+4);
      if(nearest.progress>=8){nearest.owner=player.team;nearest.progress=0;nearest.progressTeam=null;nearest.ring.getComponent(MeshRenderer)?.setMaterial(this.material(`owned-${player.team}`,player.team==='blue'?new Color(40,105,205):new Color(205,55,55),0.1,0.6),0);this.notify(`${nearest.id} 点任务装备操作完成`);}
      else this.notify(`${nearest.id} 点操作完成一半，再使用一次 F`);
    }else{
      nearest.progress=0;nearest.progressTeam=null;if(nearest.owner===this.missionOwner)nearest.owner=null;
      nearest.ring.getComponent(MeshRenderer)?.setMaterial(this.material(`point-${nearest.id}`,new Color(225,190,55),0.15,0.5),0);this.notify(`${nearest.id} 点的敌方装置已清除`);
    }
  }
  private startRandomOnlineMatch(): void { this.selectedMission=this.randomMission(this.playerTeam);this.selectedMap=this.randomMap();this.missionOwner=this.playerTeam;this.roomClient.startMatch(this.selectedMap,this.selectedMission,this.missionOwner); }
  private startBattleRoyale():void{this.gameMode='single';this.playerTeam='blue';this.selectedMission='battle-royale';this.selectedMap=this.randomMap();this.missionOwner='blue';this.startMatch([],true);}
  private startOnlineMatch(map: MapId, mission: MissionId, missionTeam: Team, players: RoomPlayer[]): void {
    const local=players.find(player=>player.id===this.roomClient.id);if(!local){this.notify('未找到本地联机席位');return;}
    this.gameMode='online';this.playerTeam=local.team;this.selectedPrimary[local.team]=local.weapon;this.selectedMap=map;this.selectedMission=mission;this.missionOwner=missionTeam;this.startMatch(players,true);
  }

  private startMatch(roster: RoomPlayer[] = [], prepared = false): void {
    if(!prepared){this.selectedMission=this.randomMission(this.playerTeam);this.selectedMap=this.randomMap();this.missionOwner=this.playerTeam;}
    // Daylight is the normal state; a night round is occasional and never repeats back-to-back.
    this.applyWeatherLighting(this.weather === 'night' || Math.random() >= 0.2 ? 'day' : 'night');
    for(const team of ['blue','red'] as Team[]){const unlocked=unlockedPrimaryWeapons(team,this.profileStore.profile.level);if(!unlocked.includes(this.selectedPrimary[team]))this.selectedPrimary[team]=unlocked[0];}
    this.paused = false; this.lifecyclePaused = false; this.cursorMode = false; this.destroyLayer(this.pauseLayer); this.pauseLayer = null; this.destroyLayer(this.menuLayer); this.menuLayer = null; this.destroyLayer(this.resultLayer); this.resultLayer = null;
    this.clearMatch();if(this.selectedMap==='city')this.builtMap=null;this.buildSelectedMap();this.configureMissionObjectives();this.restartCount += 1; this.matchId = `${Date.now()}-${Math.floor(Math.random()*1e6)}`; this.phase = 'countdown'; this.countdown = 5; this.matchTime = MISSION_DEFINITIONS[this.selectedMission].durationSeconds; this.matchClock = 0; this.missionProgress=0; this.missionEquipmentReadyAt=0;this.teamKills.blue=0;this.teamKills.red=0;this.missionTargetId='';
    this.score.blue = 0; this.score.red = 0; this.lastObjectiveTick = 0; this.lastTacticalMapDraw=-Infinity; this.setHudVisible(false);
    this.spawnTeams(roster); this.assignMissionCommanders(); if(this.selectedMission==='battle-royale')this.spawnBattleRoyaleVehicles(); this.spawnWorldPickups(); this.showMissionBriefing(); this.notify(this.gameMode==='online'?`联机房间 ${this.roomClient.code}`:'准备战斗'); this.requestPointerLock();
  }

  private configureMissionObjectives():void{const mission=MISSION_DEFINITIONS[this.selectedMission];for(const point of this.capturePoints){point.ring.active=this.selectedMission==='conquest'||mission.objectiveIds.includes(point.id);point.progress=0;point.progressTeam=null;point.owner=this.selectedMission==='cache-defense'&&mission.objectiveIds.includes(point.id)?this.missionOwner:null;point.ring.getComponent(MeshRenderer)?.setMaterial(point.owner?this.material(`owned-${point.owner}`,point.owner==='blue'?new Color(40,105,205):new Color(205,55,55),0.1,0.6):this.material(`point-${point.id}`,new Color(225,190,55),0.15,0.5),0);}}

  private showMissionBriefing(): void {
    this.destroyLayer(this.missionLayer);const mission=MISSION_DEFINITIONS[this.selectedMission];this.missionLayer=this.panel('MissionBriefing',new Color(5,9,12,242));
    const mapName=MAP_DISPLAY_NAMES[this.selectedMap];
    this.makeText('任务简报',new Vec3(0,260),52,this.missionLayer,new Color(232,238,230));
    this.makeText(`${mapName} · ${mission.title}`,new Vec3(0,175),38,this.missionLayer,this.missionOwner==='blue'?new Color(110,175,240):new Color(238,125,115));
    this.makeText(mission.brief,new Vec3(0,95),27,this.missionLayer,Color.WHITE);
    this.makeText(`任务装备：${mission.equipment}`,new Vec3(0,25),25,this.missionLayer,new Color(235,199,75));
    this.makeText(`使用方式：${mission.equipmentUse}`,new Vec3(0,-35),24,this.missionLayer,new Color(255,224,128));
    this.makeText(`任务时限 ${Math.floor(mission.durationSeconds/60)} 分钟 · 5 秒后进入战区`,new Vec3(0,-100),24,this.missionLayer,new Color(165,175,170));
    if(this.missionUsesCommanders()){const role=this.player?.isCommander?'你是本次任务要员：额外生命与移动速度已生效':'地图将用浅色标记任务要员位置';this.makeText(role,new Vec3(0,-155),22,this.missionLayer,new Color(225,145,130));}
  }

  private spawnTeams(roster: RoomPlayer[] = []): void {
    this.networkActors.clear();
    if(this.selectedMission==='battle-royale'){
      const local=roster.find(member=>member.id===this.roomClient.id);const members=(local?[local,...roster.filter(member=>member!==local)]:roster).slice(0,BATTLE_ROYALE_SIZE);
      for(let i=0;i<BATTLE_ROYALE_SIZE;i+=1){const member=members[i],online=Boolean(member),isPlayer=online?member.id===this.roomClient.id:roster.length===0&&i===0;const pool=[...PRIMARY_WEAPONS.blue,...PRIMARY_WEAPONS.red];const primary=member?.weapon||(isPlayer?this.selectedPrimary.blue:pool[(i+this.restartCount)%pool.length]);const actor=this.createActor('blue',isPlayer,i,primary,online&&!isPlayer,member?.id||null);this.actors.push(actor);if(isPlayer)this.player=actor;if(member)this.networkActors.set(member.id,actor);}
      if(this.player)this.attachCamera();
      return;
    }
    for (const team of ['blue','red'] as Team[]) {
      const humans=roster.filter(member=>member.team===team).slice(0,TEAM_SIZE);
      for (let i = 0; i < TEAM_SIZE; i += 1) {
        const member=humans[i];const online=Boolean(member);const isPlayer=online?member.id===this.roomClient.id:roster.length===0&&team===this.playerTeam&&i===0;
        const primary=member?.weapon||(isPlayer?this.selectedPrimary[team]:this.pickAiWeapon(team,i));
        const actor = this.createActor(team,isPlayer,i,primary,online&&!isPlayer,member?.id||null);this.actors.push(actor);if(isPlayer)this.player=actor;if(member)this.networkActors.set(member.id,actor);
      }
    }
    if (this.player) this.attachCamera();
  }

  private assignMissionCommanders(): void {
    this.teamCommanders = { blue: '', red: '' };
    if(this.selectedMission==='battle-royale'){for(const actor of this.actors){actor.isCommander=false;actor.maxHealth=100;actor.health=100;}return;}
    for(const actor of this.actors){actor.isCommander=false;actor.maxHealth=100;actor.health=Math.min(actor.health,100);}
    const protectedTeam:Team|null=this.selectedMission==='vip-escort'||this.selectedMission==='command-defense'||this.selectedMission==='evacuation-cover'?this.missionOwner:this.selectedMission==='extraction-intercept'?oppositeTeam(this.missionOwner):null;
    for (const team of ['blue', 'red'] as Team[]) {
      const candidates = this.actors.filter(actor => actor.team === team);
      const localPlayer=candidates.find(actor=>actor.player);
      const playerChance=this.selectedMission==='command-strike'?0.55:protectedTeam===team?0.38:0;
      const commander=localPlayer&&Math.random()<playerChance?localPlayer:candidates[Math.floor(Math.random()*Math.max(1,candidates.length))];
      if(commander){this.teamCommanders[team]=commander.id;if(this.selectedMission==='command-strike'||protectedTeam===team){commander.isCommander=true;commander.maxHealth=this.selectedMission==='command-strike'?150:135;commander.health=commander.maxHealth;}}
    }
    const enemy = oppositeTeam(this.missionOwner);
    this.missionTargetId = this.teamCommanders[enemy] || '';
  }

  private spawnWorldPickups(): void {
    this.worldPickups.length = 0;
    const candidates = this.navPoints.filter(point => point.y >= -0.1 && Math.abs(point.x) < MAP_HALF - 5 && Math.abs(point.z) < MAP_HALF - 5);
    const chosen: Vec3[] = [];
    for (let attempt = 0; attempt < PICKUP_COUNT * 18 && chosen.length < PICKUP_COUNT; attempt += 1) {
      const point = candidates[Math.floor(Math.random() * Math.max(1, candidates.length))];
      if (!point || chosen.some(other => Vec3.distance(other, point) < 10) || this.actors.some(actor => Vec3.distance(actor.node.worldPosition, point) < 9)) continue;
      chosen.push(point.clone());
    }
    const weaponIds = this.selectedMission==='battle-royale' ? ['type38','zhongzheng-shi','type96-lmg','type92-hmg'] as WeaponId[] : (Object.keys(WEAPONS).filter(id=>id!=='glock17') as WeaponId[]);
    const pickupKinds: PickupKind[] = ['weapon','weapon','weapon','weapon','weapon','grenade','grenade','medkit','medkit'];
    let battleRoyaleWeaponIndex=0;
    for (let i = pickupKinds.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [pickupKinds[i], pickupKinds[j]] = [pickupKinds[j], pickupKinds[i]]; }
    for (let index = 0; index < chosen.length; index += 1) {
      const kind: PickupKind = pickupKinds[index] || 'weapon';
      const weaponId = kind === 'weapon' ? this.selectedMission==='battle-royale' ? weaponIds[battleRoyaleWeaponIndex++%weaponIds.length] : weaponIds[Math.floor(Math.random() * weaponIds.length)] : null;
      const root = new Node(`WorldPickup-${index}`); root.layer = Layers.Enum.DEFAULT; root.setPosition(chosen[index]);
      const halo = new Node('PickupHalo'); root.addChild(halo);
      const haloMaterial = this.material('pickupHalo', new Color(250, 218, 120), 0.05, 0.22);
      for (let segment = 0; segment < 8; segment += 1) {
        const angle = segment * Math.PI / 4;
        const part = this.box('HaloSegment', new Vec3(Math.cos(angle) * 0.82, 0.045, Math.sin(angle) * 0.82), new Vec3(0.22, 0.045, 0.58), haloMaterial, halo);
        part.setRotationFromEuler(0, -angle * 180 / Math.PI, 0);
      }
      const airDrop=this.selectedMission==='battle-royale'&&kind==='weapon';
      const pickup: WorldPickup = { node: root, halo, kind, weaponId, active: true, baseY: chosen[index].y, phase: Math.random() * Math.PI * 2, airDrop, dropAt:airDrop?12+Math.max(0,battleRoyaleWeaponIndex-1)*48:0, landed:!airDrop, announced:false };
      const objectMaterial = this.material(`pickup-${kind}`, kind === 'weapon' ? new Color(48, 52, 48) : kind === 'grenade' ? new Color(45, 75, 44) : new Color(220, 225, 214), 0.18, 0.45);
      if (kind === 'weapon') {
        const def = WEAPONS[weaponId!];
        this.box('PickupReceiver',new Vec3(0,0.45,0),new Vec3(def.category==='hmg'?0.34:def.category==='lmg'?0.26:0.2,def.category==='hmg'?0.25:0.18,def.category==='smg'?0.62:def.category==='sniper'?1.15:0.9),objectMaterial,root);
        this.box('PickupBarrel', new Vec3(0, 0.47, -0.58), new Vec3(0.075, 0.075, 0.52), objectMaterial, root);
        this.box('PickupStock', new Vec3(0, 0.43, 0.47), new Vec3(0.16, 0.2, 0.34), objectMaterial, root);
      } else if (kind === 'grenade') {
        this.sphere('PickupGrenade', new Vec3(0, 0.34, 0), new Vec3(0.38, 0.38, 0.38), objectMaterial, root);
        this.box('PickupGrenadePin', new Vec3(0.17, 0.54, 0), new Vec3(0.06, 0.12, 0.06), haloMaterial, root);
      } else {
        this.box('PickupMedkit', new Vec3(0, 0.34, 0), new Vec3(0.62, 0.35, 0.44), objectMaterial, root);
        this.box('PickupMedkitCrossV', new Vec3(0, 0.54, -0.225), new Vec3(0.1, 0.13, 0.26), haloMaterial, root);
        this.box('PickupMedkitCrossH', new Vec3(0, 0.54, -0.225), new Vec3(0.26, 0.13, 0.1), haloMaterial, root);
      }
      this.worldRoot.addChild(root);if(airDrop){root.active=false;root.setPosition(chosen[index].x,chosen[index].y+18,chosen[index].z);} this.worldPickups.push(pickup);
    }
  }

  private spawnBattleRoyaleVehicles(): void {
    this.vehicles.length=0;
    const vehicleMaterial=this.material('brVehicle',new Color(47,53,55),0.72,0.32),glass=this.material('brVehicleGlass',new Color(48,92,105),0.46,0.16),rubber=this.material('brVehicleRubber',new Color(18,20,20),0.1,0.82),gunmetal=this.material('brVehicleGun',new Color(35,38,36),0.82,0.24);
    for(const [index,position] of [[-34,-22],[34,22],[0,56]] as Array<[number,number]>){
      const node=new Node(`BattleRoyaleVehicle-${index}`);node.setPosition(position[0],0,position[1]);this.worldRoot.addChild(node);
      this.box('VehicleBody',new Vec3(0,0.72,0),new Vec3(4.2,1.15,7.2),vehicleMaterial,node);
      this.box('VehicleCabin',new Vec3(0,1.55,0.55),new Vec3(3.45,1.15,3.0),vehicleMaterial,node);
      this.box('VehicleWindshield',new Vec3(0,1.62,-1.05),new Vec3(3.0,0.72,0.06),glass,node);
      this.box('VehicleGunMount',new Vec3(0,2.18,-0.35),new Vec3(0.18,0.32,0.18),gunmetal,node);
      this.cylinder('VehicleGunBarrel',new Vec3(0,2.24,-1.05),0.12,1.45,gunmetal,node,'z');
      for(const side of [-1,1])for(const z of [-2.45,2.45])this.cylinder('VehicleWheel',new Vec3(side*2.05,0.55,z),0.95,0.34,rubber,node,'x');
      this.vehicles.push({node,active:true,health:520,gun:{magazine:600,reserve:0,lastShotAt:-Infinity,reloading:false},occupant:null,yaw:0});
    }
  }

  private toggleVehicle(): void {
    const player=this.player;if(!player?.alive||this.selectedMission!=='battle-royale')return;
    if(player.vehicle){const vehicle=player.vehicle;const side=new Vec3(Math.cos(vehicle.yaw*Math.PI/180),0,-Math.sin(vehicle.yaw*Math.PI/180));const exit=vehicle.node.worldPosition.clone();Vec3.scaleAndAdd(exit,exit,side,3.2);player.vehicle=null;vehicle.occupant=null;player.node.setWorldPosition(exit);player.grounded=true;this.notify('已离开载具');return;}
    const vehicle=this.vehicles.find(item=>item.active&&Vec3.distance(item.node.worldPosition,player.node.worldPosition)<4.2);if(!vehicle){this.notify('附近没有可用载具');return;}
    player.weapon.reloading=false;player.action.cancel();this.releaseFire();vehicle.occupant=player;player.vehicle=vehicle;player.node.setWorldPosition(vehicle.node.worldPosition);this.setAds(false);this.notify('已进入载具 · WASD 驾驶 · 左键车载机枪 · V 离开');
  }

  private updateVehiclePlayer(dt:number): void {
    const player=this.player,vehicle=player?.vehicle;if(!player||!vehicle||!vehicle.active)return;
    let forward=0,turn=0;if(this.keyState.has(KeyCode.KEY_W))forward+=1;if(this.keyState.has(KeyCode.KEY_S))forward-=0.6;if(this.keyState.has(KeyCode.KEY_A))turn-=1;if(this.keyState.has(KeyCode.KEY_D))turn+=1;
    vehicle.yaw+=turn*58*dt*clamp(Math.abs(forward)+0.25,0.25,1);const radians=vehicle.yaw*Math.PI/180;const direction=new Vec3(-Math.sin(radians),0,-Math.cos(radians));const next=vehicle.node.worldPosition.clone();Vec3.scaleAndAdd(next,next,direction,forward*9.5*dt);const bounded=new Vec3(clamp(next.x,-MAP_HALF+5,MAP_HALF-5),0,clamp(next.z,-MAP_HALF+5,MAP_HALF-5));if(!this.blocked(bounded.x,bounded.z,2.1,0,1.8))vehicle.node.setWorldPosition(bounded);
    player.yaw=vehicle.yaw;player.pitch=clamp(player.pitch,-70,70);player.node.setWorldPosition(vehicle.node.worldPosition);this.cameraNode.setWorldPosition(vehicle.node.worldPosition.x,vehicle.node.worldPosition.y+1.55,vehicle.node.worldPosition.z);this.cameraNode.setRotationFromEuler(player.pitch,player.yaw,0);if(this.fireHeld)this.fireVehicleGun(vehicle,player);
  }

  private fireVehicleGun(vehicle:VehicleRuntime,shooter:Actor):boolean{
    if(!vehicle.active||vehicle.occupant!==shooter||vehicle.gun.magazine<=0){if(vehicle.gun.magazine<=0&&this.notification!=='车载机枪弹药耗尽')this.notify('车载机枪弹药耗尽');return false;}
    if(!consumeShot(vehicle.gun,WEAPONS['type92-hmg'],this.matchClock))return false;
    const direction=this.direction(shooter.yaw,shooter.pitch),origin=shooter.player?this.cameraNode.worldPosition.clone():new Vec3(vehicle.node.worldPosition.x,vehicle.node.worldPosition.y+1.55,vehicle.node.worldPosition.z),obstacleDistance=this.rayObstacleDistance(origin,direction,180);let target:Actor|null=null,bestDistance=obstacleDistance;
    for(const actor of this.actors){if(!actor.alive||!this.areOpponents(shooter,actor))continue;const center=new Vec3(actor.node.worldPosition.x,actor.node.worldPosition.y+1.15,actor.node.worldPosition.z),distance=this.raySphere(origin,direction,center,0.75);if(distance!==null&&distance<bestDistance){target=actor;bestDistance=distance;}}
    if(target)this.damageActor(target,damageAtDistance(WEAPONS['type92-hmg'],bestDistance,false),shooter,`vehicle-gun-${this.shotSequence++}`);
    this.spawnMuzzle(shooter);this.audio.play('type92-hmg');if(shooter.player)this.weaponKickVelocity+=0.45;if(this.gameMode==='online'&&shooter.player&&!this.roomClient.isHost)this.roomClient.sendFire(shooter.weaponId);return true;
  }

  private destroyVehicle(vehicle:VehicleRuntime): void {
    if(!vehicle.active)return;vehicle.active=false;vehicle.health=0;vehicle.node.active=false;const occupant=vehicle.occupant;vehicle.occupant=null;if(occupant){occupant.vehicle=null;this.killActor(occupant,null,`vehicle-${this.shotSequence++}`);}this.spawnExplosion(vehicle.node.worldPosition);this.audio.play('explosion');
  }

  private damageVehicle(vehicle:VehicleRuntime,damage:number): void {if(!vehicle.active)return;vehicle.health=Math.max(0,vehicle.health-damage);if(vehicle.health<=0)this.destroyVehicle(vehicle);}

  private updateWorldPickups(dt: number): void {
    const player = this.player;
    for (const pickup of this.worldPickups) {
      if (!pickup.active) continue;
      if(pickup.airDrop&&!pickup.landed){
        if(this.matchClock<pickup.dropAt)continue;
        if(!pickup.announced){pickup.announced=true;pickup.node.active=true;this.notify(`运输机投放 ${pickup.weaponId?WEAPONS[pickup.weaponId].displayName:'补给'} · 黄色光环标记`);}
        const position=pickup.node.position;const nextY=Math.max(pickup.baseY,position.y-dt*4.5);pickup.node.setPosition(position.x,nextY,position.z);pickup.halo.setRotationFromEuler(0,(this.matchClock*38)%360,0);if(nextY>pickup.baseY+0.01)continue;pickup.landed=true;
      }
      pickup.phase += dt * 1.8;
      pickup.node.setPosition(pickup.node.position.x, pickup.baseY + Math.sin(pickup.phase) * 0.045, pickup.node.position.z);
      pickup.halo.setRotationFromEuler(0, (this.matchClock * 38) % 360, 0);
      if (!player || !player.alive || player.action.exclusive !== 'idle') continue;
      if (Vec3.distance(player.node.worldPosition, pickup.node.worldPosition) > 1.55 || Math.abs(player.node.worldPosition.y - pickup.baseY) > 2.2) continue;
      this.collectWorldPickup(pickup, player);
    }
  }

  private collectWorldPickup(pickup: WorldPickup, player: Actor): void {
    if (!pickup.active) return;
    pickup.active = false; pickup.node.active = false;
    if (pickup.kind === 'grenade') {
      player.grenades = Math.min(8, player.grenades + 1); this.notify(`拾取手雷 · 当前 ${player.grenades}`); return;
    }
    if (pickup.kind === 'medkit') {
      player.medkits = Math.min(5, player.medkits + 1); this.notify(`拾取医疗包 · 当前 ${player.medkits}`); return;
    }
    const weaponId = pickup.weaponId!;
    if(pickup.airDrop){const reserve=this.pickupReserveFor(weaponId);player.supplyWeaponId=weaponId;player.supplyWeapon=createWeaponRuntime(weaponId);player.supplyWeapon.reserve=reserve;if(player.activeSlot===4){player.weaponId=weaponId;player.weapon=player.supplyWeapon;player.loadout=this.profileLoadout(weaponId);this.setAds(false);this.resetRecoil();this.updateWeaponAppearance();}this.notify(`取得空投 ${WEAPONS[weaponId].displayName} · 按 4 切换`);return;}
    const replacingActivePickup = player.activeSlot === 3;
    const reserve=this.pickupReserveFor(weaponId);player.pickedWeaponId=weaponId;player.pickedWeapon=createWeaponRuntime(weaponId);player.pickedWeapon.reserve=reserve;
    if (replacingActivePickup) { player.weaponId = weaponId; player.weapon = player.pickedWeapon; this.setAds(false); this.resetRecoil(); this.updateWeaponAppearance(); }
    this.notify(`拾取 ${WEAPONS[weaponId].displayName} · 按 3 切换 · 备弹 ${reserve}`);
  }

  private pickupReserveFor(id:WeaponId):number{return ['type24-hmg','type92-hmg'].includes(id)?WEAPONS[id].reserveAmmo:PICKED_WEAPON_RESERVE;}

  private pickAiWeapon(team: Team, index: number): PrimaryWeaponId {
    const pool=PRIMARY_WEAPONS[team];
    return pool[(index+this.restartCount)%pool.length];
  }

  private aiLoadoutFor(id: WeaponId, team: Team, index: number): WeaponLoadout {
    const category=WEAPONS[id].category;
    if(category==='pistol')return { optic:'none', grip:false, stock:'none', barrel:'none' };
    const seed=(index*7+(team==='red'?3:0)+id.length)%12;
    return {
      optic: BUILT_IN_OPTICS[id] ? 'none' : seed%6===0 ? '2x' : seed%3===0 ? 'red-dot' : 'none',
      grip: seed%2===0,
      stock: category==='sniper'||category==='hmg' ? 'none' : seed%5===0 ? 'collapsible-stock' : seed%7===0 ? 'folding-stock' : 'none',
      barrel: seed%8===0 ? 'precision-barrel' : seed%5===0 ? 'heavy-barrel' : seed%3===0 ? 'barrel' : 'none',
    };
  }

  private actorLoadout(actor: Actor): WeaponLoadout {
    return actor.player ? this.profileLoadout(actor.weaponId) : actor.loadout;
  }

  private profileLoadout(id: WeaponId): WeaponLoadout {
    return this.profileStore.profile.loadouts[id] || { optic:'none', grip:false, stock:'none', barrel:'none' };
  }

  private attachmentSpreadMultiplier(loadout: WeaponLoadout): number {
    const grip=loadout.grip?0.82:1;
    const stock=loadout.stock==='collapsible-stock'?0.92:loadout.stock==='folding-stock'?1.05:1;
    const barrel=loadout.barrel==='precision-barrel'?0.7:loadout.barrel==='heavy-barrel'?0.8:loadout.barrel==='barrel'?0.9:1;
    return grip*stock*barrel;
  }

  private attachmentRecoilMultiplier(loadout: WeaponLoadout): number {
    const grip=loadout.grip?0.8:1;
    const stock=loadout.stock==='collapsible-stock'?0.82:loadout.stock==='folding-stock'?0.94:1;
    const barrel=loadout.barrel==='precision-barrel'?0.9:loadout.barrel==='heavy-barrel'?0.96:1;
    return grip*stock*barrel;
  }

  private reloadDuration(actor: Actor, definition: WeaponDefinition): number {
    const loadout=this.actorLoadout(actor);
    const stock=loadout.stock==='collapsible-stock'?0.94:loadout.stock==='folding-stock'?0.98:1;
    const barrel=loadout.barrel==='precision-barrel'?1.08:loadout.barrel==='heavy-barrel'?1.04:1;
    return definition.reloadSeconds*stock*barrel;
  }

  private aiHasOpponentAdvantage(actor: Actor): boolean { return this.gameMode==='single'&&actor.team!==this.playerTeam; }

  private areOpponents(first:Actor,second:Actor):boolean{return first!==second&&(this.selectedMission==='battle-royale'||first.team!==second.team);}

  private aiRoleForWeapon(id: WeaponId, seed: number): Actor['tacticalRole'] {
    const category=WEAPONS[id].category;
    if(category==='sniper')return 'marksman';
    if(category==='hmg'||category==='lmg')return 'support';
    return seed%4===1?'flank':'assault';
  }

  private createActor(team: Team, isPlayer: boolean, index: number, primaryOverride?: PrimaryWeaponId, remoteHuman = false, networkId: string | null = null): Actor {
    const actorId=networkId?`human-${networkId}`:`${team}-${isPlayer?'p':`ai${index}`}`;
    const node = new Node(actorId); this.worldRoot.addChild(node);
    const freeForAll=this.selectedMission==='battle-royale';
    // Keep the internal team IDs red/blue, but give each faction a WWII palette:
    // red = Chinese Nationalist Army (grey-green), blue = Japanese Army (khaki).
    const uniform = this.material(freeForAll?'battle-royale-uniform':team, freeForAll?new Color(82,86,84):team === 'blue' ? new Color(142,116,67) : new Color(96,105,82), 0.03, freeForAll?0.88:team==='blue'?0.9:0.94);
    const gear = this.material(freeForAll?'battle-royale-gear':`${team}-gear`,freeForAll?new Color(39,42,41):team === 'blue' ? new Color(82,61,37) : new Color(72,74,54),freeForAll?0.12:team==='blue'?0.04:0.03,freeForAll?0.74:0.9);
    const skin=this.material('characterSkin',new Color(151,116,88),0.01,0.82),boots=this.material('characterBoots',new Color(35,31,24),0.06,0.9),weaponMat=this.material('actorWeapon',new Color(38,42,41),0.92,0.21);
    const goggles=this.material('operatorGoggles',new Color(20,38,45),0.58,0.16),utility=this.material('operatorUtility',new Color(52,48,38),0.08,0.86);
    const redCloth=this.material('redFactionCloth',new Color(104,112,82),0.01,0.96),redWebbing=this.material('redFactionWebbing',new Color(67,77,53),0.02,0.94);
    this.box('Torso',new Vec3(0,1.18,0),new Vec3(0.62,0.78,0.36),uniform,node);
    this.box('Vest',new Vec3(0,1.18,-0.2),new Vec3(0.68,0.68,0.12),gear,node).active=false;
    this.box('Pelvis',new Vec3(0,0.76,0),new Vec3(0.52,0.28,0.34),gear,node);
    this.sphere('Head',new Vec3(0,1.78,0),new Vec3(0.38,0.42,0.38),skin,node);
    this.box('Helmet',new Vec3(0,1.99,0),new Vec3(0.46,0.2,0.44),gear,node).active=team==='blue';
    this.sphere('HelmetCrown',new Vec3(0,2.02,0.015),new Vec3(0.49,0.25,0.46),gear,node).active=team==='blue';
    this.box('FaceMask',new Vec3(0,1.69,-0.205),new Vec3(0.34,0.25,0.055),gear,node).active=false;
    this.box('Goggles',new Vec3(0,1.84,-0.225),new Vec3(0.36,0.105,0.045),goggles,node).active=false;
    this.box('NVGMount',new Vec3(0,2.04,-0.245),new Vec3(0.14,0.11,0.055),utility,node).active=false;
    this.box('HelmetRailL',new Vec3(-0.25,1.99,0),new Vec3(0.045,0.075,0.3),utility,node).active=false;
    this.box('HelmetRailR',new Vec3(0.25,1.99,0),new Vec3(0.045,0.075,0.3),utility,node).active=false;
    this.box('EarProtectionL',new Vec3(-0.255,1.84,0),new Vec3(0.075,0.19,0.14),gear,node).active=false;
    this.box('EarProtectionR',new Vec3(0.255,1.84,0),new Vec3(0.075,0.19,0.14),gear,node).active=false;
    this.sphere('HeadWrap',new Vec3(0,1.96,0.01),new Vec3(0.47,0.23,0.44),redCloth,node).active=team==='red';
    this.box('BrowWrap',new Vec3(0,1.86,-0.215),new Vec3(0.39,0.11,0.05),redCloth,node).active=team==='red';
    this.box('NeckScarf',new Vec3(0,1.56,-0.02),new Vec3(0.44,0.18,0.38),redCloth,node).active=team==='red';
    this.box('ScarfTailL',new Vec3(-0.17,1.48,0.18),new Vec3(0.13,0.36,0.08),redCloth,node).active=team==='red';
    this.box('ScarfTailR',new Vec3(0.05,1.46,0.2),new Vec3(0.11,0.3,0.08),redCloth,node).active=team==='red';
    this.box('Backpack',new Vec3(0,1.22,0.24),new Vec3(0.52,0.62,0.18),gear,node);
    this.box('ShoulderPadL',new Vec3(-0.43,1.42,-0.015),new Vec3(0.23,0.18,0.3),gear,node).active=false;
    this.box('ShoulderPadR',new Vec3(0.43,1.42,-0.015),new Vec3(0.23,0.18,0.3),gear,node).active=false;
    for(const [name,x] of [['ChestPouchL',-0.22],['ChestPouchC',0],['ChestPouchR',0.22]] as const)this.box(name,new Vec3(x,1.14,-0.285),new Vec3(0.18,0.29,0.12),gear,node);
    this.box('TacticalBelt',new Vec3(0,0.86,-0.01),new Vec3(0.6,0.12,0.39),gear,node);
    this.box('Holster',new Vec3(0.35,0.66,-0.02),new Vec3(0.15,0.34,0.22),gear,node);
    this.box('Radio',new Vec3(-0.34,1.28,0.22),new Vec3(0.16,0.3,0.13),utility,node).active=false;
    this.box('RadioAntenna',new Vec3(-0.39,1.62,0.23),new Vec3(0.035,0.48,0.035),utility,node).active=false;
    this.box('ChestRig',new Vec3(0,1.13,-0.255),new Vec3(0.58,0.43,0.1),redWebbing,node).active=team==='red';
    this.box('BandolierL',new Vec3(-0.13,1.23,-0.31),new Vec3(0.12,0.72,0.07),redCloth,node).active=team==='red';
    this.box('BandolierR',new Vec3(0.15,1.21,-0.315),new Vec3(0.1,0.65,0.07),redWebbing,node).active=team==='red';
    this.box('Satchel',new Vec3(-0.42,0.9,0.02),new Vec3(0.28,0.4,0.2),redCloth,node).active=team==='red';
    this.box('SatchelStrap',new Vec3(-0.12,1.19,-0.24),new Vec3(0.07,0.9,0.06),redWebbing,node).active=team==='red';
    this.box('BeltPouchL',new Vec3(-0.27,0.83,-0.13),new Vec3(0.18,0.2,0.14),redCloth,node).active=team==='red';
    this.box('BeltPouchR',new Vec3(0.27,0.83,-0.13),new Vec3(0.18,0.2,0.14),redCloth,node).active=team==='red';
    for(const side of [-1,1]){
      const suffix=side<0?'L':'R';this.box(`UpperArm${suffix}`,new Vec3(side*0.42,1.27,-0.03),new Vec3(0.2,0.55,0.22),uniform,node);
      this.box(`Forearm${suffix}`,new Vec3(side*0.34,1.08,-0.28),new Vec3(0.18,0.52,0.18),uniform,node);
      this.box(`Glove${suffix}`,new Vec3(side*0.27,1.03,-0.48),new Vec3(0.17,0.18,0.18),gear,node);
      this.box(`Thigh${suffix}`,new Vec3(side*0.17,0.5,0),new Vec3(0.24,0.52,0.27),uniform,node);
      this.box(`Calf${suffix}`,new Vec3(side*0.17,0.18,0),new Vec3(0.22,0.46,0.24),uniform,node);
      this.box(`KneePad${suffix}`,new Vec3(side*0.17,0.34,-0.145),new Vec3(0.25,0.22,0.07),gear,node).active=false;
      this.box(`ElbowWrap${suffix}`,new Vec3(side*0.36,1.15,-0.18),new Vec3(0.21,0.14,0.23),redCloth,node).active=team==='red';
      this.box(`KneeWrap${suffix}`,new Vec3(side*0.17,0.34,-0.14),new Vec3(0.26,0.2,0.08),redWebbing,node).active=team==='red';
      this.box(`Boot${suffix}`,new Vec3(side*0.17,0.07,-0.1),new Vec3(0.24,0.18,0.42),boots,node);
    }
    this.box('Weapon',new Vec3(0.3,1.17,-0.44),new Vec3(0.15,0.14,0.92),weaponMat,node);
    this.box('WeaponBarrel',new Vec3(0.3,1.17,-1.0),new Vec3(0.055,0.055,0.48),weaponMat,node);
    this.box('WeaponHandguard',new Vec3(0.3,1.17,-0.7),new Vec3(0.14,0.13,0.32),weaponMat,node);
    this.box('WeaponStock',new Vec3(0.3,1.17,0.08),new Vec3(0.14,0.16,0.34),gear,node);
    this.box('WeaponMagazine',new Vec3(0.3,0.98,-0.26),new Vec3(0.11,0.26,0.15),gear,node);
    this.box('WeaponOptic',new Vec3(0.3,1.3,-0.38),new Vec3(0.12,0.12,0.3),weaponMat,node).active=false;
    this.cylinder('WeaponBarrelRound',new Vec3(0.3,1.17,-1),0.055,0.48,weaponMat,node);
    this.cylinder('WeaponMuzzleRound',new Vec3(0.3,1.17,-1.27),0.075,0.12,weaponMat,node);
    this.cylinder('WeaponGasTubeRound',new Vec3(0.3,1.24,-0.72),0.05,0.32,weaponMat,node);
    this.box('WeaponTopRail',new Vec3(0.3,1.28,-0.44),new Vec3(0.12,0.025,0.5),weaponMat,node);
    this.box('WeaponPistolGrip',new Vec3(0.3,1.02,-0.2),new Vec3(0.1,0.25,0.12),gear,node);
    this.box('WeaponFrontSight',new Vec3(0.3,1.3,-1.05),new Vec3(0.035,0.12,0.035),weaponMat,node);
    this.box('WeaponRearSight',new Vec3(0.3,1.3,-0.28),new Vec3(0.07,0.07,0.035),weaponMat,node);
    this.box('WeaponBipodL',new Vec3(0.2,0.98,-0.85),new Vec3(0.035,0.34,0.035),weaponMat,node).active=false;
    this.box('WeaponBipodR',new Vec3(0.4,0.98,-0.85),new Vec3(0.035,0.34,0.035),weaponMat,node).active=false;
    if (isPlayer) for (const visual of node.children) visual.active = false;
    const primaryId = primaryOverride || (isPlayer ? this.selectedPrimary[team] : this.pickAiWeapon(team,index));
    const primaryWeapon = createWeaponRuntime(primaryId); const sidearm = createWeaponRuntime('glock17');
    const aiZone:Actor['aiZone']=this.selectedMap==='city'&&!isPlayer&&!remoteHuman&&(index===5||index===6)?'subway':'surface';
    // Keep both teams competent, but make the opposition close to player skill
    // without adding artificial health or damage bonuses.
    const baseAiSkill=isPlayer||remoteHuman?1:this.selectedMission==='battle-royale'?BATTLE_ROYALE_AI_SKILL:this.gameMode==='online'?0.94:aiCombatSkill(index,team!==this.playerTeam,team==='red'?7:0);
    // Keep the opponent close to player level without giving it extra damage;
    // navigation and weapon performance remain shared with the player. The
    // opponent already has stronger tactics below, so avoid an extra hidden
    // accuracy bonus that made otherwise fair fights feel one-sided.
    const aiSkill=isPlayer||remoteHuman?1:baseAiSkill;
    const tacticalRole=this.aiRoleForWeapon(primaryId,index);
    const loadout=isPlayer||remoteHuman ? {...this.profileStore.profile.loadouts[primaryId]} : this.aiLoadoutFor(primaryId,team,index);
    const actor: Actor = {
      id: actorId,node,team,player:isPlayer,remoteHuman,networkId,health:100,maxHealth:100,isCommander:false,alive:true,lifeId:1,
      weaponId: primaryId, weapon: primaryWeapon, loadout, primaryWeaponId: primaryId, primaryWeapon, sidearm,
      pickedWeaponId: null, pickedWeapon: null, supplyWeaponId:null, supplyWeapon:null, activeSlot: 1, vehicle:null,
      action: new ActionState(), grenades: this.missionGrenades(team), medkits: this.missionMedkits(team),
      yaw: team === 'blue' ? -90 : 90, pitch: 0, respawnAt: 0, protectedUntil: this.matchClock+2, target: null, aiState: 'objective', path: [], pathIndex: 0,
      nextThink: Math.random()*0.25, lastProgressPosition: new Vec3(), stuckTime: 0, recoveryAttempts: 0, kills: 0, triggerLatched: false,
      verticalVelocity: 0, grounded: true, nextJumpAt:0, nextTraversalAt:2+Math.random()*4, verticalTarget:null, traversalLadder:null, aiZone, aiSkill, tacticalRole, combatWaypoint: null,
      reactionReadyAt: this.matchClock, nextTacticAt: this.matchClock + 1.2 + Math.random() * 1.4, lastSeenTarget: null, lastSeenAt: -Infinity,
      nextGrenadeAt: 4 + Math.random() * 5, nextHealAt: 0, burstUntil: 0,
      strafeDirection: index % 2 === 0 ? 1 : -1, parachuting: false,visualLastPosition:new Vec3(),walkPhase:Math.random()*Math.PI*2,
    };
    const spawn = this.selectSpawn(actor); if(isPlayer&&this.selectedMission==='airborne-assault'&&team===this.missionOwner){spawn.y=13;actor.parachuting=true;actor.grounded=false;actor.verticalVelocity=-1.4;}node.setPosition(spawn); actor.lastProgressPosition.set(spawn);actor.visualLastPosition.set(spawn); node.setRotationFromEuler(0,actor.yaw,0); return actor;
  }

  private attachCamera(): void {
    if (!this.player) return; this.cameraNode.setWorldPosition(this.player.node.worldPosition.x, EYE_HEIGHT.stand, this.player.node.worldPosition.z); this.updateWeaponAppearance();
  }

  private clearMatch(): void {
    this.releaseAllInputs(); this.resetRecoil(); this.unscheduleAllCallbacks(); this.audio?.stopAll(); this.deathEvents.clear(); this.destroyLayer(this.missionLayer); this.missionLayer=null;
    if(this.zhongzheng3D)this.zhongzheng3D.active=false;this.zhongzheng3DMuzzleFlashTime=0;
    for (const pickup of this.worldPickups) if (pickup.node.isValid) pickup.node.destroy();
    this.worldPickups.length = 0;
    for (const vehicle of this.vehicles) if (vehicle.node.isValid) vehicle.node.destroy();
    this.vehicles.length = 0;
    for (const actor of this.actors) actor.node.destroy(); this.actors.length = 0; this.networkActors.clear(); this.player = null;
    for (const grenade of this.grenades) { grenade.active = false; grenade.node.active = false; }
    for (const fx of this.effects) fx.node.active = false; this.effects.length = 0;
    this.lastAiGrenadeAt = { blue: -Infinity, red: -Infinity };
    for (const point of this.capturePoints) {
      point.owner = null; point.progress = 0; point.progressTeam = null;
      point.ring.getComponent(MeshRenderer)?.setMaterial(this.material(`point-${point.id}`, new Color(225, 190, 55), 0.15, 0.5), 0);
    }
  }

  protected update(rawDelta: number): void {
    const dt = safeDelta(rawDelta); if (this.paused || this.lifecyclePaused) return;
    this.perfFrames += 1; this.perfSeconds += dt;
    if (dt > 0.001) this.perfWorstFps = Math.min(this.perfWorstFps, 1 / dt);
    if (this.notification && this.matchClock > this.notificationUntil) this.notification = '';
    if (this.phase === 'countdown') {
      this.countdown -= dt; if (this.countdown <= 0) { this.phase = 'playing'; this.destroyLayer(this.missionLayer);this.missionLayer=null;this.setHudVisible(true);this.notify('开始！'); }
      this.updateHud(); return;
    }
    if (this.phase !== 'playing') return;
    this.matchClock += dt; this.matchTime = Math.max(0,this.matchTime-dt);
    this.updatePlayer(dt); this.updateActors(dt); this.updateCharacterVisuals(dt); if(this.gameMode==='single'||this.roomClient.isHost)this.updateGrenades(dt); this.updateEffects(dt);
    if(this.gameMode==='single'||this.roomClient.isHost)this.updateCapturePoints(dt);
    if(this.gameMode==='single'||this.roomClient.isHost)this.updateMission(dt);
    this.updateAds(dt); this.updateWeaponAnimations(dt); this.updateZhongzheng3DViewModel(dt); this.updateHud(); this.updateNetwork(dt);
    if (this.matchTime <= 0) this.endMatch();
  }

  private updatePlayer(dt: number): void {
    const p = this.player; if (!p || !p.alive) { this.fireHeld = false; return; }
    this.updateRecoil(dt);
    if(p.vehicle){this.updateVehiclePlayer(dt);return;}
    let mx = 0, my = 0;
    if (this.keyState.has(KeyCode.KEY_A)) mx -= 1; if (this.keyState.has(KeyCode.KEY_D)) mx += 1;
    if (this.keyState.has(KeyCode.KEY_W)) my += 1; if (this.keyState.has(KeyCode.KEY_S)) my -= 1;
    const length = Math.hypot(mx,my); if (length > 1) { mx/=length; my/=length; }
    const yaw = p.yaw*Math.PI/180; const forward = new Vec3(-Math.sin(yaw),0,-Math.cos(yaw)); const right = new Vec3(Math.cos(yaw),0,-Math.sin(yaw));
    const speed=MOVE_SPEED[p.action.stance]*(p.action.ads?0.82:1)*this.weaponMobility(p)*(p.isCommander?1.18:1);const move=new Vec3();Vec3.scaleAndAdd(move,move,forward,my*speed*dt);Vec3.scaleAndAdd(move,move,right,mx*speed*dt);
    const ladder = this.ladderAt(p.node.worldPosition); let climbing = false;this.playerClimbingLadder=false;
    if (ladder && Math.abs(my) > 0.05) {
      const climbed = p.node.worldPosition.clone();
      climbed.x += (ladder.centerX-climbed.x)*Math.min(1,dt*8);climbed.z += (ladder.centerZ-climbed.z)*Math.min(1,dt*8);
      climbed.y = clamp(climbed.y + my * 3.8 * dt, 0, ladder.top);
      if(my>0&&climbed.y>=ladder.top-0.08){climbed.y=ladder.top;climbed.x+=ladder.exitX*1.25;climbed.z+=ladder.exitZ*1.25;} else if(my<0&&climbed.y<=0.08){climbed.y=0;}
      p.node.setWorldPosition(climbed); p.verticalVelocity = 0; p.grounded = true;
      climbing = climbed.y>0.08&&climbed.y<ladder.top-0.08;this.playerClimbingLadder=climbing;
    }
    if(!climbing)this.moveActor(p,move);
    this.updateWorldPickups(dt);
    const groundHeight = this.groundHeightAt(p.node.worldPosition.x, p.node.worldPosition.z, p.node.worldPosition.y);
    if (!ladder && p.node.worldPosition.y > groundHeight + 0.05) p.grounded = false;
    if (!p.grounded || p.verticalVelocity !== 0) {
      const pos = p.node.worldPosition.clone(); if(p.parachuting){p.verticalVelocity=Math.max(-2.4,p.verticalVelocity-1.1*dt);}else p.verticalVelocity -= 9.8 * dt; pos.y += p.verticalVelocity * dt;
      const landing = this.groundHeightAt(pos.x, pos.z, pos.y);
      if (pos.y <= landing) { pos.y = landing; p.verticalVelocity = 0; p.grounded = true; p.parachuting=false; if(this.blocked(pos.x,pos.z,PLAYER_RADIUS,landing,PLAYER_HEIGHT[p.action.stance])){const safe=this.resolveLandingPosition(pos,p.action.stance);pos.set(safe);} if(this.selectedMission==='airborne-assault')this.notify('已落地，开始推进'); }
      p.node.setWorldPosition(pos);
    }
    const moving = length > 0.05 && p.grounded; const bob = moving ? Math.sin(this.matchClock * (p.action.stance === 'stand' ? 11 : 7)) * 0.025 : 0;
    if(moving&&p.action.stance!=='prone'){
      const interval=p.action.stance==='crouch'?0.58:clamp(0.46/(speed/7.2),0.3,0.52);
      if(this.matchClock-this.lastPlayerFootstepAt>=interval){this.lastPlayerFootstepAt=this.matchClock;this.audio.playFootstep(this.footstepSurfaceAt(p.node.worldPosition),p.action.stance==='crouch');}
    }
    const roll = moving ? Math.sin(this.matchClock * 5.5) * 0.28 : 0;
    this.cameraNode.setWorldPosition(p.node.worldPosition.x,p.node.worldPosition.y+EYE_HEIGHT[p.action.stance]+bob,p.node.worldPosition.z); this.cameraNode.setRotationFromEuler(clamp(p.pitch+this.recoilPitch,-80,80),p.yaw+this.recoilYaw,roll);
    if (this.fireHeld) this.processTrigger(p);
    if (p.action.exclusive === 'throw') this.showGrenadePreview(true);
  }

  private isIndoorPosition(position:Vec3):boolean{
    if(position.y<-1.2)return true;
    return this.ceilings.some(zone=>position.x>zone.minX&&position.x<zone.maxX&&position.z>zone.minZ&&position.z<zone.maxZ&&position.y<zone.clearance-0.15);
  }

  private footstepSurfaceAt(position:Vec3):'concrete'|'metal'|'dirt'{
    if(position.y>2.8||this.obstacles.some(obstacle=>/Container|Hangar|UpperFloor|Aircraft/.test(obstacle.name)&&position.x>obstacle.minX-1&&position.x<obstacle.maxX+1&&position.z>obstacle.minZ-1&&position.z<obstacle.maxZ+1))return 'metal';
    if(this.selectedMap.startsWith('forest')||this.selectedMap.startsWith('desert')||this.selectedMap.startsWith('mountain'))return 'dirt';
    return 'concrete';
  }

  private processTrigger(actor: Actor): boolean {
    const def = WEAPONS[actor.weaponId];
    if (def.automatic) return this.fireActor(actor);
    if (!actor.triggerLatched) { actor.triggerLatched = true; return this.fireActor(actor); }
    return false;
  }

  private updateActors(dt: number): void {
    if(this.gameMode==='online'&&!this.roomClient.isHost)return;
    for (const actor of this.actors) {
      if (!actor.alive) { if (this.selectedMission!=='battle-royale'&&this.matchClock >= actor.respawnAt) this.respawnActor(actor); continue; }
      if (actor.player||actor.remoteHuman) continue;
      if (this.matchClock >= actor.nextThink) {
        const enemy=this.aiHasOpponentAdvantage(actor);
        actor.nextThink = this.matchClock+(enemy?0.11:0.13)+Math.random()*(enemy?0.045:0.05);
        this.thinkAI(actor);
      }
      this.moveAI(actor,dt);
    }
  }

  private updateCharacterVisuals(dt:number):void{
    for(const actor of this.actors){
      if(actor.player||!actor.node.active)continue;const position=actor.node.worldPosition,distance=Vec3.distance(position,actor.visualLastPosition);actor.visualLastPosition.set(position);const moving=distance>0.006;
      if(moving)actor.walkPhase+=dt*8;const cycle=moving?Math.sin(actor.walkPhase):0,stance=actor.action.stance;
      const part=(name:string)=>actor.node.getChildByName(name);const torso=part('Torso'),vest=part('Vest'),pelvis=part('Pelvis'),head=part('Head'),helmet=part('Helmet'),pack=part('Backpack'),weapon=part('Weapon'),weaponBarrel=part('WeaponBarrel');
      if(stance==='prone'){
        torso?.setPosition(0,0.48,0);torso?.setRotationFromEuler(78,0,0);torso?.setScale(0.62,0.72,0.36);vest?.setPosition(0,0.48,-0.18);vest?.setRotationFromEuler(78,0,0);pelvis?.setPosition(0,0.43,0.48);pelvis?.setRotationFromEuler(76,0,0);head?.setPosition(0,0.5,-0.58);helmet?.setPosition(0,0.63,-0.57);pack?.setPosition(0,0.65,0.05);pack?.setRotationFromEuler(78,0,0);weapon?.setPosition(0.2,0.45,-0.72);weapon?.setRotationFromEuler(0,0,0);weaponBarrel?.setPosition(0.2,0.45,-1.27);
        for(const side of [-1,1]){const suffix=side<0?'L':'R',phase=side<0?cycle:-cycle;part(`UpperArm${suffix}`)?.setPosition(side*0.32,0.43,-0.34+phase*0.08);part(`UpperArm${suffix}`)?.setRotationFromEuler(78,0,side*8);part(`Forearm${suffix}`)?.setPosition(side*0.3,0.38,-0.68-phase*0.06);part(`Forearm${suffix}`)?.setRotationFromEuler(82,0,side*5);part(`Glove${suffix}`)?.setPosition(side*0.25,0.4,-0.92);part(`Thigh${suffix}`)?.setPosition(side*0.18,0.39,0.72-phase*0.08);part(`Thigh${suffix}`)?.setRotationFromEuler(82,0,0);part(`Calf${suffix}`)?.setPosition(side*0.18,0.34,1.08+phase*0.1);part(`Calf${suffix}`)?.setRotationFromEuler(86,0,0);part(`Boot${suffix}`)?.setPosition(side*0.18,0.3,1.38+phase*0.1);}
        this.poseFactionGear(part,actor.team,'prone',0,cycle);
      }else{
        const crouch=stance==='crouch',drop=crouch?0.38:0;torso?.setPosition(0,1.18-drop,0);torso?.setRotationFromEuler(crouch?10:0,0,0);torso?.setScale(0.62,crouch?0.65:0.78,0.36);vest?.setPosition(0,1.18-drop,-0.2);vest?.setRotationFromEuler(crouch?10:0,0,0);pelvis?.setPosition(0,0.76-drop*0.7,0);pelvis?.setRotationFromEuler(0,0,0);head?.setPosition(0,1.78-drop,0);helmet?.setPosition(0,1.99-drop,0);pack?.setPosition(0,1.22-drop,0.24);pack?.setRotationFromEuler(crouch?10:0,0,0);weapon?.setPosition(0.3,1.17-drop,-0.44);weaponBarrel?.setPosition(0.3,1.17-drop,-1.0);
        for(const side of [-1,1]){const suffix=side<0?'L':'R',phase=side<0?cycle:-cycle;part(`UpperArm${suffix}`)?.setPosition(side*0.42,1.27-drop,-0.03);part(`UpperArm${suffix}`)?.setRotationFromEuler(phase*24,0,side*5);part(`Forearm${suffix}`)?.setPosition(side*0.34,1.08-drop,-0.28);part(`Forearm${suffix}`)?.setRotationFromEuler(-28+phase*10,0,side*5);part(`Glove${suffix}`)?.setPosition(side*0.27,1.03-drop,-0.48);part(`Thigh${suffix}`)?.setPosition(side*0.17,0.5-drop*0.45,phase*0.06);part(`Thigh${suffix}`)?.setRotationFromEuler(phase*28+(crouch?-24:0),0,0);part(`Calf${suffix}`)?.setPosition(side*0.17,0.18,phase*-0.05);part(`Calf${suffix}`)?.setRotationFromEuler(-phase*22+(crouch?32:0),0,0);part(`Boot${suffix}`)?.setPosition(side*0.17,0.07,-0.1+phase*0.08);}
        this.poseFactionGear(part,actor.team,crouch?'crouch':'stand',drop,cycle);
      }
      const visual=WEAPON_VISUALS[actor.weaponId],actorLoadout=this.actorLoadout(actor),baseX=stance==='prone'?0.2:0.3,baseY=stance==='prone'?0.45:stance==='crouch'?0.79:1.17,receiverZ=stance==='prone'?-0.72:-0.44,barrelCenter=receiverZ-visual.receiver/2-visual.barrel/2+0.04,wood=this.material('weaponWood',new Color(104,62,34),0.03,0.62),metal=this.material('actorWeapon',new Color(38,42,41),0.92,0.21),actorGear=this.material(`${actor.team}-gear`,actor.team==='blue'?new Color(82,61,37):new Color(72,74,54),0.04,0.9);
      weapon?.setPosition(baseX,baseY,receiverZ);weapon?.setScale(visual.width,visual.heavy?0.19:0.14,visual.receiver);weapon?.getComponent(MeshRenderer)?.setSharedMaterial(metal,0);if(weaponBarrel)weaponBarrel.active=false;const actorBarrel=part('WeaponBarrelRound'),actorMuzzle=part('WeaponMuzzleRound'),actorGas=part('WeaponGasTubeRound');actorBarrel?.setPosition(baseX,baseY,barrelCenter);actorBarrel?.setScale(visual.heavy?0.085:0.055,visual.barrel,visual.heavy?0.085:0.055);actorMuzzle?.setPosition(baseX,baseY,barrelCenter-visual.barrel/2-0.06);actorMuzzle?.setScale(visual.heavy?0.12:0.075,visual.heavy?0.2:0.12,visual.heavy?0.12:0.075);actorGas?.setPosition(baseX,baseY+0.07,receiverZ-visual.receiver/2-visual.handguard/2+0.08);actorGas?.setScale(visual.heavy?0.07:0.05,visual.handguard*0.9,visual.heavy?0.07:0.05);
      const actorHandguard=part('WeaponHandguard'),actorStock=part('WeaponStock'),actorMagazine=part('WeaponMagazine'),actorOptic=part('WeaponOptic');actorHandguard?.setPosition(baseX,baseY,receiverZ-visual.receiver/2-visual.handguard/2+0.08);actorHandguard?.setScale(visual.width*0.92,visual.heavy?0.15:0.12,visual.handguard);actorHandguard?.getComponent(MeshRenderer)?.setSharedMaterial(visual.wood?wood:actorGear,0);actorStock?.setPosition(baseX,baseY,receiverZ+visual.receiver/2+visual.stock/2-0.04);actorStock?.setScale(visual.width*0.88,visual.heavy?0.19:0.15,visual.stock);actorStock?.getComponent(MeshRenderer)?.setSharedMaterial(visual.wood?wood:actorGear,0);actorMagazine?.setPosition(baseX,baseY-0.18,receiverZ+0.03);actorMagazine?.setScale(visual.magazine==='box'?visual.width*1.25:0.11,visual.magazine==='box'?0.25:0.23,visual.magazine==='box'?0.28:0.15);actorMagazine?.getComponent(MeshRenderer)?.setSharedMaterial(visual.wood?wood:actorGear,0);const actorRail=part('WeaponTopRail'),actorGrip=part('WeaponPistolGrip'),actorFrontSight=part('WeaponFrontSight'),actorRearSight=part('WeaponRearSight');actorRail?.setPosition(baseX,baseY+(visual.heavy?0.14:0.1),receiverZ);actorRail?.setScale(visual.width*0.75,0.024,visual.receiver*0.78);actorGrip?.setPosition(baseX,baseY-0.17,receiverZ+visual.receiver*0.3);actorFrontSight?.setPosition(baseX,baseY+0.14,barrelCenter-visual.barrel*0.32);actorRearSight?.setPosition(baseX,baseY+0.14,receiverZ+visual.receiver*0.3);for(const name of ['WeaponBipodL','WeaponBipodR']){const bipod=part(name);if(bipod){bipod.active=visual.bipod;bipod.setPosition(baseX+(name.endsWith('L')?-0.1:0.1),baseY-0.17,barrelCenter);bipod.setRotationFromEuler(0,0,name.endsWith('L')?-14:14);}}const optic=opticForWeapon(actor.weaponId,actorLoadout.optic);if(actorOptic){actorOptic.active=optic!=='none';actorOptic.setPosition(baseX,baseY+0.15,receiverZ-0.02);actorOptic.setScale(optic==='6x'?0.16:optic==='4x'?0.14:0.1,optic==='6x'?0.16:optic==='4x'?0.14:0.1,optic==='6x'?0.5:optic==='4x'?0.4:0.2);}if(actorFrontSight)actorFrontSight.active=optic==='none';if(actorRearSight)actorRearSight.active=optic==='none';
    }
  }

  private poseFactionGear(part:(name:string)=>Node|null,team:Team,stance:'stand'|'crouch'|'prone',drop:number,cycle:number):void{
    const place=(name:string,x:number,y:number,z:number,rx=0,rz=0):void=>{const node=part(name);node?.setPosition(x,y,z);node?.setRotationFromEuler(rx,0,rz);};
    if(team==='red'){
      if(stance==='prone'){
        place('HeadWrap',0,0.64,-0.59,78);place('BrowWrap',0,0.52,-0.77,78);place('FaceMask',0,0.45,-0.78,78);place('NeckScarf',0,0.47,-0.43,78);place('ScarfTailL',-0.17,0.58,-0.15,78,-8);place('ScarfTailR',0.05,0.59,-0.1,78,7);
        place('ChestRig',0,0.4,-0.21,78);place('BandolierL',-0.13,0.39,-0.23,78,-22);place('BandolierR',0.15,0.4,-0.23,78,24);place('Satchel',-0.42,0.4,0.57,82);place('SatchelStrap',-0.12,0.43,0.05,78,-24);place('BeltPouchL',-0.27,0.37,0.51,76);place('BeltPouchR',0.27,0.37,0.51,76);
        for(const side of [-1,1]){const suffix=side<0?'L':'R';place(`ElbowWrap${suffix}`,side*0.31,0.39,-0.56-side*cycle*0.05,82,side*5);place(`KneeWrap${suffix}`,side*0.18,0.31,1.02+side*cycle*0.08,86);}
        place('ChestPouchL',-0.2,0.35,-0.25,78);place('ChestPouchC',0,0.35,-0.25,78);place('ChestPouchR',0.2,0.35,-0.25,78);place('TacticalBelt',0,0.39,0.48,76);place('Holster',0.35,0.38,0.65,82);const pack=part('Backpack');pack?.setScale(0.42,0.48,0.15);return;
      }
      const tilt=stance==='crouch'?10:0;
      place('HeadWrap',0,1.96-drop,0.01);place('BrowWrap',0,1.86-drop,-0.215);place('FaceMask',0,1.69-drop,-0.205);place('NeckScarf',0,1.56-drop,-0.02,tilt);place('ScarfTailL',-0.17,1.48-drop,0.18,tilt,-8);place('ScarfTailR',0.05,1.46-drop,0.2,tilt,7);
      place('ChestRig',0,1.13-drop,-0.255,tilt);place('BandolierL',-0.13,1.23-drop,-0.31,tilt,-24);place('BandolierR',0.15,1.21-drop,-0.315,tilt,25);place('Satchel',-0.42,0.9-drop*0.7,0.02,0,-4);place('SatchelStrap',-0.12,1.19-drop,-0.24,tilt,-24);place('BeltPouchL',-0.27,0.83-drop*0.7,-0.13);place('BeltPouchR',0.27,0.83-drop*0.7,-0.13);
      for(const side of [-1,1]){const suffix=side<0?'L':'R';place(`ElbowWrap${suffix}`,side*0.36,1.15-drop,-0.18+side*cycle*0.025,-22+side*cycle*8,side*5);place(`KneeWrap${suffix}`,side*0.17,0.34-drop*0.3,-0.14+side*cycle*0.045,stance==='crouch'?32:0);}
      place('ChestPouchL',-0.2,1.11-drop,-0.33,tilt);place('ChestPouchC',0,1.11-drop,-0.33,tilt);place('ChestPouchR',0.2,1.11-drop,-0.33,tilt);place('TacticalBelt',0,0.86-drop*0.7,-0.01);place('Holster',0.35,0.66-drop*0.55,-0.02,stance==='crouch'?-20:0);const vest=part('Vest'),pack=part('Backpack');vest?.setScale(0.62,0.5,0.1);pack?.setScale(0.42,0.48,0.15);return;
    }
    if(stance==='prone'){
      place('HelmetCrown',0,0.65,-0.59,78);place('FaceMask',0,0.45,-0.78,78);place('Goggles',0,0.52,-0.77,78);place('NVGMount',0,0.66,-0.81,78);
      for(const side of [-1,1]){const suffix=side<0?'L':'R';place(`HelmetRail${suffix}`,side*0.25,0.63,-0.58,78);place(`EarProtection${suffix}`,side*0.255,0.54,-0.58,78);place(`ShoulderPad${suffix}`,side*0.39,0.53,-0.05,78,side*6);place(`KneePad${suffix}`,side*0.18,0.31,1.02+side*cycle*0.08,86);}
      place('ChestPouchL',-0.22,0.37,-0.24,78);place('ChestPouchC',0,0.37,-0.24,78);place('ChestPouchR',0.22,0.37,-0.24,78);place('TacticalBelt',0,0.39,0.48,76);place('Holster',0.35,0.38,0.65,82);place('Radio',-0.34,0.65,0.06,78);place('RadioAntenna',-0.39,0.82,0.2,78);
      part('Vest')?.setScale(0.68,0.68,0.12);part('Backpack')?.setScale(0.52,0.62,0.18);
      return;
    }
    const tilt=stance==='crouch'?10:0;
    place('HelmetCrown',0,2.02-drop,0.015);place('FaceMask',0,1.69-drop,-0.205);place('Goggles',0,1.84-drop,-0.225);place('NVGMount',0,2.04-drop,-0.245);
    for(const side of [-1,1]){const suffix=side<0?'L':'R';place(`HelmetRail${suffix}`,side*0.25,1.99-drop,0);place(`EarProtection${suffix}`,side*0.255,1.84-drop,0);place(`ShoulderPad${suffix}`,side*0.43,1.42-drop,-0.015,tilt,side*5);place(`KneePad${suffix}`,side*0.17,0.34-drop*0.3,-0.145+side*cycle*0.045,stance==='crouch'?32:0);}
    place('ChestPouchL',-0.22,1.14-drop,-0.285,tilt);place('ChestPouchC',0,1.14-drop,-0.285,tilt);place('ChestPouchR',0.22,1.14-drop,-0.285,tilt);place('TacticalBelt',0,0.86-drop*0.7,-0.01);place('Holster',0.35,0.66-drop*0.55,-0.02,stance==='crouch'?-20:0);place('Radio',-0.34,1.28-drop,0.22,tilt);place('RadioAntenna',-0.39,1.62-drop,0.23,tilt);
    part('Vest')?.setScale(0.68,0.68,0.12);part('Backpack')?.setScale(0.52,0.62,0.18);
  }

  private aiReactionDelay(actor:Actor):number {
    const opposition=this.aiHasOpponentAdvantage(actor);
    const base=opposition?0.155:0.21;
    const skillPenalty=(opposition?0.979:0.94)-actor.aiSkill;
    return base+Math.max(0,skillPenalty)*(opposition?1.2:1.25)+Math.random()*(opposition?0.04:0.07);
  }

  private chooseCombatWaypoint(actor:Actor,target:Actor):Vec3|null {
    const actorPosition=actor.node.worldPosition,targetPosition=target.node.worldPosition;
    const away=new Vec3();Vec3.subtract(away,actorPosition,targetPosition);away.y=0;if(away.lengthSqr()<0.001)away.set(actor.team==='blue'?-1:1,0,0);else away.normalize();
    const side=new Vec3(-away.z,0,away.x);const hash=[...actor.id].reduce((sum,char)=>sum+char.charCodeAt(0),0);side.multiplyScalar(hash%2===0?1:-1);
    const desired=targetPosition.clone();
    if(actor.tacticalRole==='flank'){Vec3.scaleAndAdd(desired,desired,away,10);Vec3.scaleAndAdd(desired,desired,side,11+(hash%3)*2);}
    else if(actor.tacticalRole==='support'){Vec3.scaleAndAdd(desired,desired,away,24);Vec3.scaleAndAdd(desired,desired,side,5+(hash%3));}
    else if(actor.tacticalRole==='marksman'){Vec3.scaleAndAdd(desired,desired,away,34);Vec3.scaleAndAdd(desired,desired,side,4+(hash%4));}
    else {Vec3.scaleAndAdd(desired,desired,away,11);Vec3.scaleAndAdd(desired,desired,side,(hash%3-1)*2.5);}
    desired.x=clamp(desired.x,-MAP_HALF+2,MAP_HALF-2);desired.z=clamp(desired.z,-MAP_HALF+2,MAP_HALF-2);desired.y=actor.aiZone==='subway'?-4:0;
    const points=actor.aiZone==='subway'?this.subwayNavPoints:this.navPoints;
    return this.nearestFreePoint(desired,points,actor)||(!this.blocked(desired.x,desired.z,PLAYER_RADIUS,desired.y)?desired:null);
  }

  private maybeAssignAITraversal(actor:Actor,focus:Vec3):boolean{
    if(actor.aiZone==='subway'||actor.verticalTarget||this.matchClock<actor.nextTraversalAt||this.upperFloorNavPoints.length===0)return false;
    actor.nextTraversalAt=this.matchClock+8+Math.random()*7;
    const opposition=this.aiHasOpponentAdvantage(actor),hash=[...actor.id].reduce((sum,char)=>sum+char.charCodeAt(0),0);
    if(actor.node.worldPosition.y>2.4){
      const ramps=this.ramps.filter(r=>Math.max(r.fromHeight,r.toHeight)>2.5);
      const rampCandidate=ramps.sort((a,b)=>Math.hypot((a.minX+a.maxX)/2-actor.node.worldPosition.x,(a.minZ+a.maxZ)/2-actor.node.worldPosition.z)-Math.hypot((b.minX+b.maxX)/2-actor.node.worldPosition.x,(b.minZ+b.maxZ)/2-actor.node.worldPosition.z))[0];
      const rampDistance=rampCandidate?Math.hypot((rampCandidate.minX+rampCandidate.maxX)/2-actor.node.worldPosition.x,(rampCandidate.minZ+rampCandidate.maxZ)/2-actor.node.worldPosition.z):Infinity;
      const ramp=actor.node.worldPosition.y<4.8&&rampDistance<15?rampCandidate:undefined;
      const ladder=[...this.ladders].sort((a,b)=>Math.hypot(a.centerX-actor.node.worldPosition.x,a.centerZ-actor.node.worldPosition.z)-Math.hypot(b.centerX-actor.node.worldPosition.x,b.centerZ-actor.node.worldPosition.z))[0];
      if(!ramp&&!ladder)return false;
      actor.verticalTarget=new Vec3(ramp?(ramp.minX+ramp.maxX)/2:ladder!.centerX,0,ramp?(ramp.fromHeight<ramp.toHeight?ramp.fromZ:ramp.toZ):ladder!.centerZ);
      actor.traversalLadder=!ramp?ladder:null;actor.path=[];actor.combatWaypoint=null;actor.aiState='objective';return true;
    }
    if(this.matchClock<20)return false;
    const upperTeamCount=this.actors.filter(candidate=>candidate.alive&&!candidate.player&&candidate.team===actor.team&&(candidate.node.worldPosition.y>2.4||Boolean(candidate.verticalTarget&&candidate.verticalTarget.y>2.4))).length;
    if(upperTeamCount>=2)return false;
    const chance=opposition?0.42:0.29;
    if(((hash+Math.floor(this.matchClock))%100)/100>chance)return false;
    const candidates=this.upperFloorNavPoints.filter(point=>Vec3.distance(point,focus)<48&&Vec3.distance(point,actor.node.worldPosition)<72);
    if(candidates.length===0)return false;
    candidates.sort((a,b)=>Vec3.distance(a,focus)-Vec3.distance(b,focus));
    const destination=candidates[Math.min(candidates.length-1,hash%Math.min(4,candidates.length))].clone();
    const ramp=this.ramps.filter(item=>Math.max(item.fromHeight,item.toHeight)>2.5).sort((a,b)=>Math.hypot((a.minX+a.maxX)/2-destination.x,(a.minZ+a.maxZ)/2-destination.z)-Math.hypot((b.minX+b.maxX)/2-destination.x,(b.minZ+b.maxZ)/2-destination.z))[0];
    const ladder=[...this.ladders].filter(item=>Math.abs(item.top-destination.y)<1.3).sort((a,b)=>Math.hypot(a.centerX-destination.x,a.centerZ-destination.z)-Math.hypot(b.centerX-destination.x,b.centerZ-destination.z))[0];
    if(!ramp&&!ladder)return false;
    const rampDistance=ramp?Math.hypot((ramp.minX+ramp.maxX)/2-destination.x,(ramp.minZ+ramp.maxZ)/2-destination.z):Infinity;
    const ladderDistance=ladder?Math.hypot(ladder.centerX-destination.x,ladder.centerZ-destination.z):Infinity;
    actor.verticalTarget=destination;actor.traversalLadder=ladderDistance<rampDistance?ladder:null;actor.path=[];actor.combatWaypoint=null;actor.aiState='objective';return true;
  }

  private moveAITraversal(actor:Actor,dt:number):boolean{
    const target=actor.verticalTarget;if(!target)return false;
    const position=actor.node.worldPosition.clone(),speed=(4.15+actor.aiSkill*0.5)*this.weaponMobility(actor);
    const moveFlat=(x:number,z:number):void=>{const delta=new Vec3(x-position.x,0,z-position.z);if(delta.length()>0.08){delta.normalize();actor.yaw=Math.atan2(-delta.x,-delta.z)*180/Math.PI;actor.node.setRotationFromEuler(0,actor.yaw,0);delta.multiplyScalar(speed*dt);this.moveActor(actor,delta);}};
    const ladder=actor.traversalLadder;
    if(ladder){
      const climbingUp=target.y>position.y+0.45;
      const approachY=climbingUp?0:ladder.top;
      const horizontalDistance=Math.hypot(position.x-ladder.centerX,position.z-ladder.centerZ);
      if(horizontalDistance>1.1||Math.abs(position.y-approachY)>0.5&&horizontalDistance>0.35){moveFlat(ladder.centerX,ladder.centerZ);return true;}
      const climbed=actor.node.worldPosition.clone();climbed.x+=(ladder.centerX-climbed.x)*Math.min(1,dt*9);climbed.z+=(ladder.centerZ-climbed.z)*Math.min(1,dt*9);
      climbed.y=clamp(climbed.y+(climbingUp?1:-1)*3.6*dt,0,ladder.top);actor.verticalVelocity=0;actor.grounded=true;
      if(climbingUp&&climbed.y>=ladder.top-0.08){climbed.y=ladder.top;climbed.x+=ladder.exitX*1.2;climbed.z+=ladder.exitZ*1.2;actor.verticalTarget=null;actor.traversalLadder=null;actor.nextTraversalAt=this.matchClock+11+Math.random()*8;}
      else if(!climbingUp&&climbed.y<=0.08){climbed.y=0;actor.verticalTarget=null;actor.traversalLadder=null;actor.nextTraversalAt=this.matchClock+10+Math.random()*8;}
      actor.node.setWorldPosition(climbed);return true;
    }
    const ramps=this.ramps.filter(r=>Math.max(r.fromHeight,r.toHeight)>2.5);
    const ramp=ramps.sort((a,b)=>Math.hypot((a.minX+a.maxX)/2-target.x,(a.minZ+a.maxZ)/2-target.z)-Math.hypot((b.minX+b.maxX)/2-target.x,(b.minZ+b.maxZ)/2-target.z))[0];
    if(!ramp){actor.verticalTarget=null;return false;}
    const ascending=target.y>position.y+0.45;
    const lowZ=ramp.fromHeight<ramp.toHeight?ramp.fromZ:ramp.toZ,highZ=ramp.fromHeight<ramp.toHeight?ramp.toZ:ramp.fromZ,centerX=(ramp.minX+ramp.maxX)/2;
    const inside=position.x>ramp.minX&&position.x<ramp.maxX&&position.z>ramp.minZ&&position.z<ramp.maxZ;
    if(!inside){moveFlat(centerX,ascending?lowZ:highZ);return true;}
    moveFlat(centerX,ascending?highZ:lowZ);
    if(ascending&&actor.node.worldPosition.y>=Math.max(ramp.fromHeight,ramp.toHeight)-0.2&&Math.abs(actor.node.worldPosition.z-highZ)<0.75){
      moveFlat(target.x,target.z);if(Math.hypot(actor.node.worldPosition.x-target.x,actor.node.worldPosition.z-target.z)<1.25){actor.verticalTarget=null;actor.nextTraversalAt=this.matchClock+11+Math.random()*8;}
    }else if(!ascending&&actor.node.worldPosition.y<=0.15&&Math.abs(actor.node.worldPosition.z-lowZ)<0.75){actor.verticalTarget=null;actor.nextTraversalAt=this.matchClock+10+Math.random()*8;}
    return true;
  }

  private thinkAI(actor: Actor): void {
    const category=WEAPONS[actor.weaponId].category;
    const visible=this.nearestVisibleEnemy(actor,category==='sniper'?135:category==='hmg'?108:category==='lmg'?94:82);
    const opposition=this.aiHasOpponentAdvantage(actor);
    if(actor.verticalTarget)return;
    const retreatThreshold=opposition?0.40:0.47;
    if (actor.health <= actor.maxHealth*retreatThreshold) {
      actor.action.ads=false;
      const cover = this.nearestFreePoint(actor.node.worldPosition,this.coverPoints,actor);
      if (!visible && (!cover||Vec3.distance(actor.node.worldPosition,cover)<1.8) && actor.medkits > 0 && actor.action.exclusive === 'idle' && this.matchClock >= actor.nextHealAt) {
        actor.nextHealAt = this.matchClock + (opposition?13:16);
        this.beginHeal(actor);
        actor.aiState = 'cover'; actor.path = [];actor.combatWaypoint=null;
      } else if (cover) {
        actor.aiState='cover'; actor.path=this.findPath(actor.node.worldPosition,cover); actor.pathIndex=0;actor.combatWaypoint=cover.clone();
      }
      return;
    }
    if (visible) {
      if(this.maybeAssignAITraversal(actor,visible.node.worldPosition))return;
      const newTarget=actor.target!==visible;
      actor.target=visible;actor.lastSeenTarget=visible.node.worldPosition.clone();actor.lastSeenAt=this.matchClock;actor.aiState='engage';actor.path=[];
      const distance=Vec3.distance(actor.node.worldPosition,visible.node.worldPosition);
      actor.action.ads=distance>(opposition?9:13)||actor.tacticalRole==='marksman'||actor.tacticalRole==='support';
      if(newTarget){actor.reactionReadyAt=this.matchClock+this.aiReactionDelay(actor);actor.combatWaypoint=this.chooseCombatWaypoint(actor,visible);actor.nextTacticAt=this.matchClock+1.4+Math.random()*1.3;}
      else if(this.matchClock>=actor.nextTacticAt){actor.combatWaypoint=this.chooseCombatWaypoint(actor,visible);actor.nextTacticAt=this.matchClock+(opposition?1.8:2.35)+Math.random()*1.4;}
      if (actor.primaryWeapon.magazine <= 0 && actor.sidearm.magazine > 0 && distance < 24) this.setActorSlot(actor,2);
      else if (actor.activeSlot === 2 && actor.primaryWeapon.magazine > 0 && distance > 16) this.setActorSlot(actor,1);
      const nearbyEnemies=this.actors.filter(candidate=>candidate.alive&&this.areOpponents(actor,candidate)&&Vec3.distance(candidate.node.worldPosition,visible.node.worldPosition)<5.5).length;
      const grenadeChance=nearbyEnemies>=2?(opposition?0.3:0.2):(opposition?0.13:0.09);
      if (actor.grenades > 0 && actor.action.exclusive === 'idle' && distance > 12 && distance < 33 && this.matchClock >= actor.nextGrenadeAt && this.matchClock-this.lastAiGrenadeAt[actor.team]>1.5 && Math.random() < grenadeChance) {
        const to=new Vec3();Vec3.subtract(to,visible.node.worldPosition,actor.node.worldPosition);
        actor.yaw=Math.atan2(-to.x,-to.z)*180/Math.PI;actor.pitch=clamp(11+distance*0.28,11,20);
        this.throwGrenade(actor);this.lastAiGrenadeAt[actor.team]=this.matchClock;actor.nextGrenadeAt=this.matchClock+(opposition?14:18)+Math.random()*9;
      }
      if (actor.burstUntil <= this.matchClock && this.matchClock>=actor.reactionReadyAt && Math.random() < (opposition?0.70:0.62)+actor.aiSkill*0.2) {
        const burstBase=actor.tacticalRole==='support'?(opposition?1.598:1.2):actor.tacticalRole==='marksman'?0.34:(opposition?0.75:0.62);
        actor.burstUntil=this.matchClock+burstBase+actor.aiSkill*(actor.tacticalRole==='support'?0.9:0.58);actor.strafeDirection=actor.strafeDirection===1?-1:1;
      }
      return;
    }
    actor.action.ads=false;
    if(actor.target?.alive&&actor.lastSeenTarget&&this.matchClock-actor.lastSeenAt<(opposition?2.4:1.7)){
      actor.aiState='engage';
      if(!actor.combatWaypoint)actor.combatWaypoint=actor.lastSeenTarget.clone();
      return;
    }
    actor.target=null;actor.combatWaypoint=null;
    if (actor.activeSlot===2 && actor.primaryWeapon.magazine>0) this.setActorSlot(actor,1);
    if (actor.primaryWeapon.magazine < Math.max(3,Math.floor(WEAPONS[actor.primaryWeaponId].magazineSize*0.2)) && actor.primaryWeapon.reserve>0 && actor.action.exclusive==='idle') {
      this.setActorSlot(actor,1);this.beginReload(actor);
    }
    actor.aiState='objective';const goal=this.aiMissionGoal(actor);if(this.maybeAssignAITraversal(actor,goal))return;actor.path=this.findPath(actor.node.worldPosition,goal);if(actor.path.length===0){const rally=this.frontlineGoal(actor);if(rally)actor.path=this.findPath(actor.node.worldPosition,rally);if(actor.path.length===0&&rally)actor.path=[rally];}actor.pathIndex=0;
  }

  private moveAI(actor: Actor, dt: number): void {
    if (actor.action.exclusive==='heal') return;
    if(!actor.grounded||actor.verticalVelocity!==0){
      const airborne=actor.node.worldPosition.clone();actor.verticalVelocity-=9.8*dt;airborne.y+=actor.verticalVelocity*dt;
      const landing=this.groundHeightAt(airborne.x,airborne.z,airborne.y);if(airborne.y<=landing){airborne.y=landing;actor.verticalVelocity=0;actor.grounded=true;}actor.node.setWorldPosition(airborne);
    }
    if(this.moveAITraversal(actor,dt))return;
    const category=WEAPONS[actor.weaponId].category;
    if (actor.aiState==='engage' && actor.target?.alive) {
      const aimPoint=actor.target.node.worldPosition.clone();aimPoint.y+=1.15;
      const origin=actor.node.worldPosition.clone();origin.y+=1.45;
      const to=new Vec3(); Vec3.subtract(to,aimPoint,origin); const distance=to.length(); actor.yaw=Math.atan2(-to.x,-to.z)*180/Math.PI;actor.pitch=clamp(Math.atan2(to.y,Math.hypot(to.x,to.z))*180/Math.PI,-45,45);actor.node.setRotationFromEuler(0,actor.yaw,0);
      const clear=!this.segmentBlocked(actor.node.worldPosition,actor.target.node.worldPosition);
      const fireRange=category==='sniper'?135:category==='hmg'?108:category==='lmg'?94:82;
      if(clear&&distance<fireRange&&this.matchClock>=actor.reactionReadyAt&&this.matchClock<=actor.burstUntil)this.fireActor(actor);
      const horizontal=new Vec3(to.x,0,to.z);if(horizontal.lengthSqr()>0.001)horizontal.normalize();
      const opposition=this.aiHasOpponentAdvantage(actor);
      const move=new Vec3(),mobility=this.weaponMobility(actor)*(actor.isCommander?1.18:1),moveSpeed=((opposition?4.8:4.55)+actor.aiSkill*0.75)*mobility;
      const waypoint=actor.combatWaypoint,waypointDelta=new Vec3();if(waypoint)Vec3.subtract(waypointDelta,waypoint,actor.node.worldPosition);waypointDelta.y=0;
      const desiredRange=actor.tacticalRole==='marksman'?31:actor.tacticalRole==='support'?22:actor.tacticalRole==='flank'?13:11;
      if(waypoint&&waypointDelta.length()>1.25&&(actor.tacticalRole!=='assault'||distance>desiredRange+5)){
        waypointDelta.normalize();Vec3.scaleAndAdd(move,move,waypointDelta,moveSpeed*dt);
      }else if(distance>desiredRange+4)Vec3.scaleAndAdd(move,move,horizontal,moveSpeed*dt);
      else if(distance<Math.max(7,desiredRange-5))Vec3.scaleAndAdd(move,move,horizontal,-moveSpeed*0.72*dt);
      else {const side=new Vec3(-horizontal.z,0,horizontal.x);const strafe=actor.tacticalRole==='support'?0.8:actor.tacticalRole==='marksman'?0.55:1.5;Vec3.scaleAndAdd(move,move,side,actor.strafeDirection*strafe*dt);}
      const moved=this.moveActor(actor,move);if(!moved)this.tryAIJump(actor,move);
    } else if (actor.path.length>0) {
      const target=actor.path[Math.min(actor.pathIndex,actor.path.length-1)]; const delta=new Vec3(); Vec3.subtract(delta,target,actor.node.worldPosition); delta.y=0;
      if(delta.length()<0.8)actor.pathIndex+=1;else{delta.normalize();actor.yaw=Math.atan2(-delta.x,-delta.z)*180/Math.PI;actor.node.setRotationFromEuler(0,actor.yaw,0);delta.multiplyScalar((4.35+actor.aiSkill*0.62)*this.weaponMobility(actor)*(actor.isCommander?1.18:1)*dt);const moved=this.moveActor(actor,delta);if(!moved)this.tryAIJump(actor,delta);}
      if (actor.pathIndex>=actor.path.length) actor.path=[];
    } else if(actor.aiZone==='surface'&&this.matchClock>5){
      const rally=this.frontlineGoal(actor);if(rally){const delta=new Vec3();Vec3.subtract(delta,rally,actor.node.worldPosition);delta.y=0;if(delta.length()>0.8){delta.normalize();delta.multiplyScalar((4.2+actor.aiSkill*0.55)*this.weaponMobility(actor)*dt);const moved=this.moveActor(actor,delta);if(!moved)this.tryAIJump(actor,delta);}}
    }
    const moved=Vec3.distance(actor.node.worldPosition,actor.lastProgressPosition);
    if (moved<0.03) actor.stuckTime+=dt; else { actor.stuckTime=0; actor.recoveryAttempts=0; actor.lastProgressPosition.set(actor.node.worldPosition); }
    if (actor.stuckTime>2.5) { actor.stuckTime=0; actor.recoveryAttempts+=1; const goal=this.aiMissionGoal(actor); actor.path=this.findPath(actor.node.worldPosition,goal); actor.pathIndex=0;
      if (actor.recoveryAttempts>=2) { const valid=this.nearestFreePoint(actor.node.worldPosition,actor.aiZone==='subway'?this.subwayNavPoints:this.navPoints,actor); if (valid) actor.node.setWorldPosition(valid); actor.recoveryAttempts=0; }
    }
    for (const other of this.actors) if (other!==actor && other.alive && Vec3.distance(other.node.worldPosition,actor.node.worldPosition)<0.8) {
      const away=new Vec3(); Vec3.subtract(away,actor.node.worldPosition,other.node.worldPosition); if (away.lengthSqr()>0.001) { away.normalize().multiplyScalar(dt*1.2); this.moveActor(actor,away); }
    }
  }

  private tryAIJump(actor:Actor,desired:Vec3):void{
    if(!actor.grounded||actor.action.stance==='prone'||this.matchClock<actor.nextJumpAt||desired.lengthSqr()<0.0001)return;
    const direction=desired.clone().normalize(),position=actor.node.worldPosition,probeX=position.x+direction.x*0.9,probeZ=position.z+direction.z*0.9;
    const hurdle=this.obstacles.find(obstacle=>probeX+PLAYER_RADIUS>obstacle.minX&&probeX-PLAYER_RADIUS<obstacle.maxX&&probeZ+PLAYER_RADIUS>obstacle.minZ&&probeZ-PLAYER_RADIUS<obstacle.maxZ&&obstacle.maxY-position.y>0.25&&obstacle.maxY-position.y<=1.45);
    actor.nextJumpAt=this.matchClock+1.8+Math.random()*1.4;if(!hurdle)return;
    actor.verticalVelocity=6.1;actor.grounded=false;
  }

  private aiMissionGoal(actor:Actor):Vec3{
    if(this.selectedMission==='battle-royale'){
      const visible=this.actors.filter(candidate=>candidate.alive&&this.areOpponents(actor,candidate)).sort((a,b)=>Vec3.distance(actor.node.worldPosition,a.node.worldPosition)-Vec3.distance(actor.node.worldPosition,b.node.worldPosition))[0];
      if(visible)return visible.node.worldPosition.clone();
      const surface=this.navPoints.filter(point=>point.y>=-0.1);return (surface[([...actor.id].reduce((sum,char)=>sum+char.charCodeAt(0),0)+Math.floor(this.matchClock/8))%Math.max(1,surface.length)]||new Vec3()).clone();
    }
    if(this.selectedMission==='extraction-intercept'||this.selectedMission==='command-defense'){
      const targetTeam=this.selectedMission==='extraction-intercept'?oppositeTeam(this.missionOwner):this.missionOwner;
      const commander=this.actors.find(item=>item.id===this.teamCommanders[targetTeam]&&item.alive);if(commander){const goal=commander.node.worldPosition.clone();if(actor.team===targetTeam&&actor!==commander){const spread=[...actor.id].reduce((sum,char)=>sum+char.charCodeAt(0),0)%8;goal.x+=Math.cos(spread*Math.PI/4)*4;goal.z+=Math.sin(spread*Math.PI/4)*4;}return goal;}
    }
    const position=actor.node.worldPosition;
    // Do not let a spawn-side objective become a permanent home base. Early
    // in a round, send most surface AI through a central rally line first.
    if(actor.aiZone==='surface'&&Math.abs(position.x)>42){
      const rally=this.frontlineGoal(actor);if(rally)return rally;
    }
    const objective=this.bestObjective(actor.team,actor).position.clone();
    if(actor.aiZone==='surface'&&Math.abs(position.x)>54&&Math.abs(objective.x-position.x)<18){const rally=this.frontlineGoal(actor);if(rally)return rally;}
    return objective;
  }

  private frontlineGoal(actor:Actor):Vec3|null{
    const direction=actor.team==='blue'?1:-1,currentX=actor.node.worldPosition.x,targetX=clamp(currentX+direction*24,-42,42);
    const candidates=this.navPoints.filter(point=>point.y<1&&Math.abs(point.x-targetX)<9&&Math.abs(point.z-actor.node.worldPosition.z)<30&&!this.blocked(point.x,point.z,0.6,0));
    if(candidates.length===0)return null;
    const seed=[...actor.id].reduce((sum,char)=>sum+char.charCodeAt(0),0)+Math.floor(this.matchClock/6);
    return candidates[seed%candidates.length].clone();
  }

  private weaponMobility(actor:Actor):number{
    const base=handlingMobility(WEAPONS[actor.weaponId].weightKg),loadout=this.actorLoadout(actor);
    const stock=loadout.stock==='collapsible-stock'?1.025:loadout.stock==='folding-stock'?1.045:1;
    const barrel=loadout.barrel==='precision-barrel'?0.94:loadout.barrel==='heavy-barrel'?0.97:1;
    return clamp(base*stock*barrel,0.52,1.05);
  }

  private moveActor(actor: Actor, delta: Vec3): boolean {
    if (!actor.alive) return false; const p=actor.node.worldPosition.clone(),start=p.clone(); const nx=clamp(p.x+delta.x,-MAP_HALF+1,MAP_HALF-1); const nz=clamp(p.z+delta.z,-MAP_HALF+1,MAP_HALF-1);
    const height = PLAYER_HEIGHT[actor.action.stance];
    if (!this.blocked(nx,p.z,PLAYER_RADIUS,p.y,height)) p.x=nx; if (!this.blocked(p.x,nz,PLAYER_RADIUS,p.y,height)) p.z=nz;
    if(!actor.player){if(actor.aiZone==='subway')p.y=-4;else if(actor.grounded){const ground=this.groundHeightAt(p.x,p.z,p.y);if(ground<p.y-1.15){actor.grounded=false;actor.verticalVelocity=0;}else if(Math.abs(ground-p.y)<0.95||this.rampAt(p.x,p.z))p.y=ground;}}
    else if(actor.grounded){const ground=this.groundHeightAt(p.x,p.z,p.y);if(Math.abs(ground-p.y)<0.72||this.rampAt(p.x,p.z))p.y=ground;}
    actor.node.setWorldPosition(p);
    return Vec3.distance(start,p)>0.001;
  }

  private blocked(x: number,z: number,radius: number, feetY = 0, actorHeight = PLAYER_HEIGHT.stand): boolean {
    if (Math.abs(x)>MAP_HALF || Math.abs(z)>MAP_HALF) return true;
    return this.obstacles.some(o=>feetY+actorHeight>o.minY&&feetY<o.maxY&&x+radius>o.minX&&x-radius<o.maxX&&z+radius>o.minZ&&z-radius<o.maxZ);
  }

  private ladderAt(position: Vec3): LadderZone | null { return this.ladders.find(l=>position.x>l.centerX-1.9&&position.x<l.centerX+1.9&&position.z>l.centerZ-1.9&&position.z<l.centerZ+1.9&&position.y<l.top+0.6) || null; }
  private rampAt(x:number,z:number):RampZone|null{return this.ramps.find(r=>x>r.minX&&x<r.maxX&&z>r.minZ&&z<r.maxZ)||null;}
  private isSublevelFloor(x:number,z:number):boolean{return this.sublevelFloors.some(f=>x>f.minX&&x<f.maxX&&z>f.minZ&&z<f.maxZ);}
  private groundHeightAt(x: number, z: number, currentY: number): number {
    const ramp=this.rampAt(x,z);if(ramp){const t=clamp((z-ramp.fromZ)/(ramp.toZ-ramp.fromZ),0,1);return ramp.fromHeight+(ramp.toHeight-ramp.fromHeight)*t;}
    if(currentY<-1&&this.isSublevelFloor(x,z))return -4;
    let result = 0; for (const p of this.platforms) if (x>p.minX&&x<p.maxX&&z>p.minZ&&z<p.maxZ&&currentY>=p.height-1.5) result=Math.max(result,p.height); return result;
  }

  private resolveLandingPosition(position:Vec3,stance:'stand'|'crouch'|'prone'):Vec3{
    const offsets:Array<[number,number]>=[[0,0],[0.8,0],[-0.8,0],[0,0.8],[0,-0.8],[1.6,0],[-1.6,0],[0,1.6],[0,-1.6],[2.4,0],[-2.4,0],[0,2.4],[0,-2.4]];
    for(const [dx,dz] of offsets){const x=clamp(position.x+dx,-MAP_HALF+1,MAP_HALF-1),z=clamp(position.z+dz,-MAP_HALF+1,MAP_HALF-1),y=this.groundHeightAt(x,z,position.y);if(!this.blocked(x,z,PLAYER_RADIUS,y,PLAYER_HEIGHT[stance]))return new Vec3(x,y,z);}
    const navigation=(position.y>2.4?this.upperFloorNavPoints:this.navPoints).filter(point=>Vec3.distance(point,position)<16&&!this.blocked(point.x,point.z,PLAYER_RADIUS,point.y,PLAYER_HEIGHT[stance])).sort((a,b)=>Vec3.distance(a,position)-Vec3.distance(b,position))[0];
    return navigation?.clone()||new Vec3(clamp(position.x,-MAP_HALF+1,MAP_HALF-1),0,clamp(position.z,-MAP_HALF+1,MAP_HALF-1));
  }

  private findPath(start: Vec3,end: Vec3): Vec3[] {
    if(Math.abs(start.y-end.y)>1.5)return [];
    const level=start.y<-1?-4:0;
    const walkable=(x:number,z:number)=>level===0||this.isSublevelFloor(x,z);
    if (walkable(end.x,end.z)&&!this.segmentBlocked(start,end)) return [end.clone()];
    const step=6, half=14; const toCell=(p:Vec3)=>({x:clamp(Math.round(p.x/step),-half,half),z:clamp(Math.round(p.z/step),-half,half)});
    const s=toCell(start), goal=toCell(end), key=(x:number,z:number)=>`${x},${z}`; const open=[s]; const came=new Map<string,string>(); const g=new Map<string,number>([[key(s.x,s.z),0]]); const closed=new Set<string>();
    while(open.length){ open.sort((a,b)=>(g.get(key(a.x,a.z))||0)+Math.hypot(goal.x-a.x,goal.z-a.z)-(g.get(key(b.x,b.z))||0)-Math.hypot(goal.x-b.x,goal.z-b.z)); const cur=open.shift()!; const ck=key(cur.x,cur.z); if(closed.has(ck))continue; closed.add(ck); if(cur.x===goal.x&&cur.z===goal.z){ const out:Vec3[]=[]; let k=ck; while(k!==key(s.x,s.z)){const [x,z]=k.split(',').map(Number);out.unshift(new Vec3(x*step,level,z*step));k=came.get(k)!;} out.push(end.clone()); return out; }
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=cur.x+dx,nz=cur.z+dz,nk=key(nx,nz);const from=new Vec3(cur.x*step,level+1.2,cur.z*step),to=new Vec3(nx*step,level+1.2,nz*step);if(Math.abs(nx)>half||Math.abs(nz)>half||closed.has(nk)||!walkable(nx*step,nz*step)||this.blocked(nx*step,nz*step,0.55,level)||this.segmentBlocked(from,to))continue;const ng=(g.get(ck)||0)+1;if(ng<(g.get(nk)??Infinity)){g.set(nk,ng);came.set(nk,ck);open.push({x:nx,z:nz});}}
    }
    return [];
  }

  private fireActor(actor: Actor): boolean {
    if (this.phase!=='playing'||!actor.alive||actor.action.exclusive!=='idle') return false; const def=WEAPONS[actor.weaponId];
    if(actor.weapon.magazine<=0){if(actor.weapon.reserve>0)this.beginReload(actor);else if(actor.player&&this.notification!=='弹药耗尽')this.notify('弹药耗尽');return false;}
    if (!consumeShot(actor.weapon,def,this.matchClock)) return false; actor.protectedUntil=0;
    const loadout=this.actorLoadout(actor);
    const aiSpread=actor.player?1:clamp(1.35-actor.aiSkill*0.55,0.8,1.02);
    const spread=(actor.action.ads?def.adsSpreadDegrees:def.hipSpreadDegrees)*this.attachmentSpreadMultiplier(loadout)*aiSpread;
    const jitterYaw=(Math.random()-0.5)*spread, jitterPitch=(Math.random()-0.5)*spread; const aimYaw=actor.yaw+(actor.player?this.recoilYaw:0),aimPitch=actor.pitch+(actor.player?this.recoilPitch:0);const direction=this.direction(aimYaw+jitterYaw,aimPitch+jitterPitch);
    const origin=actor.player?this.cameraNode.worldPosition.clone():new Vec3(actor.node.worldPosition.x,actor.node.worldPosition.y+1.45,actor.node.worldPosition.z);
    const obstacleDistance=this.rayObstacleDistance(origin,direction,240);let best:Actor|null=null,bestVehicle:VehicleRuntime|null=null,bestDistance=obstacleDistance;
    for(const target of this.actors){if(!target.alive||!this.areOpponents(actor,target))continue;const center=new Vec3(target.node.worldPosition.x,target.node.worldPosition.y+1.15,target.node.worldPosition.z);const d=this.raySphere(origin,direction,center,0.75);if(d!==null&&d<bestDistance){best=target;bestDistance=d;}}
    for(const vehicle of this.vehicles){if(!vehicle.active||vehicle.occupant===actor)continue;const center=vehicle.node.worldPosition.clone();center.y+=0.62;const distance=this.raySphere(origin,direction,center,1.35);if(distance!==null&&distance<bestDistance){best=null;bestVehicle=vehicle;bestDistance=distance;}}
    const shotId=`${actor.id}-${actor.lifeId}-${this.shotSequence++}`;
    if(best){const hitY=origin.y+direction.y*bestDistance-best.node.worldPosition.y;const multiplier=hitY>1.55?2:hitY<0.65?0.75:1;if(this.gameMode==='single'||this.roomClient.isHost)this.damageActor(best,damageAtDistance(def,bestDistance,loadout.barrel!=='none')*multiplier,actor,shotId);if(actor.player){this.notify('命中');this.audio.playImpact('body');}}
    else if(bestVehicle){this.damageVehicle(bestVehicle,damageAtDistance(def,bestDistance,loadout.barrel!=='none')*0.72);if(actor.player){this.notify('命中载具');this.audio.playImpact('metal');}}
    else if(actor.player&&obstacleDistance<240)this.audio.playImpact('concrete');
    this.spawnMuzzle(actor); if(actor.player)this.audio.playWeapon(actor.weaponId,this.isIndoorPosition(actor.node.worldPosition));else this.audio.play(actor.weaponId,0.62);
    if(this.gameMode==='online'&&actor.player&&!this.roomClient.isHost)this.roomClient.sendFire(actor.weaponId);
    if(actor.player)this.addRecoil(actor,def,actor.action.ads);
    if(actor.weapon.magazine===0){if(actor.weapon.reserve>0)this.beginReload(actor);else if(actor.player)this.notify('弹药耗尽');}
    return true;
  }

  private damageActor(target: Actor, damage: number, attacker: Actor | null, eventId: string): void {
    if(!target.alive||this.phase!=='playing'||target.protectedUntil>this.matchClock||(attacker&&attacker!==target&&!this.areOpponents(attacker,target)))return;
    target.health=Math.max(0,target.health-damage); if(target.action.exclusive==='heal')target.action.cancel();
    if(target.health<=0)this.killActor(target,attacker,eventId);
  }

  private killActor(target: Actor, attacker: Actor | null, eventId: string): void {
    const deathId=`${target.id}-${target.lifeId}-${eventId}`; if(!this.deathEvents.accept(deathId)||!target.alive)return;
    target.alive=false;if(target.vehicle){target.vehicle.occupant=null;target.vehicle=null;}target.action.kill();target.action.ads=false;target.aiState='dead';target.target=null;target.path=[];target.combatWaypoint=null;target.verticalTarget=null;target.traversalLadder=null;target.lastSeenTarget=null;target.lastSeenAt=-Infinity;target.reactionReadyAt=Infinity;target.burstUntil=0;target.respawnAt=this.selectedMission==='battle-royale'?Infinity:this.matchClock+5;target.node.active=false;
    if(attacker&&attacker!==target&&this.areOpponents(attacker,target)){attacker.kills+=1;if(this.selectedMission!=='battle-royale'){this.teamKills[attacker.team]+=1;this.score[attacker.team]+=10;}if(attacker.player)this.notify('击杀 +20 金币');}
    if(target.player){this.releaseAllInputs();this.releasePointerLock();this.resetRecoil();this.adsTarget=false;this.currentFov=70;this.camera.fov=70;}
  }

  private respawnActor(actor: Actor): void {
    if(this.selectedMission==='battle-royale')return;
    if(!actor.player&&!actor.remoteHuman)actor.primaryWeaponId=this.pickAiWeapon(actor.team,actor.lifeId);
    actor.lifeId+=1;actor.health=actor.maxHealth;actor.alive=true;actor.action.respawn();actor.primaryWeapon=createWeaponRuntime(actor.primaryWeaponId);actor.sidearm=createWeaponRuntime('glock17');actor.pickedWeaponId=null;actor.pickedWeapon=null;actor.supplyWeaponId=null;actor.supplyWeapon=null;actor.vehicle=null;actor.activeSlot=1;actor.weaponId=actor.primaryWeaponId;actor.weapon=actor.primaryWeapon;actor.tacticalRole=this.aiRoleForWeapon(actor.primaryWeaponId,actor.lifeId);actor.grenades=this.missionGrenades(actor.team);actor.medkits=this.missionMedkits(actor.team);actor.target=null;actor.path=[];actor.combatWaypoint=null;actor.verticalTarget=null;actor.traversalLadder=null;actor.nextTraversalAt=this.matchClock+2+Math.random()*4;actor.nextJumpAt=this.matchClock+1;actor.lastSeenTarget=null;actor.lastSeenAt=-Infinity;actor.aiState='objective';actor.protectedUntil=this.matchClock+2;actor.triggerLatched=false;actor.verticalVelocity=0;actor.grounded=true;actor.parachuting=false;actor.reactionReadyAt=this.matchClock;actor.nextTacticAt=this.matchClock+1.2+Math.random()*1.4;actor.nextThink=this.matchClock+0.12;actor.nextGrenadeAt=this.matchClock+4+Math.random()*5;actor.nextHealAt=this.matchClock;actor.burstUntil=0;actor.stuckTime=0;actor.recoveryAttempts=0;actor.node.active=true;
    actor.node.setWorldPosition(this.selectSpawn(actor));actor.lastProgressPosition.set(actor.node.worldPosition);actor.visualLastPosition.set(actor.node.worldPosition);actor.walkPhase=0;if(actor.player){this.releaseAllInputs();this.resetRecoil();this.attachCamera();}
  }

  private selectSpawn(actor: Actor): Vec3 {
    if(this.selectedMission==='battle-royale'){
      const points=this.navPoints.filter(point=>point.y>=-0.1&&!this.blocked(point.x,point.z,PLAYER_RADIUS,0));const occupied=this.actors.filter(item=>item.alive&&item!==actor);
      const seed=([...actor.id].reduce((sum,char)=>sum+char.charCodeAt(0),0)+actor.lifeId+this.restartCount)%Math.max(1,points.length);
      if(occupied.length===0)return points[seed]?.clone()||new Vec3();
      const ranked=points.map((point,index)=>({point,distance:Math.min(...occupied.map(item=>Vec3.distance(item.node.worldPosition,point))),tie:(index+seed)%Math.max(1,points.length)})).sort((a,b)=>b.distance-a.distance||a.tie-b.tie);
      return ranked[0]?.point.clone()||new Vec3();
    }
    const side=actor.team==='blue'?-1:1;
    const centers=actor.aiZone==='subway'
      ?[-24,0,24].map(z=>new Vec3(side*64,-4,z))
      :[-48,0,48].map(z=>new Vec3(side*76,0,z));
    const seed=[...actor.id].reduce((sum,char)=>sum+char.charCodeAt(0),0)+actor.lifeId*13+this.restartCount*7;
    const order=[0,1,2].map(index=>(index+seed+Math.floor(Math.random()*3))%3);
    let best:Vec3|null=null,bestScore=-Infinity;
    const points=actor.aiZone==='subway'?this.subwayNavPoints:this.navPoints;
    for(const index of order){
      const center=centers[index],candidate=this.nearestFreePoint(center,points,actor);if(!candidate)continue;
      const enemies=this.actors.filter(item=>item.alive&&item.team!==actor.team).map(item=>Vec3.distance(item.node.worldPosition,candidate));
      const nearestEnemy=enemies.length?Math.min(...enemies):100;
      const occupancy=this.actors.filter(item=>item.alive&&item.team===actor.team&&Vec3.distance(item.node.worldPosition,candidate)<5).length;
      const score=nearestEnemy-occupancy*5+(index===seed%3?2:0)+Math.random()*1.5;
      if(score>bestScore){bestScore=score;best=candidate;}
    }
    const fallback=centers[seed%3];
    return best?.clone()||this.nearestFreePoint(fallback,points,actor)||fallback;
  }

  private updateCapturePoints(dt: number): void {
    for(const point of this.capturePoints){if(!point.ring.active)continue;const counts={blue:0,red:0};for(const actor of this.actors)if(actor.alive&&Math.abs(actor.node.worldPosition.y-point.position.y)<2&&Vec3.distance(actor.node.worldPosition,point.position)<4.2)counts[actor.team]+=1;
      if(counts.blue>0&&counts.red>0)continue;const team:Team|null=counts.blue>0?'blue':counts.red>0?'red':null;if(!team||point.owner===team)continue;if(point.progressTeam!==team){point.progressTeam=team;point.progress=0;}point.progress+=dt*Math.min(3,counts[team]);if(point.progress>=8){point.owner=team;point.progress=0;point.progressTeam=null;point.ring.getComponent(MeshRenderer)?.setMaterial(this.material(`owned-${team}`,team==='blue'?new Color(40,105,205):new Color(205,55,55),0.1,0.6),0);this.notify(`${team==='blue'?'蓝队':'红队'}占领 ${point.id}`);}}
    if(this.matchClock-this.lastObjectiveTick>=1){this.lastObjectiveTick=Math.floor(this.matchClock);for(const point of this.capturePoints)if(point.ring.active&&point.owner)this.score[point.owner]+=1;}
  }

  private updateMission(dt:number):void {
    if(this.phase!=='playing'||this.selectedMission==='conquest')return;const mission=MISSION_DEFINITIONS[this.selectedMission];const owner=this.missionOwner;
    if(this.selectedMission==='battle-royale'){const alive=this.actors.filter(actor=>actor.alive);if(alive.length<=1)this.endMatch();return;}
    if(this.selectedMission==='command-strike'){for(const team of ['blue','red'] as Team[]){const commander=this.actors.find(actor=>actor.id===this.teamCommanders[team]);if(commander&&!commander.alive){this.completeMission(oppositeTeam(team));return;}}return;}
    if(this.selectedMission==='command-defense'){const target=this.actors.find(actor=>actor.id===this.teamCommanders[owner]);if(target&&!target.alive){this.completeMission(oppositeTeam(owner));return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(owner);return;}
    if(this.selectedMission==='convoy-ambush'){for(const team of ['blue','red'] as Team[])if(this.teamKills[team]>=12){this.completeMission(team);return;}return;}
    if(this.selectedMission==='perimeter-sweep'){for(const team of ['blue','red'] as Team[])if(this.teamKills[team]>=14){this.completeMission(team);return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(this.teamKills.blue===this.teamKills.red?oppositeTeam(owner):this.teamKills.blue>this.teamKills.red?'blue':'red');return;}
    if(this.selectedMission==='airborne-assault'){if(this.teamKills[owner]>=10){this.completeMission(owner);return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(oppositeTeam(owner));return;}
    if(this.selectedMission==='extraction-intercept'){const target=this.actors.find(actor=>actor.id===this.teamCommanders[oppositeTeam(owner)]);if(target&&!target.alive){this.completeMission(owner);return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(oppositeTeam(owner));return;}
    if(this.selectedMission==='vip-escort'||this.selectedMission==='evacuation-cover'){const commander=this.actors.find(actor=>actor.id===this.teamCommanders[owner]),pointId=this.selectedMission==='vip-escort'?'D':'E',point=this.capturePoints.find(item=>item.id===pointId);if(commander&&!commander.alive){this.completeMission(oppositeTeam(owner));return;}if(commander&&point?.owner===owner&&Vec3.distance(commander.node.worldPosition,point.position)<6){this.completeMission(owner);return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(oppositeTeam(owner));return;}
    const captured=mission.objectiveIds.filter(id=>this.capturePoints.find(point=>point.id===id)?.owner===owner).length;
    if(this.selectedMission==='intel-recovery'){for(const team of ['blue','red'] as Team[]){const held=mission.objectiveIds.filter(id=>this.capturePoints.find(point=>point.id===id)?.owner===team).length;if(held===mission.objectiveIds.length){this.completeMission(team);return;}}return;}
    if(this.selectedMission==='encirclement'){this.missionProgress=captured===mission.objectiveIds.length?this.missionProgress+dt:Math.max(0,this.missionProgress-dt*0.5);if(this.missionProgress>=15){this.completeMission(owner);return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(oppositeTeam(owner));return;}
    if(this.selectedMission==='corridor-denial'){this.missionProgress=captured===mission.objectiveIds.length?this.missionProgress+dt:Math.max(0,this.missionProgress-dt);if(this.missionProgress>=20){this.completeMission(owner);return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(oppositeTeam(owner));return;}
    if(this.selectedMission==='cache-defense'){const attackers=oppositeTeam(owner),lost=mission.objectiveIds.filter(id=>this.capturePoints.find(point=>point.id===id)?.owner===attackers).length;if(lost===mission.objectiveIds.length){this.completeMission(attackers);return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(owner);return;}
    const assaultObjectives:MissionId[]=['sabotage-raid','hostage-rescue','bomb-defusal','arms-seizure','communications-raid','safehouse-raid','supply-line-disruption'];
    if(assaultObjectives.includes(this.selectedMission)){if(captured===mission.objectiveIds.length){this.completeMission(owner);return;}if(this.matchClock>=mission.durationSeconds)this.completeMission(oppositeTeam(owner));return;}
  }

  private completeMission(team:Team):void{if(this.phase!=='playing')return;this.score[team]+=1000;this.notify(`${team===this.playerTeam?'任务完成':'任务失败'} · ${MISSION_DEFINITIONS[this.selectedMission].title}`);this.endMatch();}

  private bestObjective(team: Team,actor?:Actor): CapturePoint {
    const zone=actor?.aiZone||'surface';let valid=this.capturePoints.filter(p=>(zone==='subway')===(p.position.y<-1));const missionIds=MISSION_DEFINITIONS[this.selectedMission].objectiveIds;if(this.selectedMission!=='conquest'&&missionIds.length){const focused=valid.filter(point=>missionIds.includes(point.id));if(focused.length)valid=focused;}
    if(valid.length===0)return this.capturePoints[0];
    const seed=actor?[...actor.id].reduce((sum,char)=>sum+char.charCodeAt(0),0):0;let best=valid[0],bestScore=-Infinity;
    for(let index=0;index<valid.length;index+=1){const point=valid[index];const distance=actor?Vec3.distance(actor.node.worldPosition,point.position):0;const teammates=this.actors.filter(a=>a.alive&&a.team===team&&a!==actor&&Vec3.distance(a.node.worldPosition,point.position)<10).length;const priority=point.owner===team?10:point.owner===null?58:78;const spread=((seed+index*13)%17)*0.9;const rear=this.selectedMission==='conquest'&&(team==='blue'?point.position.x<-40:point.position.x>40),rearGuard=seed%6===0,advanceBias=(team==='blue'?point.position.x:-point.position.x)*0.28;const rearPenalty=rear&&!rearGuard&&point.owner!==oppositeTeam(team)?62:0;const score=priority-distance*0.34-teammates*10+spread+advanceBias-rearPenalty;if(score>bestScore){best=point;bestScore=score;}}
    return best;
  }
  private nearestVisibleEnemy(actor: Actor,maxDistance:number): Actor|null {
    let result:Actor|null=null,bestScore=Infinity;
    for(const candidate of this.actors){
      if(!candidate.alive||!this.areOpponents(actor,candidate))continue;
      const distance=Vec3.distance(actor.node.worldPosition,candidate.node.worldPosition);
      if(distance>=maxDistance||this.segmentBlocked(actor.node.worldPosition,candidate.node.worldPosition))continue;
      const teamFocus=this.selectedMission==='battle-royale'?0:this.actors.filter(teammate=>teammate.alive&&teammate.team===actor.team&&teammate!==actor&&teammate.target===candidate).length;
      const injuredBias=(1-candidate.health/Math.max(1,candidate.maxHealth))*5;
      const priority=(candidate.player?6:0)+(candidate.isCommander?4:0);
      const score=distance+teamFocus*8-priority-injuredBias;
      if(score<bestScore){bestScore=score;result=candidate;}
    }
    return result;
  }
  private nearestFreePoint(position:Vec3,points:Vec3[],ignore?:Actor):Vec3|null{let best:Vec3|null=null,d=Infinity;for(const p of points){const pd=Vec3.distance(position,p);if(Math.abs(p.y-position.y)>2||pd>=d||this.blocked(p.x,p.z,0.6,p.y)||this.actors.some(a=>a!==ignore&&a.alive&&Vec3.distance(a.node.worldPosition,p)<1.2))continue;best=p;d=pd;}return best?.clone()||null;}

  private rayObstacleDistance(origin:Vec3,dir:Vec3,max:number):number{let best=max;for(const obstacle of this.obstacles){const distance=this.rayAabb3D(origin,dir,obstacle);if(distance!==null&&distance>=0&&distance<best)best=distance;}return best;}
  private rayAabb3D(origin:Vec3,direction:Vec3,bounds:Obstacle):number|null{
    let near=0,far=Infinity;
    const axes:Array<[number,number,number,number]>=[[origin.x,direction.x,bounds.minX,bounds.maxX],[origin.y,direction.y,bounds.minY,bounds.maxY],[origin.z,direction.z,bounds.minZ,bounds.maxZ]];
    for(const [value,delta,min,max] of axes){if(Math.abs(delta)<1e-7){if(value<min||value>max)return null;continue;}let a=(min-value)/delta,b=(max-value)/delta;if(a>b){const swap=a;a=b;b=swap;}near=Math.max(near,a);far=Math.min(far,b);if(far<near)return null;}
    return near;
  }
  private raySphere(o:Vec3,d:Vec3,c:Vec3,r:number):number|null{const oc=new Vec3();Vec3.subtract(oc,o,c);const b=Vec3.dot(oc,d),q=Vec3.dot(oc,oc)-r*r,disc=b*b-q;if(disc<0)return null;const t=-b-Math.sqrt(disc);return t>=0?t:null;}
  private segmentBlocked(a:Vec3,b:Vec3):boolean{const lineY=(y:number)=>y>0.2?y:y+1.2;const start=new Vec3(a.x,lineY(a.y),a.z),end=new Vec3(b.x,lineY(b.y),b.z);const d=new Vec3();Vec3.subtract(d,end,start);const length=d.length();if(length<0.001)return false;d.normalize();return this.rayObstacleDistance(start,d,length)<length-0.2;}
  private direction(yawDeg:number,pitchDeg:number):Vec3{const y=yawDeg*Math.PI/180,p=pitchDeg*Math.PI/180,cp=Math.cos(p);return new Vec3(-Math.sin(y)*cp,Math.sin(p),-Math.cos(y)*cp).normalize();}

  private previewGrenade(): void { const p=this.player;if(!p||p.grenades<=0||p.action.begin('throw')===null)return;this.setAds(false);this.showGrenadePreview(true);this.notify('松开投掷'); }
  private showGrenadePreview(active:boolean):void {
    if(!active||!this.player?.alive){for(const dot of this.grenadePreviewDots)dot.active=false;return;}
    while(this.grenadePreviewDots.length<12){const dot=this.box('TrajectoryDot',Vec3.ZERO,new Vec3(0.09,0.09,0.09),this.material('trajectory',new Color(242,210,82),0,0.4));this.grenadePreviewDots.push(dot);}
    const origin=this.cameraNode.worldPosition.clone(),velocity=this.direction(this.player.yaw,this.player.pitch).multiplyScalar(GRENADE_THROW_SPEED);velocity.y+=GRENADE_THROW_LIFT;
    for(let i=0;i<this.grenadePreviewDots.length;i++){const t=(i+1)*0.13;const p=new Vec3(origin.x+velocity.x*t,origin.y+velocity.y*t-4.9*t*t,origin.z+velocity.z*t);const floor=this.groundHeightAt(p.x,p.z,origin.y);const dot=this.grenadePreviewDots[i];dot.active=p.y>floor&&!this.blocked(p.x,p.z,0.08,p.y,0.12);if(dot.active)dot.setWorldPosition(p);}
  }
  private throwGrenade(actor:Actor|null=this.player): void { const p=actor;this.showGrenadePreview(false);if(!p||!p.alive||p.vehicle)return;if(p.grenades<=0){if(p.player)this.notify('手雷已用完');return;}if(p.player){this.adsTarget=false;p.action.ads=false;}if(p.action.exclusive!=='throw'){if(p.action.begin('throw')===null){if(p.player)this.notify('当前动作无法投雷');return;}}p.action.cancel();p.grenades=Math.max(0,p.grenades-1);if(p.player&&this.gameMode==='online'&&!this.roomClient.isHost){this.roomClient.sendUseItem('grenade');this.notify(`投出手雷 · 剩余 ${p.grenades}`);return;}let grenade=this.grenades.find(g=>!g.active);if(!grenade){const node=this.box('Grenade',Vec3.ZERO,new Vec3(0.22,0.22,0.22),this.material('grenade',new Color(44,62,42),0.3,0.6));grenade={id:'',node,active:false,exploded:false,owner:null,position:new Vec3(),velocity:new Vec3(),fuse:0};this.grenades.push(grenade);}grenade.id=`${p.id}-${p.lifeId}-g${this.shotSequence++}`;grenade.active=true;grenade.exploded=false;grenade.owner=p;const origin=p.player?this.cameraNode.worldPosition:new Vec3(p.node.worldPosition.x,p.node.worldPosition.y+1.4,p.node.worldPosition.z);grenade.position.set(origin);grenade.velocity.set(this.direction(p.yaw,p.pitch));grenade.velocity.multiplyScalar(GRENADE_THROW_SPEED);grenade.velocity.y+=GRENADE_THROW_LIFT;grenade.fuse=3.5;grenade.node.active=true;grenade.node.setWorldPosition(grenade.position);if(p.player)this.notify(`投出手雷 · 剩余 ${p.grenades}`);}
  private updateGrenades(dt:number):void{for(const g of this.grenades){if(!g.active)continue;g.fuse-=dt;g.velocity.y-=9.8*dt;const next=g.position.clone();Vec3.scaleAndAdd(next,next,g.velocity,dt);const floor=this.groundHeightAt(next.x,next.z,g.position.y);if(next.y<floor+0.18){next.y=floor+0.18;g.velocity.y=Math.abs(g.velocity.y)*0.32;g.velocity.x*=0.68;g.velocity.z*=0.68;}if(this.blocked(next.x,next.z,0.16,next.y-0.16,0.32)){g.velocity.x*=-0.42;g.velocity.z*=-0.42;}else g.position.set(next);g.node.setWorldPosition(g.position);if(g.fuse<=0)this.explode(g);if(Math.abs(g.position.x)>95||Math.abs(g.position.z)>95||g.position.y<-8)this.recycleGrenade(g);}}
  private explode(g:GrenadeRuntime):void{if(g.exploded||!g.active)return;g.exploded=true;for(const actor of this.actors){if(!actor.alive||!g.owner)continue;if(actor!==g.owner&&!this.areOpponents(g.owner,actor))continue;const distance=Vec3.distance(actor.node.worldPosition,g.position);const occluded=this.segmentBlocked(g.position,actor.node.worldPosition);const damage=radialDamage(100,7,distance,occluded);if(damage>0)this.damageActor(actor,damage,g.owner,`grenade-${this.shotSequence++}`);}for(const vehicle of this.vehicles){if(!vehicle.active)continue;const distance=Vec3.distance(vehicle.node.worldPosition,g.position);const damage=radialDamage(180,9,distance,this.segmentBlocked(g.position,vehicle.node.worldPosition));if(damage>0)this.damageVehicle(vehicle,damage);}this.spawnExplosion(g.position);this.audio.play('explosion');this.recycleGrenade(g);}
  private recycleGrenade(g:GrenadeRuntime):void{g.id='';g.active=false;g.owner=null;g.node.active=false;g.velocity.set(Vec3.ZERO);g.fuse=0;}

  private acquireFx(name:string,position:Vec3,scale:Vec3,material:Material,max:number,shape:'box'|'sphere'='box'):Node|null {
    let node=this.worldRoot.children.find(n=>n.name===name&&!n.active);
    const activeCount=this.worldRoot.children.filter(n=>n.name===name&&n.active).length;
    if(!node&&activeCount<max)node=shape==='sphere'?this.sphere(name,position,scale,material):this.box(name,position,scale,material);
    if(!node)return null;node.getComponent(MeshRenderer)?.setSharedMaterial(material,0);node.active=true;node.setWorldPosition(position);node.setScale(scale);node.setRotationFromEuler(0,0,0);return node;
  }
  private spawnMuzzle(actor:Actor):void {
    if (actor.player && actor.weaponId === 'zhongzheng-shi' && this.zhongzheng3D?.active) this.zhongzheng3DMuzzleFlashTime = 0.09;
    const base=actor.player?this.cameraNode.worldPosition:actor.node.worldPosition;
    const forward=this.direction(actor.yaw,actor.pitch),right=new Vec3(Math.cos(actor.yaw*Math.PI/180),0,-Math.sin(actor.yaw*Math.PI/180));
    const position=new Vec3(base.x,base.y+(actor.player?0:1.2),base.z);Vec3.scaleAndAdd(position,position,forward,actor.player?0.55:0.85);
    const shellPosition=position.clone();Vec3.scaleAndAdd(shellPosition,shellPosition,right,actor.player?0.24:0.16);shellPosition.y-=actor.player?0.1:0;
    const shell=this.acquireFx('ShellFx',shellPosition,new Vec3(0.04,0.04,0.11),this.material('shell',new Color(181,137,55),0.9,0.24),24);
    if(shell){const velocity=right.multiplyScalar(2.8+Math.random()*1.4);velocity.y=1.5+Math.random()*1.2;Vec3.scaleAndAdd(velocity,velocity,forward,-0.45);this.effects.push({node:shell,time:0.9,lifetime:0.9,velocity,spin:540+Math.random()*420});}
  }
  private spawnExplosion(position:Vec3):void {
    const flash=this.acquireFx('BlastFlash',position.clone(),new Vec3(0.7,0.7,0.7),this.material('explosion',new Color(255,126,36),0,0.32),6,'sphere');
    if(flash)this.effects.push({node:flash,time:0.2,lifetime:0.2});
    const smokeMaterials=[
      this.material('smokeDark',new Color(61,62,59),0,1),
      this.material('smokeMid',new Color(91,88,80),0,1),
      this.material('smokeDust',new Color(116,101,82),0,1),
    ];
    for(let i=0;i<12;i+=1){const angle=(i/12)*Math.PI*2+(Math.random()-0.5)*0.35;const radial=1.5+Math.random()*3.2;const origin=position.clone();origin.x+=Math.cos(angle)*Math.random()*0.45;origin.z+=Math.sin(angle)*Math.random()*0.45;origin.y+=0.18+Math.random()*0.45;const size=0.4+Math.random()*0.45;const puff=this.acquireFx('SmokePuff',origin,new Vec3(size,size*0.82,size),smokeMaterials[i%smokeMaterials.length],36,'sphere');if(!puff)continue;const life=2.2+Math.random()*1.2;this.effects.push({node:puff,time:life,lifetime:life,velocity:new Vec3(Math.cos(angle)*radial,1.1+Math.random()*2.1,Math.sin(angle)*radial),spin:(Math.random()-0.5)*90});}
  }
  private updateEffects(dt:number):void {
    for(let i=this.effects.length-1;i>=0;i--){const fx=this.effects[i];fx.time-=dt;
      if(fx.node.name==='BlastFlash'){const growth=fx.time>0.1?dt*18:-dt*10;fx.node.setScale(Math.max(0.05,fx.node.scale.x+growth),Math.max(0.05,fx.node.scale.y+growth),Math.max(0.05,fx.node.scale.z+growth));}
      if(fx.node.name==='SmokePuff'&&fx.velocity){const p=fx.node.worldPosition.clone();Vec3.scaleAndAdd(p,p,fx.velocity,dt);fx.node.setWorldPosition(p);fx.velocity.x*=Math.max(0,1-dt*1.7);fx.velocity.z*=Math.max(0,1-dt*1.7);fx.velocity.y=Math.max(0.18,fx.velocity.y-dt*0.55);const age=fx.lifetime-fx.time;const grow=age<0.65?dt*1.8:fx.time<0.55?-dt*1.4:dt*0.12;const s=fx.node.scale;fx.node.setScale(Math.max(0.04,s.x+grow),Math.max(0.04,s.y+grow*0.72),Math.max(0.04,s.z+grow));if(fx.spin)fx.node.setRotationFromEuler(0,age*fx.spin,0);}
      if(fx.node.name==='ShellFx'&&fx.velocity){const p=fx.node.worldPosition.clone();Vec3.scaleAndAdd(p,p,fx.velocity,dt);fx.velocity.y-=8.6*dt;const floor=this.groundHeightAt(p.x,p.z,p.y);if(p.y<floor+0.04){p.y=floor+0.04;fx.velocity.y=Math.abs(fx.velocity.y)*0.22;fx.velocity.x*=0.5;fx.velocity.z*=0.5;}fx.node.setWorldPosition(p);const age=fx.lifetime-fx.time;fx.node.setRotationFromEuler(age*(fx.spin||600),age*370,age*510);}
      if(fx.time<=0){fx.node.active=false;this.effects.splice(i,1);}
    }
  }

  private pressFire():void{if(!this.player?.alive)return;const started=typeof performance!=='undefined'?performance.now():0;this.fireHeld=true;const fired=this.player.vehicle?this.fireVehicleGun(this.player.vehicle,this.player):this.processTrigger(this.player);if(fired&&started)this.lastShotInputLatencyMs=Math.max(0,performance.now()-started);}
  private releaseFire():void{this.fireHeld=false;if(this.player)this.player.triggerLatched=false;}
  private setAds(value:boolean):void{const p=this.player;if(!p||!p.alive||p.vehicle||p.action.exclusive==='heal'||p.action.exclusive==='throw')return;this.adsTarget=value;p.action.ads=value;this.updateWeaponAppearance();this.updateScopeOverlay();}
  private updateAds(dt:number):void{
    const p=this.player;if(!p)return;
    const optic=opticForWeapon(p.weaponId,this.profileLoadout(p.weaponId).optic);
    const magnification=optic==='6x'?6:optic==='4x'?4:optic==='2x'?2:optic==='red-dot'?1.2:1;
    // Iron-sight ADS gets the requested natural zoom. Optical attachments may
    // continue to narrow the FOV, while the transition itself stays smooth.
    const adsFov=optic==='none'?50:Math.max(24,2*Math.atan(Math.tan(70*Math.PI/360)/magnification)*180/Math.PI);
    const target=this.adsTarget?adsFov:70;
    this.currentFov+=(target-this.currentFov)*Math.min(1,dt*12);this.camera.fov=this.currentFov;
    const crawling=p.action.stance==='prone'&&(this.keyState.has(KeyCode.KEY_W)||this.keyState.has(KeyCode.KEY_A)||this.keyState.has(KeyCode.KEY_S)||this.keyState.has(KeyCode.KEY_D));
    const crawlX=crawling?Math.sin(this.matchClock*7)*0.025:0,crawlY=crawling?Math.abs(Math.cos(this.matchClock*7))*0.014:0;
    const zhongzheng=p.weaponId==='zhongzheng-shi';
    // The dedicated rifle keeps a little right offset in ADS; only its sight
    // assembly enters the reticle, while the full stock remains out of view.
    const x=(this.adsTarget?(zhongzheng?0.06:0):0.34)+crawlX;
    const y=(this.adsTarget?(zhongzheng?-0.2:-0.24):-0.32)-crawlY;
    const z=(this.adsTarget?(zhongzheng?-0.72:-0.68):-0.72)+this.weaponKick;
    const pos=this.weaponView.position;const lerp=Math.min(1,dt*14);
    this.weaponView.setPosition(pos.x+(x-pos.x)*lerp,pos.y+(y-pos.y)*lerp,pos.z+(z-pos.z)*lerp);
    this.updateScopeOverlay();
  }
  private updateScopeOverlay():void {
    if(!this.scopeOverlay||!this.player){return;}
    const def=WEAPONS[this.player.weaponId],optic=opticForWeapon(this.player.weaponId,this.profileLoadout(this.player.weaponId).optic);
    const visible=this.adsTarget&&optic!=='none'&&def.category!=='pistol'&&this.phase==='playing'&&this.player.alive;
    this.scopeOverlay.active=visible;if(!visible)return;
    const radius=Math.min(this.viewWidth,this.viewHeight)*(optic==='6x'?0.23:optic==='4x'?0.3:optic==='2x'?0.4:0.32);const g=this.scopeGraphics;g.clear();
    g.fillColor=new Color(2,3,3,238);
    g.rect(-this.viewWidth/2,-this.viewHeight/2,this.viewWidth,this.viewHeight/2-radius);g.fill();
    g.rect(-this.viewWidth/2,radius,this.viewWidth,this.viewHeight/2-radius);g.fill();
    g.rect(-this.viewWidth/2,-radius,this.viewWidth/2-radius,radius*2);g.fill();
    g.rect(radius,-radius,this.viewWidth/2-radius,radius*2);g.fill();
    g.lineWidth=optic==='6x'?16:optic==='4x'?14:optic==='2x'?12:8;g.strokeColor=new Color(20,24,23,255);g.circle(0,0,radius);g.stroke();
    g.lineWidth=2;g.strokeColor=new Color(220,225,215,205);
    if(optic!=='red-dot'){g.moveTo(-radius*0.72,0);g.lineTo(-12,0);g.moveTo(12,0);g.lineTo(radius*0.72,0);g.moveTo(0,-radius*0.72);g.lineTo(0,-12);g.moveTo(0,12);g.lineTo(0,radius*0.72);g.stroke();if(optic==='4x'||optic==='6x'){g.strokeColor=new Color(220,70,48,230);g.circle(0,0,5);g.stroke();}}
    else {g.strokeColor=new Color(242,45,38,245);g.circle(0,0,4);g.stroke();g.fillColor=new Color(242,45,38,245);g.circle(0,0,2.5);g.fill();}
  }
  private updateWeaponAppearance():void{
    if(!this.player)return;
    const id=this.player.weaponId,def=WEAPONS[id],spec=WEAPON_VISUALS[id],loadout=this.profileLoadout(id);
    const optic=opticForWeapon(id,loadout.optic),hasOptic=optic!=='none'&&def.category!=='pistol',showParts=!this.adsTarget;
    const part=(name:string)=>this.weaponView.getChildByName(name);
    const zhongzheng=id==='zhongzheng-shi';
    const gunmetal=this.material(zhongzheng?'zhongzhengMetalFallback':'weaponMetal',zhongzheng?new Color(62,68,68):new Color(35,39,39),zhongzheng?0.62:0.94,zhongzheng?0.46:0.2),steel=this.material(zhongzheng?'zhongzhengSteelFallback':'weaponSteel',zhongzheng?new Color(126,132,128):new Color(74,77,74),zhongzheng?0.72:0.98,zhongzheng?0.3:0.14),polymer=this.material('weaponPolymer',new Color(20,23,22),0.16,0.68),wood=this.material(id==='type38'?'type38Wood':zhongzheng?'zhongzhengWoodFallback':'weaponWood',id==='type38'?new Color(112,70,38):zhongzheng?new Color(132,78,38):new Color(104,62,34),0.03,zhongzheng?0.86:0.68);
    const receiver=part('Receiver')!,upper=part('UpperReceiver')!,barrel=part('Barrel')!,handguard=part('Handguard')!,gas=part('GasTube')!,stock=part('Stock')!,stockPad=part('StockPad')!,magazine=part('Magazine')!,magazineLower=part('MagazineLower')!,boxMagazine=part('BoxMagazine')!;
    const barrelCenter=-(spec.receiver/2+spec.barrel/2-0.04),handguardCenter=-(spec.receiver/2+spec.handguard/2-0.08),stockCenter=spec.receiver/2+spec.stock/2-0.04;
    const viewScale=id==='type38'?0.92:id==='zhongzheng-shi'?0.96:1;this.weaponView.setScale(viewScale,viewScale,viewScale);
    receiver.active=true;receiver.setPosition(0,0,0);receiver.setScale(spec.width,spec.heavy?0.19:0.14,spec.receiver);receiver.getComponent(MeshRenderer)?.setSharedMaterial(gunmetal,0);
    upper.active=def.category!=='pistol';upper.setScale(spec.width*0.9,0.055,spec.receiver*0.78);upper.setPosition(0,spec.heavy?0.12:0.085,-0.02);upper.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
    barrel.active=true;barrel.setPosition(0,0.02,barrelCenter);barrel.setScale(spec.heavy?0.085:0.055,spec.heavy?0.085:0.055,spec.barrel);barrel.getComponent(MeshRenderer)?.setSharedMaterial(gunmetal,0);
    handguard.active=def.category!=='pistol';handguard.setPosition(0,-0.005,handguardCenter);handguard.setScale(spec.width*0.92,spec.heavy?0.15:0.12,spec.handguard);handguard.getComponent(MeshRenderer)?.setSharedMaterial(spec.wood?wood:polymer,0);
    gas.active=def.category!=='pistol';gas.setPosition(0,0.075,handguardCenter);gas.setScale(spec.heavy?0.075:0.06,0.05,spec.handguard*0.9);gas.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
    stock.active=def.category!=='pistol';stock.setPosition(0,-0.03,stockCenter);stock.setScale(spec.width*0.88,spec.heavy?0.19:0.15,spec.stock);stock.getComponent(MeshRenderer)?.setSharedMaterial(spec.wood?wood:polymer,0);
    stockPad.active=def.category!=='pistol';stockPad.setPosition(0,-0.03,stockCenter+spec.stock/2);stockPad.setScale(spec.width*0.96,spec.heavy?0.21:0.17,0.055);stockPad.getComponent(MeshRenderer)?.setSharedMaterial(polymer,0);
    const muzzle=part('MuzzleBrake')!;muzzle.setPosition(0,0.02,barrelCenter-spec.barrel/2-0.06);muzzle.setScale(spec.heavy?0.12:0.075,spec.heavy?0.12:0.075,spec.heavy?0.2:0.12);muzzle.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
    const pistolGrip=part('PistolGrip')!;pistolGrip.active=true;pistolGrip.setPosition(0,-0.16,spec.receiver*0.3);pistolGrip.setScale(def.category==='pistol'?0.1:0.105,def.category==='pistol'?0.3:0.24,0.13);pistolGrip.getComponent(MeshRenderer)?.setSharedMaterial(spec.wood?wood:polymer,0);
    magazine.active=spec.magazine!=='box';magazineLower.active=spec.magazine==='curved'||spec.magazine==='straight';boxMagazine.active=spec.magazine==='box';
    magazine.setPosition(0,-0.14,def.category==='pistol'?0.08:0.02);magazine.setScale(spec.magazine==='pistol'?0.075:spec.magazine==='straight'?0.11:0.12,spec.magazine==='pistol'?0.25:0.23,spec.magazine==='pistol'?0.1:0.16);magazine.setRotationFromEuler(0,0,0);magazine.getComponent(MeshRenderer)?.setSharedMaterial(spec.wood?wood:polymer,0);
    magazineLower.setPosition(0,-0.29,spec.magazine==='curved'?0.075:0.02);magazineLower.setScale(0.105,spec.magazine==='curved'?0.18:0.12,0.14);magazineLower.setRotationFromEuler(spec.magazine==='curved'?-14:0,0,0);magazineLower.getComponent(MeshRenderer)?.setSharedMaterial(spec.wood?wood:polymer,0);
    boxMagazine.setPosition(0,-0.15,0.01);boxMagazine.setScale(spec.width*1.25,0.25,spec.heavy?0.3:0.25);boxMagazine.getComponent(MeshRenderer)?.setSharedMaterial(polymer,0);
    const rail=part('TopRail')!;rail.active=def.category!=='pistol'&&(hasOptic||!spec.wood);rail.setPosition(0,spec.heavy?0.145:0.1,-0.02);rail.setScale(spec.width*0.72,0.025,spec.receiver*0.78);
    const carry=part('CarryHandle')!;carry.active=false;const showCarry=spec.carry&&showParts&&!hasOptic;for(const name of ['CarryHandleTop','CarryHandleFront','CarryHandleRear'])part(name)!.active=showCarry;part('CarryHandleTop')!.setScale(spec.width*0.55,0.04,spec.receiver*0.5);part('CarryHandleTop')!.setPosition(0,0.225,0);part('CarryHandleFront')!.setPosition(0,0.17,-spec.receiver*0.18);part('CarryHandleRear')!.setPosition(0,0.17,spec.receiver*0.18);
    const sidePanel=part('ReceiverSidePanel')!;sidePanel.active=showParts;sidePanel.setPosition(spec.width*0.56,0,-0.02);sidePanel.setScale(0.018,spec.heavy?0.14:0.1,spec.receiver*0.48);sidePanel.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
    const cheek=part('StockCheek')!;cheek.active=showParts&&(def.category==='sniper'||spec.heavy);cheek.setPosition(0,0.065,stockCenter);cheek.setScale(spec.width*0.8,0.07,spec.stock*0.7);cheek.getComponent(MeshRenderer)?.setSharedMaterial(spec.wood?wood:polymer,0);
    const magBase=part('MagazineBase')!;magBase.active=showParts&&spec.magazine!=='pistol';magBase.setPosition(0,spec.magazine==='box'?-0.29:-0.39,spec.magazine==='curved'?0.08:0.02);magBase.setScale(spec.magazine==='box'?spec.width*1.35:0.13,0.045,spec.magazine==='box'?0.3:0.16);
    for(let i=0;i<5;i+=1){const rib=part(`HandguardRib${i}`)!;rib.active=showParts&&def.category!=='pistol';const start=handguardCenter+spec.handguard*0.35,step=spec.handguard*0.17;rib.setPosition(0,-0.005,start-i*step);rib.setScale(spec.width*1.02,spec.heavy?0.17:0.135,0.018);rib.getComponent(MeshRenderer)?.setSharedMaterial(spec.wood?wood:steel,0);}
    for(const name of ['BipodLeft','BipodRight']){const node=part(name)!;node.active=spec.bipod&&showParts;node.setPosition(name==='BipodLeft'?-0.1:0.1,-0.16,barrelCenter);node.setScale(0.035,0.34,0.035);node.setRotationFromEuler(0,0,name==='BipodLeft'?-14:14);}
    const verticalGrip=part('VerticalGrip')!;verticalGrip.active=loadout.grip&&def.category!=='pistol'&&showParts;verticalGrip.setPosition(0,-0.17,handguardCenter);verticalGrip.getComponent(MeshRenderer)?.setSharedMaterial(polymer,0);
    const sleeve=part('BarrelSleeve')!;sleeve.active=loadout.barrel!=='none'&&showParts;sleeve.setPosition(0,0.02,barrelCenter-spec.barrel*0.18);sleeve.setScale(loadout.barrel==='heavy-barrel'?0.1:0.078,loadout.barrel==='heavy-barrel'?0.1:0.078,loadout.barrel==='precision-barrel'?spec.barrel*0.7:spec.barrel*0.48);
    const longScope=optic==='4x'||optic==='6x';this.opticView.active=hasOptic&&!longScope&&showParts;this.opticView.setPosition(0,0.15,-0.03);this.opticView.setScale(optic==='2x'?0.13:0.1,optic==='2x'?0.13:0.12,optic==='2x'?0.3:0.18);
    for(const name of ['ScopeTube','ScopeBell','ScopeEyepiece','ScopeMountFront','ScopeMountRear'])part(name)!.active=hasOptic&&longScope&&showParts;
    part('ScopeTube')!.setScale(optic==='6x'?0.14:0.12,optic==='6x'?0.14:0.12,optic==='6x'?0.54:0.43);part('ScopeBell')!.setScale(optic==='6x'?0.2:0.17,optic==='6x'?0.2:0.17,0.14);part('ScopeBell')!.setPosition(0,0.17,optic==='6x'?-0.31:-0.26);part('ScopeEyepiece')!.setPosition(0,0.17,optic==='6x'?0.29:0.23);
    const lens=part('OpticLens')!;lens.active=hasOptic&&showParts;lens.setPosition(0,longScope?0.17:0.15,longScope?(optic==='6x'?-0.385:-0.335):-0.13);lens.setScale(longScope?(optic==='6x'?0.17:0.145):0.085,longScope?(optic==='6x'?0.17:0.145):0.085,0.018);
    const rear=part('RearSight')!,front=part('FrontSight')!;rear.active=!hasOptic&&showParts&&def.category!=='pistol';front.active=!hasOptic&&showParts&&def.category!=='pistol';rear.setPosition(0,0.145,spec.receiver*0.3);front.setPosition(0,0.145,barrelCenter-spec.barrel*0.32);
    const ejection=part('EjectionPort')!;ejection.setPosition(spec.width*0.53,0.025,-0.02);ejection.setScale(0.012,0.07,spec.receiver*0.34);
    const bolt=part('Bolt')!;bolt.setPosition(spec.width*0.52,0.025,-0.01);bolt.setScale(0.015,0.06,spec.receiver*0.28);
    part('ChargingHandle')!.active=def.category!=='pistol';part('TriggerGuard')!.active=true;
    if(loadout.stock==='collapsible-stock'){stock.setScale(stock.scale.x*0.86,stock.scale.y*0.85,stock.scale.z*0.72);stockPad.setPosition(0,-0.03,stockCenter+spec.stock*0.35);}else if(loadout.stock==='folding-stock'){stock.setScale(stock.scale.x*0.55,stock.scale.y*0.65,stock.scale.z*0.38);stockPad.active=false;}
    if(loadout.barrel==='heavy-barrel')barrel.setScale(barrel.scale.x*1.2,barrel.scale.y*1.2,barrel.scale.z*1.06);else if(loadout.barrel==='precision-barrel')barrel.setScale(barrel.scale.x*0.92,barrel.scale.y*0.92,barrel.scale.z*1.16);
    const hand=part('LeftHand')!;hand.setPosition(-0.09,-0.12,handguardCenter);part('RightHand')!.setPosition(0.11,-0.14,spec.receiver*0.3);
    const detailed=showParts,boltFamily=['zhongzheng-shi','type38'].includes(id),compactFamily=['mp18','type100'].includes(id),lmgFamily=['zb26','type96-lmg'].includes(id),hmgFamily=['type24-hmg','type92-hmg'].includes(id),beltFed=spec.magazine==='box',sniper=def.category==='sniper',hmg=def.category==='hmg';
    barrel.active=false;gas.active=false;muzzle.active=false;
    const barrelTube=part('BarrelTube')!,gasTubeRound=part('GasTubeRound')!,muzzleTube=part('MuzzleTube')!;barrelTube.active=true;barrelTube.setPosition(0,0.02,barrelCenter);barrelTube.setScale(spec.heavy?0.085:0.055,spec.barrel,spec.heavy?0.085:0.055);barrelTube.getComponent(MeshRenderer)?.setSharedMaterial(gunmetal,0);gasTubeRound.active=def.category!=='pistol';gasTubeRound.setPosition(0,0.075,handguardCenter);gasTubeRound.setScale(spec.heavy?0.075:0.055,spec.handguard*0.9,spec.heavy?0.075:0.055);muzzleTube.active=true;muzzleTube.setPosition(0,0.02,barrelCenter-spec.barrel/2-0.06);muzzleTube.setScale(spec.heavy?0.12:0.075,spec.heavy?0.2:0.12,spec.heavy?0.12:0.075);
    const delta=part('DeltaRing')!;delta.active=false;delta.setPosition(0,0.01,handguardCenter+spec.handguard/2-0.035);delta.setScale(spec.width*1.02,0.075,spec.width*1.02);
    for(const name of ['Selector','MagRelease','ReceiverPinFront','ReceiverPinRear','BoltCatch','Trigger'])part(name)!.active=detailed;
    part('ForwardAssist')!.active=false;part('ForwardAssist')!.setPosition(spec.width*0.62,0.065,spec.receiver*0.22);part('Selector')!.setPosition(spec.width*0.62,-0.01,spec.receiver*0.25);part('MagRelease')!.setPosition(spec.width*0.62,-0.04,0);part('ReceiverPinFront')!.setPosition(spec.width*0.62,-0.015,-spec.receiver*0.3);part('ReceiverPinRear')!.setPosition(spec.width*0.62,-0.015,spec.receiver*0.3);part('BoltCatch')!.setPosition(spec.width*0.58,0.015,-spec.receiver*0.16);part('Trigger')!.setPosition(0,-0.145,spec.receiver*0.18);part('Trigger')!.setRotationFromEuler(-18,0,0);
    const heat=part('HeatShieldTop')!;heat.active=detailed&&(beltFed||hmg);heat.setPosition(0,spec.heavy?0.16:0.115,handguardCenter);heat.setScale(spec.width*0.9,0.028,spec.handguard*0.88);
    const railStart=spec.receiver*0.34;for(let i=0;i<12;i+=1){const tooth=part(`RailTooth${i}`)!;tooth.active=detailed&&def.category!=='pistol'&&!spec.wood;tooth.setPosition(0,spec.heavy?0.175:0.125,railStart-i*(spec.receiver*0.72/11));tooth.setScale(spec.width*0.82,0.024,0.018);}
    for(let i=0;i<8;i+=1)for(const side of [-1,1]){const vent=part(`Vent${side<0?'L':'R'}${i}`)!;vent.active=detailed&&def.category!=='pistol';vent.setPosition(side*spec.width*0.48,-0.005,handguardCenter+spec.handguard*0.36-i*(spec.handguard*0.72/7));vent.setScale(0.014,spec.heavy?0.065:0.046,Math.max(0.018,spec.handguard*0.055));}
    for(let i=0;i<6;i++){const rib=part(`GripRib${i}`)!;rib.active=detailed;rib.setPosition(0,-0.075-i*0.029,spec.receiver*0.3);rib.setScale(def.category==='pistol'?0.105:0.115,0.011,0.14);}
    for(const name of ['StockRodL','StockRodR']){const rod=part(name)!;rod.active=detailed&&!spec.wood&&!beltFed&&def.category!=='pistol';rod.setPosition(name.endsWith('L')?-spec.width*0.28:spec.width*0.28,-0.02,stockCenter);rod.setScale(0.022,0.022,spec.stock*0.92);}
    const slingFront=part('SlingLoopFront')!,slingRear=part('SlingLoopRear')!;slingFront.active=detailed&&def.category!=='pistol';slingRear.active=detailed&&def.category!=='pistol';slingFront.setPosition(-spec.width*0.55,-0.08,handguardCenter-spec.handguard*0.3);slingRear.setPosition(-spec.width*0.55,-0.08,stockCenter);
    for(const side of [-1,1]){const port=part(`MuzzlePort${side<0?'L':'R'}`)!;port.active=detailed;port.setPosition(side*(spec.heavy?0.065:0.041),0.02,barrelCenter-spec.barrel/2-0.065);}
    const feed=part('FeedCover')!;feed.active=detailed&&beltFed;feed.setPosition(0,spec.heavy?0.15:0.125,-0.02);feed.setScale(spec.width*1.2,0.07,spec.receiver*0.55);for(let i=0;i<6;i++){const link=part(`AmmoLink${i}`)!;link.active=detailed&&beltFed;link.setPosition(-spec.width*0.72-i*0.035,-0.055,-0.01+i*0.012);}
    const boltHandle=part('BoltHandle')!;boltHandle.active=detailed&&(sniper||boltFamily);boltHandle.setPosition(spec.width*0.72,0.04,spec.receiver*0.24);boltHandle.setScale(0.035,0.16,0.035);
    for(const name of ['SpadeGripL','SpadeGripR']){const spade=part(name)!;spade.active=detailed&&hmg;spade.setPosition(name.endsWith('L')?-spec.width*0.56:spec.width*0.56,-0.12,stockCenter);spade.setScale(0.08,0.24,0.12);}
    for(const name of ['FrontSightGuardL','FrontSightGuardR']){const guard=part(name)!;guard.active=detailed&&!hasOptic&&def.category!=='pistol';guard.setPosition(name.endsWith('L')?-0.045:0.045,0.14,barrelCenter-spec.barrel*0.32);}
    const customParts=['AKMagazineCurve','AKGasBlock','AKFrontSightBlock','AKStockAngle','M16CarryHandleDetail','M16TriangleHandguard','M16FrontPost','MP5CockingTube','MP5RetractStock','MP5MagazineCurve','RPKBipodMount','PKMFeedTray','SniperBoltBody','SniperCheekPiece','HMGReceiverTop'];
    for(const name of customParts)part(name)!.active=false;
    const customWood=wood;
    if(detailed&&lmgFamily){
      const curve=part('AKMagazineCurve')!;curve.active=spec.magazine==='curved';curve.setPosition(0,-0.2,0.045);curve.setScale(spec.width*0.95,0.34,0.18);curve.setRotationFromEuler(-14,0,0);curve.getComponent(MeshRenderer)?.setSharedMaterial(polymer,0);
      const gasBlock=part('AKGasBlock')!;gasBlock.active=true;gasBlock.setPosition(0,0.08,barrelCenter+spec.barrel*0.32);gasBlock.setScale(spec.width*0.8,0.12,0.12);gasBlock.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
      const frontBlock=part('AKFrontSightBlock')!;frontBlock.active=true;frontBlock.setPosition(0,0.14,barrelCenter-spec.barrel*0.34);frontBlock.setScale(spec.width*0.8,0.17,0.1);frontBlock.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
      const angle=part('AKStockAngle')!;angle.active=false;
    }
    if(detailed&&compactFamily){
      const tube=part('MP5CockingTube')!;tube.active=true;tube.setPosition(-spec.width*0.52,0.08,handguardCenter);tube.setScale(0.045,0.045,spec.handguard*1.22);tube.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
      const retract=part('MP5RetractStock')!;retract.active=true;retract.setPosition(0,-0.02,stockCenter);retract.setScale(0.04,0.04,spec.stock*1.12);retract.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
      const mp5Mag=part('MP5MagazineCurve')!;mp5Mag.active=false;
    }
    if(detailed&&boltFamily){
      const boltBody=part('SniperBoltBody')!;boltBody.active=true;boltBody.setPosition(spec.width*0.7,0.04,spec.receiver*0.24);boltBody.setScale(0.04,0.04,spec.receiver*0.46);boltBody.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);
      const cheekPiece=part('SniperCheekPiece')!;cheekPiece.active=false;
    }
    if(detailed&&lmgFamily){const bipod=part('RPKBipodMount')!;bipod.active=true;bipod.setPosition(0,-0.12,handguardCenter);bipod.setScale(spec.width*1.1,0.08,0.1);bipod.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);}
    if(detailed&&hmgFamily){const feedTray=part('PKMFeedTray')!;feedTray.active=true;feedTray.setPosition(0,0.16,-0.03);feedTray.setScale(spec.width*1.25,0.08,spec.receiver*0.6);feedTray.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);}
    if(detailed&&sniper){const boltBody=part('SniperBoltBody')!;boltBody.active=true;boltBody.setPosition(spec.width*0.7,0.04,spec.receiver*0.24);boltBody.setScale(0.04,0.04,spec.receiver*0.46);boltBody.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);const cheekPiece=part('SniperCheekPiece')!;cheekPiece.active=true;cheekPiece.setPosition(0,0.065,stockCenter);cheekPiece.setScale(spec.width*0.86,0.09,spec.stock*0.72);cheekPiece.getComponent(MeshRenderer)?.setSharedMaterial(spec.wood?customWood:polymer,0);}
    if(detailed&&hmg){const top=part('HMGReceiverTop')!;top.active=true;top.setPosition(0,0.17,-0.01);top.setScale(spec.width*1.15,0.1,spec.receiver*0.58);top.getComponent(MeshRenderer)?.setSharedMaterial(steel,0);}
    this.opticView.active=false;for(const name of ['ScopeTube','ScopeBell','ScopeEyepiece'])part(name)!.active=false;lens.active=false;
    const opticBodyRound=part('OpticBodyRound')!,scopeTubeRound=part('ScopeTubeRound')!,scopeBellRound=part('ScopeBellRound')!,scopeEyeRound=part('ScopeEyepieceRound')!,scopeTop=part('ScopeTurretTop')!,scopeSide=part('ScopeTurretSide')!,opticLensRound=part('OpticLensRound')!;
    opticBodyRound.active=hasOptic&&!longScope&&detailed;opticBodyRound.setPosition(0,0.15,-0.03);opticBodyRound.setScale(optic==='2x'?0.13:0.105,optic==='2x'?0.3:0.2,optic==='2x'?0.13:0.105);scopeTubeRound.active=hasOptic&&longScope&&detailed;scopeTubeRound.setScale(optic==='6x'?0.14:0.12,optic==='6x'?0.54:0.43,optic==='6x'?0.14:0.12);scopeBellRound.active=scopeTubeRound.active;scopeBellRound.setPosition(0,0.17,optic==='6x'?-0.31:-0.26);scopeBellRound.setScale(optic==='6x'?0.2:0.17,0.16,optic==='6x'?0.2:0.17);scopeEyeRound.active=scopeTubeRound.active;scopeEyeRound.setPosition(0,0.17,optic==='6x'?0.29:0.23);scopeEyeRound.setScale(optic==='6x'?0.16:0.145,0.14,optic==='6x'?0.16:0.145);scopeTop.active=scopeTubeRound.active;scopeSide.active=scopeTubeRound.active;opticLensRound.active=hasOptic&&detailed;opticLensRound.setPosition(0,longScope?0.17:0.15,longScope?(optic==='6x'?-0.395:-0.345):-0.145);opticLensRound.setScale(longScope?(optic==='6x'?0.17:0.145):0.085,0.018,longScope?(optic==='6x'?0.17:0.145):0.085);
    const useZhongzheng3D=zhongzheng&&this.player.alive&&!this.player.vehicle;
    if(this.zhongzheng3D)this.zhongzheng3D.active=useZhongzheng3D;
    for(const child of this.weaponView.children)if(child!==this.zhongzheng3D)child.active=!useZhongzheng3D;
    this.updateZhongzheng3DViewModel();
    this.resetReloadVisuals();this.updateScopeOverlay();
  }
  private resetReloadVisuals():void{
    if(!this.weaponView||!this.player)return;const spec=WEAPON_VISUALS[this.player.weaponId],part=(name:string)=>this.weaponView.getChildByName(name);
    this.weaponView.setRotationFromEuler(0,0,0);part('Magazine')?.setPosition(0,-0.14,WEAPONS[this.player.weaponId].category==='pistol'?0.08:0.02);part('MagazineLower')?.setPosition(0,-0.29,spec.magazine==='curved'?0.075:0.02);part('BoxMagazine')?.setPosition(0,-0.15,0.01);part('MagazineBase')?.setPosition(0,spec.magazine==='box'?-0.29:-0.39,spec.magazine==='curved'?0.08:0.02);part('LeftHand')?.setPosition(-0.09,-0.12,-(spec.receiver/2+spec.handguard/2-0.08));
    if(this.zhongzheng3D){this.zhongzheng3D.setPosition(0.08,-0.03,0);this.zhongzheng3D.setRotationFromEuler(-8,0,-9);this.zhongzheng3D.setScale(0.96,0.96,0.96);}
    for(const name of ['Stock','StockComb','ButtPad','Handguard','HandguardTip','Magazine','MagazineFloorplate','LeftHand','RightHand']){const node=this.zhongzheng3DParts.get(name);if(node)node.active=true;}
    this.zhongzheng3DMuzzleFlashTime=0;this.zhongzheng3DMuzzleFlash&&(this.zhongzheng3DMuzzleFlash.active=false);
  }
  private updateWeaponAnimations(dt:number):void{
    const p=this.player;if(!p?.alive||!p.weapon.reloading||this.reloadAnimationDuration<=0){if(this.reloadAnimationTime>0){this.reloadAnimationTime=0;this.reloadAnimationDuration=0;this.resetReloadVisuals();}return;}
    this.reloadAnimationTime=Math.min(this.reloadAnimationDuration,this.reloadAnimationTime+dt);const progress=this.reloadAnimationTime/this.reloadAnimationDuration;
    const pull=progress<0.28?progress/0.28:progress<0.58?1:Math.max(0,1-(progress-0.58)/0.3);const settle=Math.sin(Math.min(1,progress)*Math.PI),spec=WEAPON_VISUALS[p.weaponId];
    const customZhongzheng=p.weaponId==='zhongzheng-shi'&&Boolean(this.zhongzheng3D?.active);
    if(!customZhongzheng)this.weaponView.setRotationFromEuler(-settle*8,0,-settle*7);const magOffset=-0.48*pull;
    this.weaponView.getChildByName('Magazine')?.setPosition(0,-0.14+magOffset,WEAPONS[p.weaponId].category==='pistol'?0.08:0.02);
    this.weaponView.getChildByName('MagazineLower')?.setPosition(0,-0.29+magOffset,spec.magazine==='curved'?0.075:0.02);
    this.weaponView.getChildByName('BoxMagazine')?.setPosition(0,-0.15+magOffset,0.01);
    this.weaponView.getChildByName('MagazineBase')?.setPosition(0,(spec.magazine==='box'?-0.29:-0.39)+magOffset,spec.magazine==='curved'?0.08:0.02);
    const left=this.weaponView.getChildByName('LeftHand');if(left)left.setPosition(-0.09,-0.12-0.33*pull,-(spec.receiver/2+spec.handguard/2-0.08)+0.2*pull);
  }
  private addRecoil(actor:Actor,def:WeaponDefinition,ads:boolean):void{const category=def.category==='hmg'?1.45:def.category==='sniper'?1.3:def.category==='lmg'?1.22:def.category==='smg'?0.82:1;const stability=this.attachmentRecoilMultiplier(this.actorLoadout(actor))*(ads?0.68:1);const impulse=def.verticalRecoil*category*stability;this.recoilPitchVelocity+=impulse*7.2;this.recoilYawVelocity+=(Math.random()-0.5)*impulse*4.2;this.weaponKickVelocity+=impulse*0.55;}
  private updateRecoil(dt:number):void{const pitch=stepCriticalSpring(this.recoilPitch,this.recoilPitchVelocity,12,dt);this.recoilPitch=clamp(pitch.position,0,12);this.recoilPitchVelocity=this.recoilPitch===0&&pitch.velocity<0?0:pitch.velocity;const yaw=stepCriticalSpring(this.recoilYaw,this.recoilYawVelocity,14,dt);this.recoilYaw=clamp(yaw.position,-4,4);this.recoilYawVelocity=yaw.velocity;const kick=stepCriticalSpring(this.weaponKick,this.weaponKickVelocity,16,dt);this.weaponKick=clamp(kick.position,0,0.13);this.weaponKickVelocity=this.weaponKick===0&&kick.velocity<0?0:kick.velocity;}
  private resetRecoil():void{this.recoilPitch=0;this.recoilYaw=0;this.recoilPitchVelocity=0;this.recoilYawVelocity=0;this.weaponKick=0;this.weaponKickVelocity=0;this.reloadAnimationTime=0;this.reloadAnimationDuration=0;this.resetReloadVisuals();}
  private applyLook(dx:number,dy:number):void{const p=this.player;if(!p||!p.alive)return;const settings=this.profileStore.profile.settings,s=p.action.ads?settings.adsSensitivity:settings.lookSensitivity;p.yaw=(p.yaw-dx*s)%360;p.pitch=applyVerticalLook(p.pitch,dy,s,settings.invertVerticalLook);}
  private beginReload(actor:Actor|null=this.player):void{const p=actor;if(!p||!p.alive||p.vehicle)return;const definition=WEAPONS[p.weaponId];if(p.weapon.magazine>=definition.magazineSize)return;if(p.weapon.reserve<=0){if(p.player)this.notify('弹药耗尽');return;}const duration=this.reloadDuration(p,definition);if(p.player)this.setAds(false);const token=p.action.begin('reload');if(token===null)return;const runtime=p.weapon;runtime.reloading=true;if(p.player){this.reloadAnimationTime=0;this.reloadAnimationDuration=duration;this.audio.play('reload');if(this.gameMode==='online'&&!this.roomClient.isHost)this.roomClient.sendReload(p.weaponId);}this.scheduleOnce(()=>{if(p.action.complete(token)&&p.alive&&p.weapon===runtime){finishReload(runtime,definition);if(p.player){this.reloadAnimationTime=0;this.reloadAnimationDuration=0;this.resetReloadVisuals();this.notify('换弹完成');}}else runtime.reloading=false;},duration);}

  private selectNetworkWeapon(actor:Actor,weaponId:WeaponId):boolean{
    const airDropWeapon=this.selectedMission==='battle-royale'&&weaponId!==actor.primaryWeaponId&&['type38','zhongzheng-shi','type96-lmg','type92-hmg'].includes(weaponId);
    if(airDropWeapon&&weaponId!==actor.supplyWeaponId){actor.supplyWeaponId=weaponId;actor.supplyWeapon=createWeaponRuntime(weaponId);actor.supplyWeapon.reserve=this.pickupReserveFor(weaponId);}
    else if(!airDropWeapon&&weaponId!==actor.primaryWeaponId&&weaponId!=='glock17'&&weaponId!==actor.pickedWeaponId){
      // A remote player can only use a third-slot weapon after the host has
      // seen that weapon in the player's state; provision its fixed pickup ammo.
      actor.pickedWeaponId=weaponId;actor.pickedWeapon=createWeaponRuntime(weaponId);actor.pickedWeapon.reserve=this.pickupReserveFor(weaponId);
    }
    if(actor.weaponId!==weaponId){actor.weapon.reloading=false;actor.action.cancel();actor.weaponId=weaponId;actor.activeSlot=weaponId==='glock17'?2:weaponId===actor.primaryWeaponId?1:airDropWeapon?4:3;actor.weapon=actor.activeSlot===1?actor.primaryWeapon:actor.activeSlot===2?actor.sidearm:actor.activeSlot===4?actor.supplyWeapon!:actor.pickedWeapon!;}
    return true;
  }
  private beginHeal(actor:Actor|null=this.player):void{const p=actor;if(!p||!p.alive||p.vehicle||p.health>=p.maxHealth||p.medkits<=0){if(p?.player)this.notify(p.vehicle?'载具内无法治疗':p.health>=p.maxHealth?'生命值已满':'无法使用医疗包');return;}if(p.player)this.setAds(false);const token=p.action.begin('heal');if(token===null)return;if(p.player){this.notify('治疗中…');if(this.gameMode==='online'&&!this.roomClient.isHost)this.roomClient.sendUseItem('heal');}this.scheduleOnce(()=>{if(p.action.complete(token)&&p.alive){p.medkits=Math.max(0,p.medkits-1);p.health=Math.min(p.maxHealth,p.health+40);if(p.player)this.notify('恢复 40 生命');}},2);}
  private hasStandingRoom(position:Vec3):boolean{return !this.ceilings.some(c=>position.x>c.minX&&position.x<c.maxX&&position.z>c.minZ&&position.z<c.maxZ&&c.clearance<1.9);}
  private toggleCrouch():void{const p=this.player;if(!p?.alive)return;if(p.action.stance==='crouch'){if(!this.hasStandingRoom(p.node.worldPosition)){this.notify('头顶空间不足');return;}p.action.stance='stand';}else p.action.stance='crouch';}
  private toggleProne():void{const p=this.player;if(!p?.alive)return;if(p.action.stance==='prone'){if(!this.hasStandingRoom(p.node.worldPosition)){p.action.stance='crouch';this.notify('只能切换到蹲姿');return;}p.action.stance='stand';}else p.action.stance='prone';}
  private jump():void{const p=this.player;if(!p?.alive||!p.grounded||p.action.stance==='prone')return;p.verticalVelocity=6.6;p.grounded=false;}

  private setActorSlot(actor:Actor,slot:1|2|3|4):void{if(!actor.alive||actor.vehicle||actor.activeSlot===slot||(slot===3&&!actor.pickedWeapon)||(slot===4&&!actor.supplyWeapon))return;actor.weapon.reloading=false;actor.action.cancel();actor.activeSlot=slot;actor.weaponId=slot===1?actor.primaryWeaponId:slot===2?'glock17':slot===3?actor.pickedWeaponId!:actor.supplyWeaponId!;actor.weapon=slot===1?actor.primaryWeapon:slot===2?actor.sidearm:slot===3?actor.pickedWeapon!:actor.supplyWeapon!;actor.triggerLatched=false;}
  private switchWeapon(slot: 1 | 2 | 3 | 4): void { const p=this.player;if(!p?.alive||p.vehicle||p.activeSlot===slot||(slot===3&&!p.pickedWeapon)||(slot===4&&!p.supplyWeapon))return;this.setAds(false);this.resetRecoil();this.setActorSlot(p,slot);this.fireHeld=false;this.updateWeaponAppearance();this.notify(`切换 ${WEAPONS[p.weaponId].displayName}`);}

  private updateHud():void{
    const p=this.player,min=Math.floor(this.matchTime/60),sec=Math.floor(this.matchTime%60),mission=MISSION_DEFINITIONS[this.selectedMission],aliveCount=this.actors.filter(actor=>actor.alive).length,vehicle=p?.vehicle,slotText=`[1 主武器] [2 手枪] [3 地面武器] [4 空投武器]${p?` · 当前 ${p.activeSlot}`:''}`;this.hudLabels.get('score')!.string=this.selectedMission==='battle-royale'?`存活 ${aliveCount} / ${BATTLE_ROYALE_SIZE}  ·  击杀 ${p?.kills||0}`:`日军 ${this.score.blue}  —  ${this.score.red} 中国军队`;this.hudLabels.get('time')!.string=this.phase==='countdown'?'任务准备':`${min}:${sec.toString().padStart(2,'0')} · ${this.weather==='day'?'白昼':'夜战'}`;this.hudLabels.get('health')!.string=p?`生命 ${Math.ceil(p.health)} / ${p.maxHealth}${vehicle?` · 载具 ${Math.ceil(vehicle.health)}/520`:p.isCommander?' · 队长':''}`:'生命 0';this.hudLabels.get('ammo')!.string=vehicle?`${vehicle.gun.magazine} / 0 · 车载机枪`:p?`${p.weapon.magazine} / ${p.weapon.reserve}${p.weapon.reloading?' · 换弹中':''}`:'';this.hudLabels.get('items')!.string=p?`手雷 ${p.grenades}   ·   医疗包 ${p.medkits}`:'';this.hudLabels.get('slots')!.string=slotText;this.hudLabels.get('weapon')!.string=vehicle?'车载九二式重机枪 · V 离开':p?`${WEAPONS[p.weaponId].displayName}  ·  武器槽 ${p.activeSlot}`:'';
    if (this.webHudHealth) this.webHudHealth.textContent=p?`生命 ${Math.ceil(p.health)} / ${p.maxHealth}${vehicle?` · 载具 ${Math.ceil(vehicle.health)}/520`:p.isCommander?' · 队长':''}`:'生命 0';
    if (this.webHudWeapon) this.webHudWeapon.textContent=vehicle?'车载 M2HB · V 离开':p?`${WEAPONS[p.weaponId].displayName} · 武器槽 ${p.activeSlot}`:'';
    if (this.webHudAmmo) this.webHudAmmo.textContent=vehicle?`${vehicle.gun.magazine} / 0`:p?`${p.weapon.magazine} / ${p.weapon.reserve}${p.weapon.reloading?' · 换弹中':''}`:'0 / 0';
    if (this.webHudItems) this.webHudItems.textContent=p?`手雷 [G]  ${p.grenades}    医疗 [H]  ${p.medkits}`:'手雷 [G]  0    医疗 [H]  0';
    if(this.webHudSlots)this.webHudSlots.textContent=slotText;
    this.updateTacticalMap();
    let status=this.capturePoints.filter(c=>c.ring.active).map(c=>`${c.id}:${c.owner==='blue'?'蓝':c.owner==='red'?'红':'中立'}`).join('  ');
    if(this.selectedMission==='battle-royale')status=`存活 ${aliveCount} / ${BATTLE_ROYALE_SIZE} · 空投武器按 4 · 载具按 V`;
    else if(this.selectedMission==='convoy-ambush')status=`击杀竞赛 蓝 ${this.teamKills.blue}/12 · 红 ${this.teamKills.red}/12`;
    else if(this.selectedMission==='perimeter-sweep')status=`区域清剿 蓝 ${this.teamKills.blue}/14 · 红 ${this.teamKills.red}/14`;
    else if(this.selectedMission==='airborne-assault')status=`空降方击杀 ${this.teamKills[this.missionOwner]} / 10`;
    else if(this.selectedMission==='command-defense')status=`守卫要员 · 剩余 ${Math.ceil(this.matchTime)} 秒`;
    else if(this.selectedMission==='command-strike'){const blueAlive=this.actors.find(a=>a.id===this.teamCommanders.blue)?.alive!==false,redAlive=this.actors.find(a=>a.id===this.teamCommanders.red)?.alive!==false;status=`队长 蓝${blueAlive?'存活':'阵亡'} · 红${redAlive?'存活':'阵亡'}`;}
    else if(this.selectedMission==='extraction-intercept'){const target=this.actors.find(a=>a.id===this.teamCommanders[oppositeTeam(this.missionOwner)]);status=`蓝方要员 ${target?.alive!==false?'仍在撤离':'已被拦截'} · 剩余 ${Math.ceil(this.matchTime)} 秒`;}
    else if(this.selectedMission==='vip-escort'||this.selectedMission==='evacuation-cover'){const commander=this.actors.find(a=>a.id===this.teamCommanders[this.missionOwner]),point=this.capturePoints.find(c=>c.id===(this.selectedMission==='vip-escort'?'D':'E'));status=`要员${commander?.alive!==false?'存活':'阵亡'} · 距离撤离区 ${commander&&point?Math.round(Vec3.distance(commander.node.worldPosition,point.position)):'--'} 米`;}
    else if(this.selectedMission==='encirclement')status=`包围控制 ${Math.floor(this.missionProgress)} / 15 秒`;
    else if(this.selectedMission==='corridor-denial')status=`通道封锁 ${Math.floor(this.missionProgress)} / 20 秒 · ${status}`;
    else if(this.selectedMission==='cache-defense')status=`军火库状态 · ${status} · 坚守 ${Math.ceil(this.matchTime)} 秒`;
    else if(!status)status='战术任务进行中';
    this.hudLabels.get('objective')!.string=`${mission.title} · ${status} · ${mission.equipmentUse}`;
    this.hudLabels.get('message')!.string=this.notification;this.hudLabels.get('respawn')!.string=p&&!p.alive?(this.selectedMission==='battle-royale'?'已淘汰 · 等待最终结果':`${Math.max(0,Math.ceil(p.respawnAt-this.matchClock))} 秒后复活`):'';const grenadeLabel=this.hudActionLabels.get('grenade'),medkitLabel=this.hudActionLabels.get('medkit');if(grenadeLabel)grenadeLabel.string=`手雷 [G] · ${p?.grenades||0}`;if(medkitLabel)medkitLabel.string=`医疗 [H] · ${p?.medkits||0}`;
  }
  private notify(message:string):void{this.notification=message;this.notificationUntil=this.matchClock+1.8;if(this.hudLabels.get('message'))this.hudLabels.get('message')!.string=message;}

  private updateNetwork(dt:number):void{if(this.gameMode!=='online'||!this.roomClient.connected||this.phase!=='playing'||!this.player)return;this.networkStateClock+=dt;this.networkWorldClock+=dt;
    if(this.networkStateClock>=0.05){this.networkStateClock=0;const p=this.player;this.roomClient.sendPlayerState({position:[p.node.worldPosition.x,p.node.worldPosition.y,p.node.worldPosition.z],yaw:p.yaw,pitch:p.pitch,stance:p.action.stance,weaponId:p.weaponId,magazine:p.weapon.magazine,reserve:p.weapon.reserve,ads:p.action.ads,reloading:p.weapon.reloading,climbing:this.playerClimbingLadder,vehicleIndex:p.vehicle?this.vehicles.indexOf(p.vehicle):null,vehicleAmmo:p.vehicle?.gun.magazine||0});}
    if(this.roomClient.isHost&&this.networkWorldClock>=0.1){this.networkWorldClock=0;this.roomClient.sendWorld(this.buildWorldSnapshot());}}

  private applyRemotePlayerState(id:string,state:RemotePlayerState):void{const actor=this.networkActors.get(id);if(!actor||actor.player||!state||!Array.isArray(state.position))return;const x=clamp(Number(state.position[0])||0,-MAP_HALF+1,MAP_HALF-1),y=clamp(Number(state.position[1])||0,-4.2,20),z=clamp(Number(state.position[2])||0,-MAP_HALF+1,MAP_HALF-1);const vehicleIndex=Number.isInteger(state.vehicleIndex)?Number(state.vehicleIndex):-1,vehicle=vehicleIndex>=0?this.vehicles[vehicleIndex]:null;if(actor.vehicle&&actor.vehicle!==vehicle)actor.vehicle.occupant=null;actor.vehicle=vehicle?.active?vehicle:null;if(actor.vehicle){actor.vehicle.occupant=actor;actor.vehicle.node.setWorldPosition(x,0,z);actor.vehicle.yaw=Number(state.yaw)||0;actor.vehicle.node.setRotationFromEuler(0,actor.vehicle.yaw,0);actor.vehicle.gun.magazine=clamp(Math.floor(Number(state.vehicleAmmo)||0),0,600);actor.node.setWorldPosition(x,0,z);}else {const ladderValid=state.climbing===true&&Boolean(this.ladderAt(new Vec3(x,y,z)));if(ladderValid||this.isNetworkWalkable(x,y,z,actor.action.stance))actor.node.setWorldPosition(x,y,z);}actor.yaw=Number(state.yaw)||0;actor.pitch=clamp(Number(state.pitch)||0,-80,80);actor.node.setRotationFromEuler(0,actor.yaw,0);actor.action.ads=Boolean(state.ads);if(state.stance==='crouch'||state.stance==='prone'||state.stance==='stand')actor.action.stance=state.stance;
    this.selectNetworkWeapon(actor,state.weaponId);}

  private isNetworkWalkable(x:number,y:number,z:number,stance:'stand'|'crouch'|'prone'):boolean{
    if(this.blocked(x,z,PLAYER_RADIUS,y,PLAYER_HEIGHT[stance]))return false;
    const floor=this.groundHeightAt(x,z,y);return Math.abs(y-floor)<0.9||Boolean(this.ladderAt(new Vec3(x,y,z)))||Boolean(this.rampAt(x,z));
  }

  private buildWorldSnapshot():WorldSnapshot{return{matchTime:this.matchTime,score:{...this.score},actors:this.actors.map(actor=>({id:actor.id,position:[actor.node.worldPosition.x,actor.node.worldPosition.y,actor.node.worldPosition.z],yaw:actor.yaw,pitch:actor.pitch,stance:actor.action.stance,weaponId:actor.weaponId,magazine:actor.weapon.magazine,reserve:actor.weapon.reserve,ads:actor.action.ads,reloading:actor.weapon.reloading,climbing:actor.player?this.playerClimbingLadder:Boolean(actor.traversalLadder),health:actor.health,alive:actor.alive,grenades:actor.grenades,medkits:actor.medkits})),objectives:this.capturePoints.map(point=>({id:point.id,owner:point.owner,progress:point.progress})),grenades:this.grenades.filter(grenade=>grenade.active&&grenade.owner).map(grenade=>({id:grenade.id,ownerId:grenade.owner!.id,position:[grenade.position.x,grenade.position.y,grenade.position.z],fuse:grenade.fuse})),vehicles:this.vehicles.map(vehicle=>({position:[vehicle.node.worldPosition.x,vehicle.node.worldPosition.y,vehicle.node.worldPosition.z],yaw:vehicle.yaw,health:vehicle.health,magazine:vehicle.gun.magazine,active:vehicle.active,occupantId:vehicle.occupant?.id||null}))};}

  private applyWorldSnapshot(snapshot:WorldSnapshot):void{
    if(!snapshot||!Array.isArray(snapshot.actors))return;
    this.matchTime=Math.max(0,Number(snapshot.matchTime)||0);this.score.blue=Math.max(0,Math.floor(snapshot.score?.blue||0));this.score.red=Math.max(0,Math.floor(snapshot.score?.red||0));
    for(const state of snapshot.actors){
      const actor=this.actors.find(item=>item.id===state.id);if(!actor)continue;
      const wasAlive=actor.alive,previousHealth=actor.health;
      actor.health=clamp(Number(state.health)||0,0,160);actor.maxHealth=Math.max(actor.maxHealth,actor.health>100?150:100);actor.alive=Boolean(state.alive);actor.grenades=clamp(Math.floor(Number(state.grenades)||0),0,8);actor.medkits=clamp(Math.floor(Number(state.medkits)||0),0,5);actor.node.active=actor.alive;
      if(actor.player){
        if(actor.health<previousHealth&&actor.action.exclusive==='heal')actor.action.cancel();
        if(wasAlive&&!actor.alive){actor.action.kill();this.releaseAllInputs();this.releasePointerLock();this.resetRecoil();}
        if(!wasAlive&&actor.alive){actor.action.respawn();actor.primaryWeapon=createWeaponRuntime(actor.primaryWeaponId);actor.sidearm=createWeaponRuntime('glock17');actor.pickedWeaponId=null;actor.pickedWeapon=null;actor.supplyWeaponId=null;actor.supplyWeapon=null;actor.vehicle=null;actor.activeSlot=1;actor.weaponId=actor.primaryWeaponId;actor.weapon=actor.primaryWeapon;this.resetRecoil();actor.node.setWorldPosition(...state.position);this.attachCamera();}
        if(Vec3.distance(actor.node.worldPosition,new Vec3(...state.position))>4)actor.node.setWorldPosition(...state.position);
        actor.action.stance=state.stance;
        continue;
      }
      const remotePosition=new Vec3(...state.position);if(state.climbing||this.isNetworkWalkable(remotePosition.x,remotePosition.y,remotePosition.z,state.stance))actor.node.setWorldPosition(remotePosition);else actor.node.setWorldPosition(this.resolveLandingPosition(remotePosition,state.stance));actor.yaw=state.yaw;actor.pitch=state.pitch;actor.node.setRotationFromEuler(0,actor.yaw,0);actor.action.stance=state.stance;this.selectNetworkWeapon(actor,state.weaponId);actor.weapon.magazine=clamp(Math.floor(Number(state.magazine)||0),0,WEAPONS[actor.weaponId].magazineSize);actor.weapon.reserve=clamp(Math.floor(Number(state.reserve)||0),0,WEAPONS[actor.weaponId].reserveAmmo);actor.weapon.reloading=Boolean(state.reloading);
    }
    for(const state of snapshot.objectives||[]){const point=this.capturePoints.find(item=>item.id===state.id);if(!point)continue;point.owner=state.owner;point.progress=state.progress;point.ring.getComponent(MeshRenderer)?.setMaterial(state.owner?this.material(`owned-${state.owner}`,state.owner==='blue'?new Color(40,105,205):new Color(205,55,55),0.1,0.6):this.material(`point-${point.id}`,new Color(225,190,55),0.15,0.5),0);}
    this.applyGrenadeSnapshot(snapshot.grenades||[]);for(let index=0;index<Math.min(this.vehicles.length,snapshot.vehicles?.length||0);index+=1){const state=snapshot.vehicles![index],vehicle=this.vehicles[index];vehicle.active=state.active;vehicle.health=state.health;vehicle.gun.magazine=state.magazine;vehicle.yaw=state.yaw;vehicle.node.active=state.active;vehicle.node.setWorldPosition(...state.position);vehicle.node.setRotationFromEuler(0,state.yaw,0);vehicle.occupant=this.actors.find(actor=>actor.id===state.occupantId)||null;if(vehicle.occupant)vehicle.occupant.vehicle=vehicle;}}

  private applyGrenadeSnapshot(states: NonNullable<WorldSnapshot['grenades']>): void {
    const incoming = new Set(states.map(state => state.id));
    for (const grenade of this.grenades) {
      if (grenade.active && !incoming.has(grenade.id)) {
        this.spawnExplosion(grenade.position);
        this.audio.play('explosion');
        this.recycleGrenade(grenade);
      }
    }
    for (const state of states) {
      let grenade = this.grenades.find(item => item.active && item.id === state.id);
      if (!grenade) grenade = this.grenades.find(item => !item.active);
      if (!grenade) {
        const node=this.box('Grenade',Vec3.ZERO,new Vec3(0.22,0.22,0.22),this.material('grenade',new Color(44,62,42),0.3,0.6));
        grenade={id:'',node,active:false,exploded:false,owner:null,position:new Vec3(),velocity:new Vec3(),fuse:0};
        this.grenades.push(grenade);
      }
      grenade.id=state.id;grenade.active=true;grenade.exploded=false;grenade.owner=this.actors.find(actor=>actor.id===state.ownerId)||null;
      grenade.position.set(clamp(Number(state.position[0])||0,-95,95),clamp(Number(state.position[1])||0,-8,30),clamp(Number(state.position[2])||0,-95,95));
      grenade.velocity.set(Vec3.ZERO);grenade.fuse=Math.max(0,Number(state.fuse)||0);grenade.node.active=true;grenade.node.setWorldPosition(grenade.position);
    }
  }

  private endMatch():void{if(this.phase==='ended')return;this.phase='ended';this.paused=false;this.cursorMode=false;this.setHudVisible(false);this.releaseAllInputs();this.releasePointerLock();this.resetRecoil();this.destroyLayer(this.pauseLayer);this.pauseLayer=null;this.audio.stopAll();if(this.gameMode==='online'&&this.roomClient.isHost)this.roomClient.finishMatch();for(const a of this.actors){a.action.ads=false;a.target=null;a.path=[];a.combatWaypoint=null;a.lastSeenTarget=null;a.lastSeenAt=-Infinity;a.burstUntil=0;a.aiState=a.alive?'patrol':'dead';}
    const battleRoyale=this.selectedMission==='battle-royale',survivors=this.actors.filter(actor=>actor.alive),ranked=[...this.actors].sort((a,b)=>(Number(b.alive)-Number(a.alive))||(b.kills-a.kills)),winner=survivors.length===1?survivors[0]:ranked[0],won=battleRoyale?winner===this.player:this.score[this.playerTeam]>this.score[oppositeTeam(this.playerTeam)];let awarded=0,xpAwarded=0,levels=0;if(!this.profileStore.profile.settledMatchIds.includes(this.matchId)){const reward={kills:this.player?.kills||0,completed:true,won};awarded=rewardCoins(reward);xpAwarded=rewardExperience(reward);this.profileStore.profile.coins+=awarded;const progress=applyExperience(this.profileStore.profile,xpAwarded);awarded+=progress.coinReward;levels=progress.levels;this.profileStore.profile.settledMatchIds.push(this.matchId);this.profileStore.save();}
    this.resultLayer=this.panel('Result',new Color(7,10,12,230));this.makeText(won?'胜利':battleRoyale?'已淘汰':this.score.blue===this.score.red?'平局':'战败',new Vec3(0,230),72,this.resultLayer,won?new Color(95,210,125):new Color(220,100,88));this.makeText(battleRoyale?`最后幸存者：${winner?.player?'玩家':winner?.id||'无'} · 存活 ${survivors.length}`:`蓝队 ${this.score.blue}  —  ${this.score.red} 红队`,new Vec3(0,135),38,this.resultLayer,Color.WHITE);this.makeText(`击杀 ${this.player?.kills||0}   金币 +${awarded}   经验 +${xpAwarded}`,new Vec3(0,65),28,this.resultLayer,new Color(235,199,75));if(levels>0)this.makeText(`升级！当前等级 ${this.profileStore.profile.level}`,new Vec3(0,15),27,this.resultLayer,new Color(105,210,150));
    const restartLabel=this.gameMode==='online'&&!this.roomClient.isHost?'等待房主重开':'重新开始';
    this.makeButton(restartLabel,new Vec3(-170,-100),new Vec2(300,78),new Color(52,112,75),()=>{if(this.gameMode==='online'){if(this.roomClient.isHost){if(battleRoyale)this.roomClient.startMatch(this.randomMap(),'battle-royale','blue');else this.startRandomOnlineMatch();}else this.notify('等待房主重新开始');}else if(battleRoyale)this.startBattleRoyale();else this.startMatch();});
    this.makeButton('返回菜单',new Vec3(170,-100),new Vec2(300,78),new Color(76,67,58),()=>{if(this.gameMode==='online')this.roomClient.leave();this.clearMatch();this.destroyLayer(this.resultLayer);this.resultLayer=null;this.showMainMenu();});}
  private applyQuality():void{const q=this.profileStore.profile.settings.quality;this.camera.far=q==='low'?105:q==='medium'?150:180;if(this.mainLight)this.mainLight.shadowEnabled=q==='high';const fog=this.sceneRoot?.scene?.globals.fog;if(fog){fog.enabled=q!=='low';fog.fogStart=q==='medium'?58:68;fog.fogEnd=q==='medium'?150:178;}}

  private installTestBridge(): void {
    (globalThis as any).__FPS_GAME__ = {
      state: () => ({
        phase: this.phase, matchTime: this.matchTime, score: { ...this.score }, actorCount: this.actors.length,
        coins:this.profileStore.profile.coins,level:this.profileStore.profile.level,xp:this.profileStore.profile.xp,
        paused: this.paused, lifecyclePaused: this.lifecyclePaused, cursorMode: this.cursorMode, pointerLocked: this.isPointerLocked(),
        gameMode: this.gameMode, roomCode: this.roomClient.code, roomPlayers: this.roomClient.players.length, isHost: this.roomClient.isHost,
        aliveActors: this.actors.filter(a => a.alive).length, activeGrenades: this.grenades.filter(g => g.active).length,
        activeEffects: this.effects.length,activeShellCount:this.effects.filter(effect=>effect.node.name==='ShellFx'&&effect.node.active).length,activeMuzzleFlashCount:this.effects.filter(effect=>effect.node.name==='MuzzleFx'&&effect.node.active).length, playerHealth: this.player?.health ?? 0, map: this.selectedMap,weather:this.weather,mission:this.selectedMission,missionOwner:this.missionOwner,missionProgress:this.missionProgress,missionBriefingVisible:this.missionLayer?.active||false,
        capturePointCount: this.capturePoints.length,activeObjectiveCount:this.capturePoints.filter(point=>point.ring.active).length, obstacleCount: this.obstacles.length, ladderCount: this.ladders.length,naturalCoverCount:this.obstacles.filter(obstacle=>obstacle.name.startsWith('Natural')||obstacle.name==='FallenLog'||obstacle.name==='RubbleMound'||obstacle.name==='DryShrubCover').length,upperFloorCount:this.obstacles.filter(obstacle=>obstacle.name.startsWith('UpperFloor')).length,mapCount:MAP_IDS.length,missionCount:Object.keys(MISSION_DEFINITIONS).length,worldVisualCount:this.worldRoot?.children.length||0,weaponPartCount:this.weaponView?.children.length||0,characterPartCount:this.actors.find(actor=>!actor.player)?.node.children.length||0,reloadAnimationTime:this.reloadAnimationTime,
        subwayNavPointCount:this.subwayNavPoints.length,upperFloorNavPointCount:this.upperFloorNavPoints.length,subwayActorCount:this.actors.filter(a=>a.aiZone==='subway').length,aiUpperFloorCount:this.actors.filter(a=>a.alive&&!a.player&&a.node.worldPosition.y>2.4).length,aiJumpingCount:this.actors.filter(a=>a.alive&&!a.player&&!a.grounded).length,
        smokePuffCount:this.worldRoot.children.filter(n=>n.name==='SmokePuff'&&n.active).length,scopeVisible:this.scopeOverlay?.active||false,
        weaponId: this.player?.weaponId ?? null, activeSlot: this.player?.activeSlot ?? null,pickedWeaponId:this.player?.pickedWeaponId??null,supplyWeaponId:this.player?.supplyWeaponId??null,
        activePickups:this.worldPickups.filter(pickup=>pickup.active).length,pickups:this.worldPickups.filter(pickup=>pickup.active).map(pickup=>({kind:pickup.kind,weaponId:pickup.weaponId,position:[pickup.node.worldPosition.x,pickup.node.worldPosition.y,pickup.node.worldPosition.z]})),
        yaw: this.player?.yaw ?? 0, pitch: this.player?.pitch ?? 0,
        recoilPitch: this.recoilPitch, recoilYaw: this.recoilYaw, weaponKick: this.weaponKick,
        invertVerticalLook: this.profileStore.profile.settings.invertVerticalLook,
        grenades: this.player?.grenades ?? 0, medkits: this.player?.medkits ?? 0, stance: this.player?.action.stance ?? 'stand',parachuting:this.player?.parachuting||false,
        ads: this.player?.action.ads ?? false, fov: this.camera?.fov ?? 0, optic:this.player?opticForWeapon(this.player.weaponId,this.profileStore.profile.loadouts[this.player.weaponId].optic):'none', firstShotLatencyMs: this.lastShotInputLatencyMs,
        playerVisuals: this.player?.node.children.map(n => ({ name: n.name, active: n.active, scale: [n.scale.x,n.scale.y,n.scale.z] })) ?? [],
        factionVisuals:{blue:this.actors.find(actor=>actor.team==='blue'&&!actor.player)?.node.children.filter(node=>node.active).map(node=>node.name)??[],red:this.actors.find(actor=>actor.team==='red'&&!actor.player)?.node.children.filter(node=>node.active).map(node=>node.name)??[]},
        weaponVisuals:this.weaponView?[...this.weaponView.children.map(n=>({name:n.name,active:n.active,position:[n.position.x,n.position.y,n.position.z]})),...([...this.zhongzheng3DParts.entries()].map(([name,node])=>({name:`Zhongzheng3D:${name}`,active:node.active,position:[node.position.x,node.position.y,node.position.z]})))] : [],
        zhongzhengViewModel:this.zhongzheng3D?{active:this.zhongzheng3D.active,ads:Boolean(this.adsTarget),parts:[...this.zhongzheng3DParts.entries()].filter(([,node])=>node.active).map(([name])=>name),muzzleFlash:Boolean(this.zhongzheng3DMuzzleFlash?.active)}:null,
        playerPosition: this.player ? [this.player.node.worldPosition.x,this.player.node.worldPosition.y,this.player.node.worldPosition.z] : null,
        actorPositions: this.actors.map(a => ({ id:a.id, active:a.node.active, position:[a.node.worldPosition.x,a.node.worldPosition.y,a.node.worldPosition.z] })),
        actors:this.actors.map(a=>({id:a.id,team:a.team,player:a.player,remoteHuman:a.remoteHuman,health:a.health,maxHealth:a.maxHealth,isCommander:a.isCommander,alive:a.alive,weaponId:a.weaponId,magazine:a.weapon.magazine,grenades:a.grenades,medkits:a.medkits,aiSkill:a.aiSkill,tacticalRole:a.tacticalRole,aiState:a.aiState,reactionReadyAt:a.reactionReadyAt,hasCombatWaypoint:Boolean(a.combatWaypoint),verticalTarget:Boolean(a.verticalTarget),traversalLadder:Boolean(a.traversalLadder),jumping:!a.grounded})),
        ammo: this.player ? { magazine: this.player.weapon.magazine, reserve: this.player.weapon.reserve, reloading: this.player.weapon.reloading } : null,
        primaryAmmo: this.player ? { magazine: this.player.primaryWeapon.magazine, reserve: this.player.primaryWeapon.reserve } : null,
        sidearmAmmo: this.player ? { magazine: this.player.sidearm.magazine, reserve: this.player.sidearm.reserve } : null,
        pickedAmmo: this.player?.pickedWeapon ? { magazine: this.player.pickedWeapon.magazine, reserve: this.player.pickedWeapon.reserve } : null,
        supplyAmmo:this.player?.supplyWeapon?{magazine:this.player.supplyWeapon.magazine,reserve:this.player.supplyWeapon.reserve}:null,
        vehicle:this.player?.vehicle?{health:this.player.vehicle.health,magazine:this.player.vehicle.gun.magazine}:null,vehicleCount:this.vehicles.filter(vehicle=>vehicle.active).length,
        averageFps: this.perfSeconds > 0 ? this.perfFrames / this.perfSeconds : 0,
        worstFps: this.perfWorstFps === 999 ? 0 : this.perfWorstFps, restarts: this.restartCount,
        fireHeld:this.fireHeld,heldInputCount:this.keyState.size,quality:this.profileStore.profile.settings.quality,
        shadowEnabled:this.mainLight?.shadowEnabled||false,fogEnabled:this.sceneRoot?.scene?.globals.fog.enabled||false,
        hud: { ammo: this.hudLabels.get('ammo')?.string||'', grenade: this.hudActionLabels.get('grenade')?.string||'', medkit: this.hudActionLabels.get('medkit')?.string||'',slots:this.webHudSlots?.textContent||this.hudLabels.get('slots')?.string||'',compass:this.webCompass?.textContent||'', visible:this.uiRoot?.getChildByName('HUD')?.activeInHierarchy||false, webVisible:this.webHudRoot?.style.display==='block', webHealth:this.webHudHealth?.textContent||'', webAmmo:this.webHudAmmo?.textContent||'', webItems:this.webHudItems?.textContent||'', tacticalMapVisible:Boolean(this.webTacticalMap&&this.webHudRoot?.style.display==='block'), tacticalMapTitle:this.webTacticalMapTitle?.textContent||'', mapObstacleCount:this.obstacles.filter(obstacle=>obstacle.name!=='Boundary').length, commanderMarkerCount:this.missionUsesCommanders()?this.actors.filter(actor=>actor.alive&&this.teamCommanders[actor.team]===actor.id).length:0 },
      }),
      start: (team: Team = 'blue', map: MapId = 'city', weapon?: PrimaryWeaponId) => {
        this.playerTeam = team; this.selectedMap = map;this.selectedMission='conquest';this.missionOwner=team;
        if (weapon && PRIMARY_WEAPONS[team].includes(weapon)) this.selectedPrimary[team] = weapon;
        this.startMatch([],true);
      },
      startMission:(team:Team,mission:MissionId,map:MapId='city')=>{this.playerTeam=team;this.missionOwner=team;this.selectedMission=mission;this.selectedMap=map;this.startMatch([],true);},
      startBattleRoyale:(map?:MapId)=>{this.gameMode='single';this.playerTeam='blue';this.missionOwner='blue';this.selectedMission='battle-royale';this.selectedMap=map||this.randomMap();this.startMatch([],true);},
      drawMissionRotation:(team:Team,count:number)=>Array.from({length:Math.max(0,Math.min(30,Math.floor(count)))},()=>this.randomMission(team)),
      restart: () => this.startMatch([],true),
      setQuality: (quality: 'low'|'medium'|'high') => { this.profileStore.profile.settings.quality = quality; this.applyQuality(); },
      setInvertVerticalLook: (enabled: boolean) => { this.profileStore.profile.settings.invertVerticalLook = enabled; this.profileStore.save(); },
      resetProfile:()=>{this.profileStore.reset();this.applyQuality();this.showMainMenu();},
      grantXp:(amount:number)=>{applyExperience(this.profileStore.profile,Math.max(0,amount));this.profileStore.save();this.showMainMenu();},
      fire: () => { this.pressFire(); this.releaseFire(); }, reload: () => this.beginReload(),
      tryFire: () => { const before=this.player?.weapon.magazine??0;this.pressFire();this.releaseFire();return (this.player?.weapon.magazine??0)<before; },
      holdFire: () => this.pressFire(), releaseFire: () => this.releaseFire(), ads: (value: boolean) => this.setAds(value),
      setOptic:(optic:OpticId)=>{if(this.player&&!BUILT_IN_OPTICS[this.player.weaponId]){this.profileStore.profile.loadouts[this.player.weaponId].optic=optic;this.updateWeaponAppearance();}},
      switchWeapon: (slot: 1|2|3|4) => this.switchWeapon(slot),toggleVehicle:()=>this.toggleVehicle(),
      grenade: () => this.throwGrenade(), heal: () => this.beginHeal(), useMissionEquipment:()=>this.useMissionEquipment(),
      detonateGrenades:()=>{for(const grenade of this.grenades)if(grenade.active)this.explode(grenade);},
      teleportPlayer:(x:number,y:number,z:number)=>{if(this.player&&!this.blocked(x,z,PLAYER_RADIUS,y,PLAYER_HEIGHT[this.player.action.stance])){this.player.node.setWorldPosition(x,y,z);this.player.grounded=true;}},
      damagePlayer: (amount: number) => { if (this.player) this.damageActor(this.player, Math.max(0, amount), null, `test-${Date.now()}`); },
      testFriendlyFire:()=>{const target=this.actors.find(actor=>actor!==this.player&&actor.team===this.player?.team&&actor.alive);if(!target||!this.player)return true;target.protectedUntil=0;const before=target.health;this.damageActor(target,25,this.player,`friendly-${Date.now()}`);return target.health===before;},
      forceEndSoon: () => { this.matchTime = Math.min(this.matchTime, 1); },
      releaseInputs: () => this.releaseAllInputs(),
      setAmmo: (magazine:number,reserve:number) => { if(this.player){const def=WEAPONS[this.player.weaponId];this.player.weapon.magazine=clamp(Math.floor(magazine),0,def.magazineSize);this.player.weapon.reserve=clamp(Math.floor(reserve),0,def.reserveAmmo);this.player.weapon.lastShotAt=-Infinity;this.player.weapon.reloading=false;this.player.action.cancel();} },
      resetRecoil: () => this.resetRecoil(),
      onlineCreate: async (team: Team = 'blue', weapon?: PrimaryWeaponId, code='ROOM01') => { this.gameMode='online';this.playerTeam=team;if(weapon&&PRIMARY_WEAPONS[team].includes(weapon))this.selectedPrimary[team]=weapon;await this.roomClient.connect();this.roomClient.createRoom(code,this.defaultPlayerName(),team,this.selectedPrimary[team]); },
      onlineJoin: async (code: string, team: Team = 'red', weapon?: PrimaryWeaponId) => { this.gameMode='online';this.playerTeam=team;if(weapon&&PRIMARY_WEAPONS[team].includes(weapon))this.selectedPrimary[team]=weapon;await this.roomClient.connect();this.roomClient.joinRoom(code,this.defaultPlayerName(),team,this.selectedPrimary[team]); },
      onlineStart: (map: MapId = 'city') => this.roomClient.startMatch(map,'conquest',this.playerTeam),
      onlineLeave: () => { this.roomClient.leave();this.clearMatch();this.showMainMenu(); },
    };
  }
}

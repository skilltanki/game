// Game-side tank: physics Tank + visual skin + team paint + health bar.
// Team colors follow the classic red/blue team play; 'dm' gets khaki.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { Matrix3 } from '../math/Matrix3';
import { Matrix4 } from '../math/Matrix4';
import { Quaternion } from '../math/Quaternion';
import { Vector3 } from '../math/Vector3';
import { WEAPON_BALANCE, WEAPON_MODS, type WeaponBalance } from '../weapon/WeaponBalance';
import { PhysicsMaterial } from '../physics/PhysicsMaterial';
import { CollisionBox } from '../physics/collision/primitives/CollisionBox';
import { CollisionGroup } from '../tank/CollisionGroup';
import { RayHit } from '../physics/collision/types/RayHit';
import type { CollisionDetector } from '../physics/collision/CollisionDetector';
import { Tank, TankSpec, TeamType, type TankId } from '../tank/Tank';
import { getHullSpec } from '../tank/HullSpecs';
import { loadTankSkin, TankSkin } from '../tank/TankSkin';
import { TracksAnimator } from '../tank/TracksAnimator';
import { resolvePart, type TankAssetRegistry } from '../tank/TankAssets';
import { RailgunWeapon, WeaponListener } from '../weapon/RailgunWeapon';
import { ProjectileWeapon } from '../weapon/ProjectileWeapon';
import { StreamWeapon } from '../weapon/StreamWeapon';
import { ShaftWeapon } from '../weapon/ShaftWeapon';
import type { Weapon } from '../weapon/Weapon';
import type { TankPhysicsScene } from '../tank/TankPhysicsScene';
import type { SpawnPoint } from '../map/SpawnPoints';

// Per-turret weapon DATA lives in weapon/WeaponSpecs.ts — a pure module the
// multiplayer server imports too. Re-exported here so game code keeps its
// import path.
export { WEAPON_SPECS, type AnyWeaponSpec } from '../weapon/WeaponSpecs';
import { WEAPON_SPECS, type AnyWeaponSpec } from '../weapon/WeaponSpecs';
const DEFAULT_WEAPON_SPEC: AnyWeaponSpec = WEAPON_SPECS.Smoky;

/** A spawn point with a tank closer than this is occupied (hull ~280 long). */
const SPAWN_CLEARANCE = 500;

const TEAM_PAINT: Record<TeamType, string> = {
  red: '#9a4a3a',
  blue: '#3a5e9a',
  dm: '#7a8a5a',
};

const HP_BAR_WIDTH = 180;
const HP_BAR_HEIGHT = 22;

// Native hp-bar skins from the original client's embedded bitmaps (tiny gradient tiles)
const HP_SKIN_BASE = assetUrl('/embedded/battlefieldmodel/bitmaps/ProgressBarSkin_');
const TEAM_SUFFIX: Record<TeamType, string> = { red: 'Red', blue: 'Blue', dm: 'Dm' };
const hpTextureCache = new Map<string, Promise<pc.Texture>>();

function loadHpTexture(app: pc.AppBase, url: string): Promise<pc.Texture> {
  let promise = hpTextureCache.get(url);
  if (promise == null) {
    promise = new Promise((resolve, reject) => {
      app.assets.loadFromUrl(url, 'texture', (err, asset) => {
        if (err != null || asset == null) {
          reject(new Error(String(err ?? 'texture load failed')));
        } else {
          resolve(asset.resource as pc.Texture);
        }
      });
    });
    hpTextureCache.set(url, promise);
  }
  return promise;
}

/**
 * Renders a call sign to a texture for the floating name plate.
 *
 * The original drew these as text fields; here the string is painted on
 * a canvas once at spawn, so the label costs one quad and no per-frame work.
 */
function nameTexture(device: pc.GraphicsDevice, name: string, colour: string): pc.Texture {
  const FONT_PX = 44;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  context.font = `bold ${FONT_PX}px Verdana, Tahoma, sans-serif`;
  const width = Math.max(64, Math.ceil(context.measureText(name).width) + 24);
  canvas.width = width;
  canvas.height = Math.ceil(FONT_PX * 1.6);
  // Re-apply: resizing the canvas resets the 2D context.
  context.font = `bold ${FONT_PX}px Verdana, Tahoma, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 6;
  context.strokeStyle = 'rgba(0,0,0,0.85)';
  context.strokeText(name, canvas.width / 2, canvas.height / 2);
  context.fillStyle = colour;
  context.fillText(name, canvas.width / 2, canvas.height / 2);

  const texture = new pc.Texture(device, {
    width: canvas.width,
    height: canvas.height,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  texture.setSource(canvas);
  return texture;
}

function unlitTextureMaterial(texture: pc.Texture, transparent = false): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissiveMap = texture;
  material.emissive = new pc.Color(1, 1, 1);
  material.useLighting = false;
  if (transparent) {
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
  }
  material.update();
  return material;
}

// Active supply-effect icons shown over the tank next to the hp bar — the
// original tank title did exactly this (EffectIndicator icons from the SWF)
const EFFECT_ICON_BASE = assetUrl('/embedded/battlefieldmodel/bitmaps/EffectIndicator_icon');
const EFFECT_ICON_URLS: Record<string, string> = {
  health: `${EFFECT_ICON_BASE}HealthCls.png`,
  armor: `${EFFECT_ICON_BASE}ArmorCls.png`,
  damage: `${EFFECT_ICON_BASE}PowerCls.png`,
  nitro: `${EFFECT_ICON_BASE}NitroCls.png`,
  // Must cover every SUPPLY_TYPES entry: setActiveEffects lays out a slot per
  // active supply, so a missing icon leaves a visible gap above the tank.
  nuclear: `${EFFECT_ICON_BASE}RadiationYellowCls.png`,
};
const EFFECT_ICON_SIZE = 44;
const NAME_LABEL_HEIGHT = 34;
/** Clear of the effect-icon row (which tops out at ~43) so neither overlaps. */
const NAME_LABEL_Z = HP_BAR_HEIGHT / 2 + EFFECT_ICON_SIZE + NAME_LABEL_HEIGHT / 2 + 14;
/** Name tint per team, matching the HUD's kill-log colours. */
const NAME_COLOURS: Record<string, string> = {
  red: '#ff7a5a',
  blue: '#6aa8ff',
  dm: '#e8e8e8',
};

/**
 * Barrel elevation limit, both up and down.
 *
 * Port note: the original DID have free vertical aim, contrary to an earlier
 * comment here. The original vertical auto-aiming package
 * defines VerticalAutoAiming (getElevationAngleUp/Down, getNumRaysUp/Down),
 * WeaponUtils.calculateMainGunParams hands out an `elevationAxis` beside the
 * direction, and TargetingSectorsCalculator walks every enemy tank, works out
 * the vertical sector it covers and clamps that sector to those angles:
 *
 *   lo = max(angleToTarget - halfSize, -getElevationAngleDown())
 *   hi = min(angleToTarget + halfSize,  getElevationAngleUp())
 *
 * The angles themselves arrived from the server (VerticalAnglesCC), which this
 * port has no equivalent of, so one symmetric value stands in for both.
 */
export const MAX_GUN_ELEVATION = (20 * Math.PI) / 180;
/** Beyond this a target is not worth auto-elevating onto (original maxDistance). */
const AUTO_AIM_RANGE = 12000;

/** Raycast-only weapon hitbox size, relative to the fitted turret/hull extents. */
const WEAPON_HITBOX_SCALE = 1.1;

/** Local id source; a server will supply ids instead once there is one. */
let tankIdCounter = 0;
function nextTankId(): TankId {
  tankIdCounter += 1;
  return `local:${tankIdCounter}`;
}

export interface GameTankOptions {
  /**
   * Stable identity for this tank. Everything that used to key off the object
   * reference (stats, status-effect timers, the kill log) keys off this
   * instead, so a tank can arrive over the network rather than being a
   * closure variable.
   */
  id?: TankId;
  /** Display name in the scoreboard and kill log. */
  name?: string;
  hull: string;
  turret: string;
  team: TeamType;
  /**
   * Garage paint id (paints.json). Omitted -> the team colour, which is what
   * bots and team play use.
   */
  paint?: string;
  /** Visual modification "M0".."M3" (default M0). */
  modification?: string;
  turretRotationSpeed?: number;
  turretRotationAcceleration?: number;
  weaponListener?: WeaponListener;
  /** Needed by splash/stream weapons to find area targets. */
  getAllTanks?: () => Tank[];
  /** The local player's tank: green hp bar like the original user title. */
  ownTank?: boolean;
  /** Manifest registry (hulls.json/turrets.json) — supplies the skin's file URLs. */
  assets: TankAssetRegistry;
}

function unlitColorMaterial(r: number, g: number, b: number): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(r, g, b);
  material.useLighting = false;
  material.update();
  return material;
}

export class GameTank {
  /** Stable id; see GameTankOptions.id. */
  readonly id: TankId;
  /** Display name (scoreboard, kill log). */
  name: string;
  /** True for the tank this client drives. */
  readonly isLocal: boolean;
  /**
   * Tank generation (the original's `incarnation`): the multiplayer SERVER
   * bumps it on every spawn, and a hit addressed to a previous life is
   * discarded by it. Solo battles leave it at 0.
   */
  incarnation = 0;
  /** Turret name, so nothing has to infer it from "is this the player?". */
  readonly turretName: string;
  readonly tank: Tank;
  readonly entity: pc.Entity;
  readonly turretEntity: pc.Entity;
  readonly hullName: string;
  /** Full hull mesh size (sim units) — used for dust scale / bound sphere. */
  readonly hullSize: { x: number; y: number; z: number };
  /** The listener object the weapons hold (see create); null for bots without one. */
  weaponListener: WeaponListener | null = null;
  weapon!: Weapon;
  audio: import('./TankAudio').TankAudio | null = null;
  /** Health bar root (lives in simRoot, billboarded around sim Z). */
  readonly hpBar: pc.Entity;
  /** Floating call sign above the bar; built in create(), with the hp skin. */
  private nameLabel: pc.Entity | null = null;
  /** False when the tank is kept out of the battle (Explore's unused bot). */
  private visible = true;
  /** False while the local tank is in Shaft's sniper view. */
  private overheadVisible = true;
  /** Last requested trigger state, so a blocked barrel can restore it. */
  private triggerHeld = false;

  private hpFill: pc.Entity;
  private hpBg: pc.Entity;
  private effectIcons = new Map<string, pc.Entity>();
  private skinMaterials: pc.StandardMaterial[] = [];
  /** Scrolls the hull's track belts; null for hulls with no "track" submaterial. */
  private tracksAnimator: TracksAnimator | null = null;
  private destroyedVisual = false;
  private readonly interpolatedPosition = new Vector3();
  /** Turret angle used by the LAST render, so attachments match what is drawn. */
  private lastRenderTurretDirection = 0;
  private readonly interpolatedOrientation = new Quaternion();
  private readonly turretMount: { x: number; y: number; z: number };
  /** CTF flag mount point in turret space (the turret 3DS "fmnt" marker). */
  private readonly flagMount: { x: number; y: number; z: number };
  /** All muzzle markers; multi-barrel turrets alternate (PlasmaWeapon.currentBarrel). */
  private readonly muzzles: { x: number; y: number; z: number }[];
  private barrelIndex = 0;
  private readonly _local = new Vector3();
  private hpBarHeight: number;

  private constructor(
    tank: Tank,
    entity: pc.Entity,
    hullName: string,
    skin: TankSkin,
    identity: { id: TankId; name: string; isLocal: boolean; turretName: string },
  ) {
    this.id = identity.id;
    this.name = identity.name;
    this.isLocal = identity.isLocal;
    this.turretName = identity.turretName;
    this.tank = tank;
    this.entity = entity;
    this.hullName = hullName;
    this.hullSize = skin.hullSize;
    this.turretEntity = entity.findByName('turret') as pc.Entity;
    // Hull/turret materials for the burnt-out look of a destroyed tank
    for (const name of ['hull', 'turret']) {
      const part = entity.findByName(name) as pc.Entity | null;
      const material = part?.render?.meshInstances[0]?.material;
      if (material instanceof pc.StandardMaterial) {
        this.skinMaterials.push(material);
      }
    }
    // Track belts (TankSkin.createTrackSkins + TracksAnimator in the original).
    // Hulls whose mesh carries no "track" submaterial (e.g. the ufo hovercraft)
    // simply get no animator.
    if (skin.hasTracks) {
      this.tracksAnimator = new TracksAnimator(tank.chassis, skin, tank.getMaxSpeedSmoother());
    }
    this.turretMount = skin.turretMount;
    this.flagMount = skin.flagMount;
    this.muzzles = skin.muzzles;
    this.hpBarHeight = skin.hullSize.z + 110;

    this.hpBar = new pc.Entity('hpBar');
    this.hpBg = new pc.Entity('hpBg');
    this.hpBg.addComponent('render', { type: 'box' });
    this.hpBg.setLocalScale(HP_BAR_WIDTH + 8, 2, HP_BAR_HEIGHT + 8);
    this.hpBg.render!.material = unlitColorMaterial(0.08, 0.08, 0.08);
    this.hpBar.addChild(this.hpBg);
    this.hpFill = new pc.Entity('hpFill');
    this.hpFill.addComponent('render', { type: 'box' });
    this.hpFill.setLocalScale(HP_BAR_WIDTH, 4, HP_BAR_HEIGHT);
    this.hpFill.render!.material = unlitColorMaterial(0.2, 0.85, 0.25);
    this.hpBar.addChild(this.hpFill);

  }

  /**
   * Swap the placeholder bar colors for the native SWF-extracted skins.
   * The OWN tank always gets the green bar (original user title behavior);
   * enemies/teammates are tinted by team.
   */
  /**
   * Call sign above the bar. It is parented to the hp bar, so it inherits the
   * same billboard turn and the same show/hide rules, and sits clear of the
   * effect-icon row so an active supply never covers the name.
   */
  private buildNameLabel(app: pc.AppBase, team: TeamType): void {
    const texture = nameTexture(app.graphicsDevice, this.name, NAME_COLOURS[team] ?? '#e8e8e8');
    const label = new pc.Entity('nameLabel');
    label.addComponent('render', { type: 'plane' });
    label.render!.material = unlitTextureMaterial(texture, true);
    label.setLocalScale((texture.width / texture.height) * NAME_LABEL_HEIGHT, 1, NAME_LABEL_HEIGHT);
    // Same upright/in-plane correction the effect icons need.
    label.setLocalEulerAngles(0, 180, 0);
    label.setLocalPosition(0, 4, NAME_LABEL_Z);
    this.hpBar.addChild(label);
    this.nameLabel = label;
  }

  private async applyHpSkin(app: pc.AppBase, team: TeamType, ownTank: boolean): Promise<void> {
    const suffix = ownTank ? 'Dm' : TEAM_SUFFIX[team];
    const [fillTexture, bgTexture] = await Promise.all([
      loadHpTexture(app, `${HP_SKIN_BASE}hpLeft${suffix}Cls.png`),
      loadHpTexture(app, `${HP_SKIN_BASE}hpLeftBg${suffix}Cls.png`),
    ]);
    this.hpFill.render!.material = unlitTextureMaterial(fillTexture);
    this.hpBg.render!.material = unlitTextureMaterial(bgTexture);
    this.hpBg.setLocalScale(HP_BAR_WIDTH, 2, HP_BAR_HEIGHT);
  }

  /** Icon quads for active supply effects, laid out above the hp bar. */
  private async initEffectIcons(app: pc.AppBase): Promise<void> {
    for (const [key, url] of Object.entries(EFFECT_ICON_URLS)) {
      const texture = await loadHpTexture(app, url);
      const icon = new pc.Entity(`effect_${key}`);
      // A plane (not a box): the box face toward the camera had flipped UVs,
      // rendering the icon upside down. The plane's +Y normal already faces
      // the camera after the hp-bar billboard turn; pitch it upright.
      icon.addComponent('render', { type: 'plane' });
      icon.render!.material = unlitTextureMaterial(texture, true);
      icon.setLocalScale(EFFECT_ICON_SIZE, 1, EFFECT_ICON_SIZE);
      // The plane's +Y normal already faces the camera after the bar's
      // billboard turn; rotate 180° in-plane so the texture reads upright
      icon.setLocalEulerAngles(0, 180, 0);
      icon.enabled = false;
      this.hpBar.addChild(icon);
      this.effectIcons.set(key, icon);
    }
  }

  /** Shows the icons of currently active effects (billboarded with the bar). */
  setActiveEffects(keys: string[]): void {
    const spacing = EFFECT_ICON_SIZE + 8;
    const startX = (-(keys.length - 1) * spacing) / 2;
    let index = 0;
    for (const [key, icon] of this.effectIcons) {
      const active = keys.indexOf(key) >= 0;
      icon.enabled = active;
      if (active) {
        icon.setLocalPosition(startX + index * spacing, 4, HP_BAR_HEIGHT / 2 + EFFECT_ICON_SIZE / 2 + 10);
        index++;
      }
    }
  }

  static async create(
    app: pc.AppBase,
    simRoot: pc.Entity,
    physicsScene: TankPhysicsScene,
    options: GameTankOptions,
  ): Promise<GameTank> {
    const hullSpec = getHullSpec(options.hull);
    const modification = options.modification ?? 'M0';
    const skin = await loadTankSkin(app, {
      hull: resolvePart(options.assets.hulls, 'hull', options.hull, modification),
      turret: resolvePart(options.assets.turrets, 'turret', options.turret, modification),
      paintColor: TEAM_PAINT[options.team],
      // A chosen garage paint overrides the team colour for this tank only.
      ...(options.paint != null
        ? { paintImage: options.assets.paints.get(options.paint)?.image }
        : {}),
    });
    const spec: TankSpec = {
      ...hullSpec,
      hullSize: skin.hullSize,
      turretRotationSpeed: options.turretRotationSpeed ?? 1.7,
      turretRotationAcceleration: options.turretRotationAcceleration ?? 3.4,
    };
    const tank = new Tank(spec);
    tank.team = options.team;
    const entity = skin.buildEntity();
    simRoot.addChild(entity);
    const gameTank = new GameTank(tank, entity, options.hull, skin, {
      id: options.id ?? nextTankId(),
      name: options.name ?? options.turret,
      isLocal: options.ownTank ?? false,
      turretName: options.turret,
    });
    simRoot.addChild(gameTank.hpBar);
    await gameTank.applyHpSkin(app, options.team, options.ownTank ?? false);
    gameTank.buildNameLabel(app, options.team);
    await gameTank.initEffectIcons(app);
    tank.addToScene(physicsScene);
    // Upper weapon hitbox: weapon rays hit the turret and the hull roof zone
    // (the hull-only box let shots from tall muzzles fly OVER low tanks).
    // Spans hull width, from just under the turret mount to above the turret
    // top. Physical contacts are untouched — they use only
    // staticShapes/tankCollisionBox, extra body shapes are raycast-only.
    const hb = skin.turretHitbox;
    const halfXY = Math.max(hb.halfXY, skin.hullSize.x / 2);
    const zBottom = skin.turretMount.z - 25;
    const zTop = skin.turretMount.z + hb.centerZ + hb.halfZ + 30;
    // Grown 10% all round so flat shots from a tall muzzle still catch a low
    // hull (a Dictator+Ricochet muzzle sits ~119 units above a Viking's centre,
    // and the unscaled box had only ~8 units of margin left at the top).
    const turretBox = new CollisionBox(
      new Vector3(halfXY * WEAPON_HITBOX_SCALE, halfXY * WEAPON_HITBOX_SCALE,
                  ((zTop - zBottom) / 2) * WEAPON_HITBOX_SCALE),
      CollisionGroup.WEAPON,
      new PhysicsMaterial(0, 0.2),
    );
    const turretBoxTransform = new Matrix4();
    turretBoxTransform.setPosition(new Vector3(skin.turretMount.x, skin.turretMount.y, (zTop + zBottom) / 2));
    tank.getBody().addCollisionShape(turretBox, turretBoxTransform);
    const baseSpec = WEAPON_SPECS[options.turret] ?? DEFAULT_WEAPON_SPEC;
    // Resolve the modification's balance here and hand it to the weapon, so
    // the weapon itself never has to know which M it is mounting.
    const balanceId = (baseSpec as { balance?: string }).balance;
    const modBalance =
      balanceId != null
        ? WEAPON_MODS[balanceId]?.[modification] ?? WEAPON_BALANCE[balanceId]
        : undefined;
    const weaponSpec = modBalance != null ? { ...baseSpec, modBalance } : baseSpec;
    const detector = physicsScene.getCollisionDetector();
    const listener = options.weaponListener ?? null;
    // Kept by reference: the weapons hold this very object, so NetBattle can
    // augment its methods in place to broadcast the local shot/charge.
    gameTank.weaponListener = listener;
    const getAllTanks = options.getAllTanks ?? ((): Tank[] => []);
    gameTank.allTanks = getAllTanks;
    gameTank.weaponBalance = (weaponSpec as { balance?: string }).balance;
    gameTank.modification = modification;
    switch (weaponSpec.kind) {
      case 'projectile':
        gameTank.weapon = new ProjectileWeapon(tank, weaponSpec, detector, simRoot, listener, getAllTanks, app);
        break;
      case 'stream':
        gameTank.weapon = new StreamWeapon(tank, weaponSpec, detector, listener, getAllTanks);
        break;
      case 'shaft':
        gameTank.weapon = new ShaftWeapon(tank, weaponSpec, detector, listener, getAllTanks);
        break;
      default:
        gameTank.weapon = new RailgunWeapon(tank, weaponSpec, detector, listener);
        break;
    }
    return gameTank;
  }

  // --- weapon / aiming (original WeaponPlatform.getAllGunParams) ---

  /** Current-barrel muzzle position in world (sim) space. */
  getMuzzleWorldPosition(out: Vector3): void {
    this.getBarrelWorldPosition(this.barrelIndex, out);
  }

  /** How many barrels this turret has (Twins: 2). */
  getBarrelCount(): number {
    return this.muzzles.length;
  }

  /** Index of the barrel that will fire the NEXT shot. */
  getCurrentBarrel(): number {
    return this.barrelIndex;
  }

  /** Muzzle position of a specific barrel in world (sim) space. */
  getBarrelWorldPosition(index: number, out: Vector3): void {
    const muzzle = this.muzzles[index % this.muzzles.length];
    const direction = this.tank.turretController.getDirection();
    const cos = Math.cos(direction);
    const sin = Math.sin(direction);
    this._local.x = this.turretMount.x + muzzle.x * cos - muzzle.y * sin;
    this._local.y = this.turretMount.y + muzzle.x * sin + muzzle.y * cos;
    this._local.z = this.turretMount.z + muzzle.z;
    const body = this.tank.getBody();
    body.baseMatrix.transformVector(this._local, out);
    out.add(body.state.position);
  }

  /**
   * Port of WeaponUtils.calculateMainGunParams' `barrelOrigin`: the muzzle
   * marker with its ALONG-BARREL component dropped, i.e. where the barrel
   * leaves the turret. The original zeroes the local Y (barrels point +Y)
   * and transforms the rest.
   */
  getBarrelOriginWorldPosition(index: number, out: Vector3): void {
    const muzzle = this.muzzles[index % this.muzzles.length];
    const direction = this.tank.turretController.getDirection();
    const cos = Math.cos(direction);
    const sin = Math.sin(direction);
    // localBarrelOrigin = (muzzle.x, 0, muzzle.z)
    this._local.x = this.turretMount.x + muzzle.x * cos;
    this._local.y = this.turretMount.y + muzzle.x * sin;
    this._local.z = this.turretMount.z + muzzle.z;
    const body = this.tank.getBody();
    body.baseMatrix.transformVector(this._local, out);
    out.add(body.state.position);
  }

  /**
   * Port of BattleUtils.barrelCollidesWithStatic: is the barrel buried in map
   * geometry? Casts from where the barrel leaves the turret to the muzzle, so
   * a gun poked through a wall is detected before the shot is placed on the
   * far side of it.
   */
  barrelCollidesWithStatic(index: number, detector: CollisionDetector): boolean {
    this.getBarrelOriginWorldPosition(index, _barrelOrigin);
    this.getBarrelWorldPosition(index, _barrelTip);
    _barrelDir.x = _barrelTip.x - _barrelOrigin.x;
    _barrelDir.y = _barrelTip.y - _barrelOrigin.y;
    _barrelDir.z = _barrelTip.z - _barrelOrigin.z;
    const length = _barrelDir.length();
    if (length < 1e-3) {
      return false;
    }
    // raycastStatic takes a direction and a max length along it; the original
    // passes the barrel length as that limit.
    _barrelDir.scale(1 / length);
    return detector.raycastStatic(
      _barrelOrigin,
      _barrelDir,
      CollisionGroup.STATIC,
      length,
      null,
      _barrelHit,
    );
  }

  /**
   * Port of TankSkin.readGlobalFlagMountPoint: the carried-flag anchor in
   * world (sim) space. Same turret-space -> body-space rotation as the
   * muzzles, since the marker rides the turret.
   *
   * Uses the INTERPOLATED pose, not body.state: physics steps at a fixed
   * 33 ms while rendering runs every frame, so a flag anchored to the raw
   * step position lags the hull it is riding and visibly stutters. The hull
   * and the health bar are both drawn from these same interpolated values
   * (see updateRender), so the flag now moves exactly with them.
   */
  getFlagMountWorldPosition(out: Vector3): void {
    const direction = this.lastRenderTurretDirection;
    const cos = Math.cos(direction);
    const sin = Math.sin(direction);
    this._local.x = this.turretMount.x + this.flagMount.x * cos - this.flagMount.y * sin;
    this._local.y = this.turretMount.y + this.flagMount.x * sin + this.flagMount.y * cos;
    this._local.z = this.turretMount.z + this.flagMount.z;
    this.interpolatedOrientation.toMatrix3(_flagMatrix);
    _flagMatrix.transformVector(this._local, out);
    out.add(this.interpolatedPosition);
  }

  /** Original PlasmaWeapon: currentBarrel = (currentBarrel + 1) % numberOfBarrels. */
  private advanceBarrel(): void {
    this.barrelIndex = (this.barrelIndex + 1) % this.muzzles.length;
  }

  /**
   * Bot aim assist: when set, shots leave the muzzle toward this world point
   * (vertical correction included) instead of straight along the barrel.
   */
  aimPoint: Vector3 | null = null;

  /** Battle roster, for the vertical auto-aim target search. */
  private allTanks?: () => Tank[];

  /** WEAPON_BALANCE key for this turret, for its vertical arc. */
  private weaponBalance?: string;
  /** Which modification (M0..M3) this tank mounts. */
  private modification = 'M0';

  /**
   * This turret's balance for its modification. WEAPON_MODS carries M0..M3
   * from the server's garage data; WEAPON_BALANCE is the M0 shorthand the
   * weapons already reference, so it is the fallback.
   */
  balanceProfile(): WeaponBalance | undefined {
    if (this.weaponBalance == null) {
      return undefined;
    }
    return (
      WEAPON_MODS[this.weaponBalance]?.[this.modification] ?? WEAPON_BALANCE[this.weaponBalance]
    );
  }

  /**
   * Manually commanded barrel elevation, in radians. When set, it REPLACES the
   * vertical auto-aim: the Shaft's sniper mode drives it from W/S so the shot
   * is aimed by hand, the way the original's targeting camera did.
   * null = automatic elevation.
   */
  manualPitch: number | null = null;

  /** Barrel direction in world (sim) space: turret-local +Y (or toward aimPoint). */
  getShotDirection(out: Vector3): void {
    if (this.aimPoint != null) {
      this.getMuzzleWorldPosition(out);
      out.diff(this.aimPoint, out.clone());
      out.normalize();
      // The original gun has NO free vertical aim: WeaponUtils builds the shot
      // direction straight from the turret's forward axis, so a tank sitting
      // directly above or below simply cannot be shot. Our bot aims by point
      // (needed so tall muzzles still hit low hulls), which removed that limit
      // entirely — clamp the pitch back to a real gun's elevation range.
      const horizontal = Math.hypot(out.x, out.y);
      const maxTan = Math.tan(MAX_GUN_ELEVATION);
      const maxZ = horizontal * maxTan;
      if (Math.abs(out.z) > maxZ) {
        out.z = Math.sign(out.z) * maxZ;
        out.normalize();
      }
      return;
    }
    const direction = this.tank.turretController.getDirection();
    this._local.x = -Math.sin(direction);
    this._local.y = Math.cos(direction);
    this._local.z = 0;
    this.tank.getBody().baseMatrix.transformVector(this._local, out);
    this.applyVerticalAutoAim(out);
  }

  /**
   * Port of TargetingSectorsCalculator.calculateSectorAndAdd: pick the enemy
   * the gun is pointing at horizontally and elevate the barrel onto it, within
   * MAX_GUN_ELEVATION. This is what let the original hit a tank up a slope or
   * below a ledge without the player nosing the hull up and down.
   *
   * Only the vertical component is touched — the turret's horizontal aim is
   * still entirely the player's job, so this is not full auto-aim.
   */
  /**
   * This weapon's vertical arc, in radians. The server gives every gun its own
   * (shots-data auto_aiming_up / auto_aiming_down) and they are asymmetric —
   * a gun reaches further down than up. Falls back to the flat
   * MAX_GUN_ELEVATION for anything with no balance profile.
   */
  private elevationLimits(): { up: number; down: number } {
    const balance = this.balanceProfile();
    return {
      up: balance?.aimUp ?? MAX_GUN_ELEVATION,
      down: balance?.aimDown ?? MAX_GUN_ELEVATION,
    };
  }

  private applyVerticalAutoAim(out: Vector3): void {
    const limits = this.elevationLimits();
    if (this.manualPitch != null) {
      // Hand-aimed: no target search, just tilt the barrel — but RELATIVE to
      // where it already points. `out` arrives along the turret axis, which on
      // a slope is already pitched by the hull; overwriting out.z here threw
      // that away, so entering sniper mode on a hill snapped the gun (and the
      // camera that follows it) flat to the horizon.
      const flatLength = Math.hypot(out.x, out.y);
      if (flatLength < 1e-6) {
        return;
      }
      const hullPitch = Math.atan2(out.z, flatLength);
      const angle = hullPitch + Math.max(-limits.down, Math.min(limits.up, this.manualPitch));
      const cos = Math.cos(angle);
      out.x = (out.x / flatLength) * cos;
      out.y = (out.y / flatLength) * cos;
      out.z = Math.sin(angle);
      out.normalize();
      return;
    }
    const tanks = this.allTanks?.() ?? [];
    if (tanks.length === 0) {
      return;
    }
    this.getMuzzleWorldPosition(this._muzzleWorld);
    // Horizontal part of the barrel direction: the axis we measure against.
    const flatX = out.x;
    const flatY = out.y;
    const flatLength = Math.hypot(flatX, flatY);
    if (flatLength < 1e-6) {
      return;
    }
    const dirX = flatX / flatLength;
    const dirY = flatY / flatLength;

    let bestAngle: number | null = null;
    let bestDistance = Infinity;
    for (const tank of tanks) {
      if (tank === this.tank || tank.isDead()) {
        continue;
      }
      const position = tank.getBody().state.position;
      const dx = position.x - this._muzzleWorld.x;
      const dy = position.y - this._muzzleWorld.y;
      const dz = position.z - this._muzzleWorld.z;
      // Distance along the barrel's horizontal axis; behind the gun is no target.
      const along = dx * dirX + dy * dirY;
      if (along <= 0 || along > AUTO_AIM_RANGE) {
        continue;
      }
      // Lateral miss: only elevate onto something the turret already faces,
      // within the angle the target's own size subtends (original _loc16_).
      const lateral = Math.abs(dx * -dirY + dy * dirX);
      const radius = Math.max(tank.halfLength, 1);
      const distance = Math.hypot(along, lateral, dz);
      const halfSize = Math.asin(Math.min(1, radius / Math.max(distance, radius)));
      if (Math.atan2(lateral, along) > halfSize) {
        continue;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        bestAngle = Math.atan2(dz, along);
      }
    }
    if (bestAngle == null) {
      return;
    }
    // Clamp to the gun's elevation range, exactly as the original clamped the
    // targeting sector to [-angleDown, +angleUp].
    const angle = Math.max(-limits.down, Math.min(limits.up, bestAngle));
    out.x = dirX * Math.cos(angle);
    out.y = dirY * Math.cos(angle);
    out.z = Math.sin(angle);
    out.normalize();
  }

  private readonly _muzzleWorld = new Vector3();

  /** Points the turret at a world position; returns |angle error| in radians. */
  /**
   * Angle the turret still has to cover to point at `target`, without
   * commanding any rotation. Lets a caller decide whether re-aiming is worth it.
   */
  turretErrorTo(target: Vector3): number {
    const diff = this.turretAngleTo(target) - this.tank.turretController.getDirection();
    return Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff)));
  }

  /** Turret angle (hull space) that would point at `target`. */
  private turretAngleTo(target: Vector3): number {
    const body = this.tank.getBody();
    this._local.diff(target, body.state.position);
    body.baseMatrix.transformVectorInverse(this._local.clone(), this._local);
    return Math.atan2(-this._local.x, this._local.y);
  }

  aimTurretAt(target: Vector3): number {
    const desired = this.turretAngleTo(target);
    this.tank.turretController.setTargetDirection(desired);
    const diff = desired - this.tank.turretController.getDirection();
    return Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff)));
  }

  /** Fire button state. Routed through here so updateWeapon can veto a shot. */
  setTrigger(pressed: boolean): void {
    this.triggerHeld = pressed;
    this.weapon.setTrigger(pressed);
  }

  /**
   * Runs weapon logic once per physics step.
   *
   * `detector` enables the barrel-obstruction check: a gun poked through a
   * wall cannot fire. The original only dropped auto-aim in that case and let
   * the shot go (BattleUtils.barrelCollidesWithStatic feeds
   * PlasmaWeapon.doRealShot / RocketLauncherWeapon), but because this port
   * spawns the shell AT the muzzle, a barrel sticking through a barrier put
   * the shell on the far side of it and let a tank shoot through cover.
   */
  updateWeapon(timeMs: number, detector?: CollisionDetector): void {
    if (detector != null && this.barrelCollidesWithStatic(this.barrelIndex, detector)) {
      // Hold fire while buried, but keep the weapon ticking so reload, charge
      // and overheat all continue to run.
      this.weapon.setTrigger(false);
      this.weapon.update(
        timeMs,
        (out) => this.getMuzzleWorldPosition(out),
        (out) => this.getShotDirection(out),
      );
      this.weapon.setTrigger(this.triggerHeld);
      return;
    }
    this.weapon.update(
      timeMs,
      (out) => {
        // Weapons read the muzzle only at the moment of firing — alternate
        // the barrel afterwards (Twins shoots left/right like the original)
        this.getMuzzleWorldPosition(out);
        this.advanceBarrel();
      },
      (out) => this.getShotDirection(out),
    );
  }

  /**
   * Picks the NEXT spawn point without applying it. Separated from spawning so
   * the point is known in advance (the original announced it on death for the
   * camera fly-in; a multiplayer server must do the same).
   */
  pickSpawnPoint(spawnPoints: SpawnPoint[]): SpawnPoint | null {
    const own = spawnPoints.filter((p) => p.type === this.tank.team);
    const dm = spawnPoints.filter((p) => p.type === 'dm');
    const pool = own.length > 0 ? own : dm.length > 0 ? dm : spawnPoints;
    if (pool.length === 0) {
      return null;
    }
    // Spawning into a tank already standing there interpenetrates the hulls
    // and the contact solver tips the newcomer over. Wrecks keep their
    // collision bodies through the death delay, so dead tanks count too
    // (mirror: BattleRoom.pickSpawn).
    const others = (this.allTanks?.() ?? []).filter((t) => t !== this.tank);
    const clearance = (p: SpawnPoint): number => {
      let nearest = Infinity;
      for (const t of others) {
        const tp = t.getBody().state.position;
        nearest = Math.min(nearest, Math.hypot(tp.x - p.position.x, tp.y - p.position.y));
      }
      return nearest;
    };
    const free = pool.filter((p) => clearance(p) > SPAWN_CLEARANCE);
    if (free.length > 0) {
      return free[(Math.random() * free.length) | 0];
    }
    // Every point is crowded: take the one with the most room.
    return pool.reduce((best, p) => (clearance(p) > clearance(best) ? p : best));
  }

  /** Spawns at a team spawn point (falls back to dm, then to any). */
  spawnAt(spawnPoints: SpawnPoint[]): SpawnPoint | null {
    const spawn = this.pickSpawnPoint(spawnPoints);
    if (spawn != null) {
      this.spawnAtPoint(spawn);
    }
    return spawn;
  }

  spawnAtPoint(spawn: SpawnPoint): void {
    const body = this.tank.getBody();
    this.tank.setPosition(spawn.position.x, spawn.position.y, spawn.position.z + 100);
    body.state.orientation.setFromAxisAngleComponents(0, 0, 1, spawn.rotationZ);
    body.saveState();
    body.calcDerivedData();
  }

  runBeforePhysicsUpdate(dt: number): void {
    this.tank.runBeforePhysicsUpdate(dt);
  }

  runAfterPhysicsUpdate(): void {
    this.tank.runAfterPhysicsUpdate();
  }

  /**
   * Destroyed tanks stay on the map as a charred silhouette until respawn
   * (the original darkened the dead hull); the title (hp bar + icons) hides.
   */
  private applyDestroyedVisual(destroyed: boolean): void {
    if (this.destroyedVisual === destroyed) {
      return;
    }
    this.destroyedVisual = destroyed;
    const tint = destroyed ? 0.16 : 1;
    for (const material of this.skinMaterials) {
      material.emissive.set(tint, tint, tint);
      material.update();
    }
    // A hidden tank keeps its bar hidden: applyDestroyedVisual runs every
    // frame from updateRender and would otherwise switch it straight back on.
    this.hpBar.enabled = this.visible && this.overheadVisible && !destroyed;
  }

  /**
   * Show/hide the tank's meshes without disabling the entity itself — the
   * positional sound component is attached to it, and disabling the entity
   * would silence the engine and turret loops (spawn-protection blink).
   */
  /**
   * Hides this tank's own bar, name and effect icons.
   *
   * Used for the local tank in Shaft's sniper mode: the camera sits right
   * behind the turret there, so the player's own plate fills the middle of
   * the screen exactly where the shot is going. Enemy plates stay up — they
   * are what you are aiming AT.
   */
  setOverheadVisible(visible: boolean): void {
    this.overheadVisible = visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const child of this.entity.children) {
      child.enabled = visible;
    }
    // The health bar hangs off the sim root, not off this tank's entity, so
    // hiding the children alone left it floating in mid-air (seen in Explore,
    // where the bot is hidden rather than spawned).
    // Respect the sniper-mode hide too, or toggling visibility would switch
    // the local plate back on mid-aim.
    this.hpBar.enabled = visible && this.overheadVisible;
  }

  /** Per-frame: interpolate transform, rotate turret, scroll tracks, place and fill the hp bar. */
  updateRender(alpha: number, camSimPos: pc.Vec3, dt = 0): void {
    this.applyDestroyedVisual(this.tank.isDead());
    this.tank.interpolate(alpha, this.interpolatedPosition, this.interpolatedOrientation);
    this.entity.setLocalPosition(this.interpolatedPosition.x, this.interpolatedPosition.y, this.interpolatedPosition.z);
    this.entity.setLocalRotation(
      this.interpolatedOrientation.x,
      this.interpolatedOrientation.y,
      this.interpolatedOrientation.z,
      this.interpolatedOrientation.w,
    );
    const turretDirection = this.tank.turretController.getInterpolatedDirection(alpha);
    this.lastRenderTurretDirection = turretDirection;
    this.turretEntity.setLocalEulerAngles(0, 0, (turretDirection * 180) / Math.PI);
    // Tank.updateDisplay: tracksAnimator.animate(dt) — dt in SECONDS
    if (dt > 0) {
      this.tracksAnimator?.animate(dt);
    }

    // Health bar: above the tank, cylindrical billboard, left-anchored fill
    const p = this.interpolatedPosition;
    this.hpBar.setLocalPosition(p.x, p.y, p.z + this.hpBarHeight);
    const angle = Math.atan2(-(camSimPos.x - p.x), camSimPos.y - p.y);
    this.hpBar.setLocalEulerAngles(0, 0, (angle * 180) / Math.PI);
    const fraction = this.tank.maxHealth > 0 ? this.tank.health / this.tank.maxHealth : 0;
    // Local +Y faces the camera after the billboard turn; local +X points to the
    // VIEWER'S LEFT, so a positive offset keeps the fill anchored at the
    // viewer-left edge and health visually drains right-to-left (original)
    this.hpFill.setLocalScale(Math.max(HP_BAR_WIDTH * fraction, 0.001), 4, HP_BAR_HEIGHT);
    this.hpFill.setLocalPosition((HP_BAR_WIDTH * (1 - fraction)) / 2, 4, 0);
  }
}

/** Scratch rotation for the interpolated flag-mount transform. */
const _flagMatrix = new Matrix3();

/** Scratch vectors for the barrel-obstruction raycast. */
const _barrelOrigin = new Vector3();
const _barrelTip = new Vector3();
const _barrelDir = new Vector3();
const _barrelHit = new RayHit();

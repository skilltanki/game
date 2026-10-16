// Port of the original CTFFlag + CTFFlagState.
//
// A flag is an upright billboard sprite standing on its pedestal, plus a
// collision box the original uses as a pickup trigger. Differences from the
// The original:
//  - OmniLight dropped: this port has no dynamic lighting, every material is
//    unlit/emissive (see MapLoader), so a point light would do nothing.
//  - AnimatedSprite3D -> a single static quad. The original cuts the texture
//    into 128x256 frames and cycles them once per second; the flag PNGs in
//    this asset dump are 85x176, i.e. exactly ONE frame
//    (getUVFramesFromTexture: min(128,85) x min(256,176)), so there is no
//    waving animation to play.
//  - checkTrigger's two static raycasts (anti-pickup-through-walls) are kept,
//    but run against this port's CollisionDetector.
import * as pc from 'playcanvas';
import { Vector3 } from '../math/Vector3';
import type { GameTank } from './GameTank';
import type { TeamType } from '../tank/Tank';

/**
 * CTFFlagState.
 *
 * 'dropped' is part of the original's state machine and is kept for the
 * protocol, but this build never enters it: losing a carrier sends the flag
 * straight back to its pedestal (see CtfMode.dropCarriedFlag).
 */
export type FlagState = 'atBase' | 'dropped' | 'carried';

/** CTFFlag.SKIN_HEIGHT */
const SKIN_HEIGHT = 400;
/** CTFFlag.SKIN_BASE_SIZE — the pickup box footprint. */
const SKIN_BASE_SIZE = 95;
/** CTFFlag.render: the flag rides this far BELOW the turret mount point. */
const CARRY_Z_OFFSET = -50;
/**
 * Height of the pedestal mesh (flag_stand_*.3ds spans z 0..70), so a flag
 * AT BASE stands ON the stand instead of sinking its pole through it. A
 * dropped flag lies on the ground and gets no lift.
 */
const PEDESTAL_HEIGHT = 70;

export class CtfFlag {
  state: FlagState = 'atBase';
  /** The tank carrying it, or null. */
  carrier: GameTank | null = null;

  readonly basePosition: Vector3;
  /** Current world (sim) position of the flag's foot. */
  readonly position = new Vector3();

  private readonly entity: pc.Entity;
  private readonly material: pc.StandardMaterial;

  constructor(
    readonly team: 'red' | 'blue',
    basePosition: Vector3,
    texture: pc.Texture,
    simRoot: pc.Entity,
  ) {
    this.basePosition = basePosition.clone();

    // createSkin: width follows the texture's aspect at a fixed height, so a
    // flag is never stretched. Original: param1 * SKIN_HEIGHT / param2.
    const width = (texture.width * SKIN_HEIGHT) / texture.height;

    this.material = new pc.StandardMaterial();
    this.material.diffuse = new pc.Color(0, 0, 0);
    this.material.emissiveMap = texture;
    this.material.emissive = new pc.Color(1, 1, 1);
    this.material.opacityMap = texture;
    // The cloth PNG is stored top-down (pole foot at the BOTTOM of the image),
    // and a pc plane samples V the other way round, which hangs the flag
    // upside down -- pole in the air, cloth under it. Flip V on both maps.
    this.material.emissiveMapTiling = new pc.Vec2(1, -1);
    this.material.opacityMapTiling = new pc.Vec2(1, -1);
    this.material.blendType = pc.BLEND_NORMAL;
    this.material.cull = pc.CULLFACE_NONE;
    this.material.depthWrite = false;
    // Flags are landmarks: the fog must not swallow one across the map.
    this.material.useFog = false;
    this.material.update();

    this.entity = new pc.Entity(`ctf-flag-${team}`);
    this.entity.addComponent('render', { type: 'plane' });
    this.entity.render!.material = this.material;
    // A pc plane lies in its local XZ with the normal along local Y. simRoot
    // already rotates -90 about X to reach the sim's Z-up space, so at zero
    // local rotation the quad is ALREADY upright and its local Z is the sim's
    // vertical: width goes in X, cloth height in Z, and no extra pitch is
    // needed. (HitEffects' round sprites are equal-sided, so their quad reads
    // the same either way; a 193x400 flag does not.)
    this.entity.setLocalScale(width, 1, SKIN_HEIGHT);
    simRoot.addChild(this.entity);

    // Same lift as returnToBase: the flag starts standing on its pedestal.
    _base.copy(basePosition);
    _base.z += PEDESTAL_HEIGHT;
    this.setPosition(_base);
  }

  /** CTFFlag.setPosition — moves skin, trigger box and (originally) the light. */
  setPosition(position: Vector3): void {
    this.position.copy(position);
    this.entity.setLocalPosition(position.x, position.y, position.z + SKIN_HEIGHT * 0.5);
  }

  /** CTFFlag.returnToBase — back on top of its pedestal. */
  returnToBase(): void {
    this.state = 'atBase';
    this.carrier = null;
    _base.copy(this.basePosition);
    _base.z += PEDESTAL_HEIGHT;
    this.setPosition(_base);
    this.setAlpha(1);
    this.entity.enabled = true;
  }

  /** CTFFlag.dropAt */
  dropAt(position: Vector3): void {
    this.state = 'dropped';
    this.carrier = null;
    this.setPosition(position);
    this.setAlpha(1);
    this.entity.enabled = true;
  }

  /**
   * CTFFlag.setCarrier. The original halves the alpha for the LOCAL carrier
   * only (setLocalCarrier passes 0.5, setRemoteCarrier 1) so your own flag
   * does not block your view.
   */
  setCarrier(carrier: GameTank): void {
    this.state = 'carried';
    this.carrier = carrier;
    this.entity.enabled = true;
    this.setAlpha(carrier.isLocal ? 0.5 : 1);
  }

  private setAlpha(alpha: number): void {
    this.material.opacity = alpha;
    this.material.update();
  }

  /**
   * CTFFlag.render: a carried flag follows its carrier's turret mount point.
   * `camSimPos` billboards the quad around the vertical axis only — a flag
   * stands up, so it must not pitch toward the camera.
   */
  update(camSimPos: pc.Vec3): void {
    if (this.carrier != null) {
      this.carrier.getFlagMountWorldPosition(_mount);
      _mount.z += CARRY_Z_OFFSET;
      this.setPosition(_mount);
    }
    // Billboard around the vertical axis ONLY: a flag stands, so it must yaw
    // toward the camera without ever pitching over.
    const p = this.entity.getLocalPosition();
    const angle = Math.atan2(-(camSimPos.x - p.x), camSimPos.y - p.y);
    this.entity.setLocalEulerAngles(0, 0, (angle * 180) / Math.PI);
  }

  /**
   * CTFFlag.checkTrigger, reduced to the box overlap: does this tank touch the
   * flag? The original runs the contact through the collision detector and
   * then two static raycasts so a flag cannot be grabbed through a wall or a
   * floor; here the line of sight is checked by the caller, which owns the
   * detector.
   */
  overlaps(tankPosition: Vector3, tankHalfSize: { x: number; y: number; z: number }): boolean {
    const half = SKIN_BASE_SIZE * 0.5;
    const dx = Math.abs(tankPosition.x - this.position.x);
    const dy = Math.abs(tankPosition.y - this.position.y);
    if (dx > half + tankHalfSize.x || dy > half + tankHalfSize.y) {
      return false;
    }
    // Flag box spans [z, z + SKIN_HEIGHT]; the tank box is centred on its body.
    const flagBottom = this.position.z;
    const flagTop = this.position.z + SKIN_HEIGHT;
    const tankBottom = tankPosition.z - tankHalfSize.z;
    const tankTop = tankPosition.z + tankHalfSize.z;
    return tankTop >= flagBottom && tankBottom <= flagTop;
  }

  /**
   * Centre of the pickup box — what CTFFlag.checkTrigger casts its line-of-
   * sight ray at (the original reads collisionPrimitive.transform, which
   * setPosition puts at foot + half height).
   */
  centerZ(): number {
    return this.position.z + SKIN_HEIGHT * 0.5;
  }

  setVisible(visible: boolean): void {
    this.entity.enabled = visible;
  }
}

/** Shared scratch vectors — the original keeps a static flagPosition too. */
const _mount = new Vector3();
const _base = new Vector3();

/** Team colour of the flag a tank of this team must CAPTURE. */
export function enemyFlagTeam(team: TeamType): 'red' | 'blue' | null {
  if (team === 'red') return 'blue';
  if (team === 'blue') return 'red';
  return null;
}

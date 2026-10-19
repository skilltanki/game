// The follow camera: behind-the-turret placement, the Shaft sniper view, Q/E
// tilt, wall clipping (port of FollowCameraController), the spawn fly-in and
// the CameraShaker offset. Moved verbatim from main.ts; behavior is 1:1.
import * as pc from 'playcanvas';
import { Vector3 } from '../math/Vector3';
import { RayHit } from '../physics/collision/types/RayHit';
import { RESPAWN_DELAY_MS } from './respawn';
import type { TankPhysicsScene } from '../tank/TankPhysicsScene';
import type { GameTank } from '../game/GameTank';
import type { SpawnPoint } from '../map/SpawnPoints';
import type { ShakePreset } from './combat';
import type { CameraShaker } from '../game/CameraShaker';

/** simRoot scale: 1 sim unit = 0.01 world metres. */
const SIM_TO_WORLD = 0.01;
/** How far Q/E may tilt the view from its resting angle. */
const CAM_TILT_LIMIT = (35 * Math.PI) / 180;
/** Tilt rate, radians per second. */
const CAM_TILT_SPEED = (60 * Math.PI) / 180;
/**
 * Lowest the camera may sit, as an elevation above the tank. At 6 degrees it
 * ended up ~1 m up — below hull height — looking along the ground and under
 * the map edge at the out-of-bounds void; 15 degrees keeps it ~2.6 m up.
 */
const CAM_MIN_ELEVATION = (15 * Math.PI) / 180;
/** Highest, so Q never parks it on the turret roof. */
const CAM_MAX_ELEVATION = (62 * Math.PI) / 180;
/** Sniper eye: this far behind the muzzle along the barrel and this far above it (world metres), off the laser's axis. */
const SNIPER_EYE_BACK = 0.6;
const SNIPER_EYE_RISE = 0.4;
/** FollowCameraController.COLLIDER_RADIUS, in sim units. */
const CAMERA_SKIN = 50;
/**
 * How fast the follow camera's elevation follows the hull's slope, 1/s. The
 * owner's call, not the original's: FollowCameraController keeps its elevation
 * to the GROUND (flatDirection + baseElevation about a horizontal axis), so a
 * tank nosing up a hill was seen from under its tail; here the elevation is
 * kept to the HULL PLANE, so a tank on a slope is seen as on the flat.
 */
const SLOPE_FOLLOW_RATE = 6;
/**
 * The hull frame is for a tank ON its tracks: tilted this far from upright
 * (the hull's up against the world's) the frame starts blending back to the
 * world's, and from FRAME_WORLD_TILT on it IS the world's — an overturned
 * hull's up points down, and its frame put the camera under the ground,
 * staring up at the tracks. In the world frame the camera sits behind and
 * above as on the flat, looking at the tank, whichever way up it lies.
 */
const FRAME_HULL_TILT = (45 * Math.PI) / 180;
const FRAME_WORLD_TILT = (75 * Math.PI) / 180;
/** FollowCameraController.MIN_DISTANCE, in sim units. */
const CAMERA_MIN_DISTANCE = 300;
const CAMERA_FIXED_PITCH = (10 * Math.PI) / 180;
const CAMERA_MIN_ANGLE = (5 * Math.PI) / 180;
/** FollowCameraController.PITCH_CORRECTION_COEFF. */
const PITCH_CORRECTION_COEFF = 1;

export interface FollowCameraDeps {
  camera: pc.Entity;
  simRoot: pc.Entity;
  physicsScene: TankPhysicsScene;
  localPlayer: () => GameTank;
  /** Milliseconds the local player has been dead (drives the fly-in ease). */
  respawnTimerMs: () => number;
}

export class FollowCamera {
  // Manual camera tilt (Q/E) — the original's extraPitch term.
  camTiltUp = false;
  camTiltDown = false;
  /** Current manual tilt, radians; + looks down on the tank, - looks up. */
  private camExtraPitch = 0;
  /** Smoothed camera look yaw while Shaft targets (null = not targeting). */
  private shaftLookYaw: number | null = null;
  private readonly _hullUpSim = new pc.Vec3();
  private readonly _hullUpWorld = new pc.Vec3();
  /** Smoothed up of the follow view: the hull's (world up while sniping); the camera's frame is built on it. */
  private readonly _camUp = new pc.Vec3(0, 1, 0);
  /** The turret's forward laid onto the hull plane, and the resting camera offset built from both (world metres). */
  private readonly _hullFwd = new pc.Vec3();
  private readonly _camOffset = new pc.Vec3();
  private readonly _fwdSim = new pc.Vec3();
  private readonly _turretFwd = new pc.Vec3();
  private readonly camTarget = new pc.Vec3();
  private readonly forwardSim = new pc.Vec3();
  private readonly _shotDirSim = new Vector3();
  private readonly _shotDirWorld = new pc.Vec3();
  private readonly _muzzleSim = new Vector3();
  private readonly _muzzleWorld = new pc.Vec3();
  private readonly invSimRoot = new pc.Mat4();
  private readonly _camRayOrigin = new Vector3();
  private readonly _camRayDir = new Vector3();
  private readonly _camRayHit = new RayHit();
  private readonly _camPivotWorld = new pc.Vec3();
  private readonly _camPivotSim = new pc.Vec3();
  /** Vertical lift applied when the camera hit MIN_DISTANCE (world metres). */
  private _camLift = 0;
  private readonly shakeOffset = new Vector3();
  private readonly _shakeBase = new Vector3();

  // Spawn camera fly-in (player only): from the death view to behind the next spawn
  private readonly spawnCamera = {
    active: false,
    fromPos: new pc.Vec3(),
    fromTarget: new pc.Vec3(),
    toPos: new pc.Vec3(),
    toTarget: new pc.Vec3(),
  };

  private constructor(
    private readonly deps: FollowCameraDeps,
    private readonly cameraShaker: CameraShaker,
  ) {}

  /** Async: the CameraShaker port stays a lazy chunk, as it was in main.ts. */
  static async create(deps: FollowCameraDeps): Promise<FollowCamera> {
    // Camera shake (port of CameraShaker). The original drove it from the
    // network layer; here the game fires it on our own shots and on hits we take.
    const { CameraShaker } = await import('../game/CameraShaker');
    return new FollowCamera(deps, new CameraShaker());
  }

  shake(preset: ShakePreset): void {
    this.cameraShaker.setMaxTime(preset.ms);
    this.cameraShaker.setMaxRadius(preset.radius);
    this.cameraShaker.start();
  }

  /** Camera shake decays over its lifetime (port of CameraShaker). */
  updateShake(dtMs: number): void {
    this.cameraShaker.update(dtMs);
    if (this.cameraShaker.isActive()) {
      this._shakeBase.reset(0, 0, 0);
      this.cameraShaker.getCameraPosition(this._shakeBase, this.shakeOffset);
    }
  }

  private simToWorld(sim: { x: number; y: number; z: number }, out: pc.Vec3): pc.Vec3 {
    return this.deps.simRoot.getWorldTransform().transformPoint(new pc.Vec3(sim.x, sim.y, sim.z), out);
  }

  startSpawnFlyIn(spawn: SpawnPoint): void {
    const { camera } = this.deps;
    const spawnCamera = this.spawnCamera;
    spawnCamera.active = true;
    spawnCamera.fromPos.copy(camera.getPosition());
    camera.getWorldTransform().transformPoint(new pc.Vec3(0, 0, -10), spawnCamera.fromTarget);
    // Behind-the-tank pose for the upcoming spawn (same math as the follow camera)
    const spawnWorld = this.simToWorld(spawn.position, new pc.Vec3());
    // sim-space tank forward for yaw rz is (-sin rz, cos rz, 0)
    const forward = new pc.Vec3(-Math.sin(spawn.rotationZ), Math.cos(spawn.rotationZ), 0);
    this.deps.simRoot.getWorldTransform().transformVector(forward.clone(), forward);
    forward.y = 0;
    forward.normalize();
    spawnCamera.toPos.set(spawnWorld.x - forward.x * 9, spawnWorld.y + 4.5, spawnWorld.z - forward.z * 9);
    spawnCamera.toTarget.set(spawnWorld.x, spawnWorld.y + 1, spawnWorld.z);
  }

  cancelFlyIn(): void {
    this.spawnCamera.active = false;
  }

  /**
   * Port of FollowCameraController.getCollisionPoint / the collision part of
   * its camera placement.
   *
   * The original swept an EllipsoidCollider(50,50,50) from the tank toward the
   * camera and, on a hit, placed the camera at the contact point pushed out
   * along the surface normal by COLLIDER_RADIUS + 0.1. This port has no sweep,
   * so it raycasts the same segment and keeps the camera CAMERA_SKIN short of
   * the wall — the same effect for a camera that only ever moves along one
   * ray.
   *
   * Returns the distance (world metres) the camera may sit behind the tank.
   */
  /**
   * Port of FollowCameraController.getCollisionPoint: casts from the tank along
   * the camera's resting offset (back + up as ONE vector, already rotated by the
   * elevation and laid into the hull's frame) and returns the fraction of it
   * that survived, 0..1 — a hit seats the camera a skin's width off the wall,
   * sliding back AND down together so the viewing angle holds. Closer than
   * MIN_DISTANCE the original stops pulling in and lifts the camera straight up
   * by the shortfall instead (`_camLift`, world metres), which keeps it out of
   * the wall in a tight tunnel.
   */
  private clipCameraOffset(tankWorld: pc.Vec3, offset: pc.Vec3): number {
    const detector = this.deps.physicsScene.getCollisionDetector();
    this.invSimRoot.copy(this.deps.simRoot.getWorldTransform()).invert();
    this._camPivotWorld.set(tankWorld.x, tankWorld.y, tankWorld.z);
    this.invSimRoot.transformPoint(this._camPivotWorld, this._camPivotSim);
    this._camRayOrigin.reset(this._camPivotSim.x, this._camPivotSim.y, this._camPivotSim.z);
    const offsetLength = offset.length();
    // The lift is a per-frame result of THIS cast (a stale one kept the camera a metre high after a squeeze).
    this._camLift = 0;
    if (offsetLength < 1e-6) {
      return 1;
    }
    // World -> sim axes: simRoot is a uniform scale plus a -90 degree X rotation, so (x, y, z) maps to (x, -z, y).
    this._camRayDir.reset(offset.x, -offset.z, offset.y).scale(1 / offsetLength);
    const maxLength = offsetLength / SIM_TO_WORLD;
    if (!detector.raycastStatic(this._camRayOrigin, this._camRayDir, 0xffff, maxLength, null, this._camRayHit)) {
      return 1;
    }
    const hitLength = Math.max(0, this._camRayHit.t - CAMERA_SKIN);
    this._camLift = Math.max(0, CAMERA_MIN_DISTANCE - hitLength) * SIM_TO_WORLD;
    return Math.min(1, (hitLength * SIM_TO_WORLD) / offsetLength);
  }

  /**
   * Port of FollowCameraController.getPitchAngle.
   *
   * `t` is how much of the wanted camera distance survived the collision test
   * (1 = nothing in the way). As a wall squeezes the camera toward the tank,
   * the original tilted the view DOWN so the tank stayed framed instead of
   * the camera staring into the wall from point blank.
   *
   * Note: the original's `extraPitch` is always 0 — nothing in the decompile
   * ever writes it — so there is no key-driven camera tilt to port; all of the
   * tilt comes from this correction.
   */
  private static cameraPitchFor(t: number, dist: number, height: number): number {
    // baseElevation = atan2(back, up) of the camera offset (its own geometry)
    const baseElevation = Math.atan2(dist, height);
    const base = Math.max(0, baseElevation - CAMERA_FIXED_PITCH);
    if (t >= 1 || base < CAMERA_MIN_ANGLE) {
      return -base;
    }
    return -Math.atan2(
      t * dist,
      PITCH_CORRECTION_COEFF * dist * (1 / Math.tan(base) - (1 - t) / Math.tan(baseElevation)),
    );
  }

  /** Places the camera for this frame. Moved verbatim from the render pass. */
  renderTick(dt: number, shaftAim: number): void {
    const { camera, simRoot } = this.deps;
    const player = this.deps.localPlayer();
    const { camTarget, forwardSim, _shotDirSim, _shotDirWorld, _muzzleWorld, spawnCamera } = this;

    // Follow camera (world space) on the player's tank
    const tankPos = player.entity.getPosition();
    let spawnCameraHandled = false;
    if (spawnCamera.active && player.tank.isDead()) {
      spawnCameraHandled = true;
      // Spawn fly-in: ease from the death view toward the upcoming spawn point
      const t = Math.min(1, this.deps.respawnTimerMs() / RESPAWN_DELAY_MS);
      const s = t * t * (3 - 2 * t); // smoothstep
      const lift = Math.sin(s * Math.PI) * 6; // arc up and over
      // The wreck blast's shake must survive into the death camera: the
      // spawnPoint message starts this fly-in on the SAME frame as the kill,
      // so without the offset the victim never feels their own explosion.
      const flyShake = this.cameraShaker.isActive() ? SIM_TO_WORLD : 0;
      camera.setPosition(
        spawnCamera.fromPos.x + (spawnCamera.toPos.x - spawnCamera.fromPos.x) * s + this.shakeOffset.x * flyShake,
        spawnCamera.fromPos.y + (spawnCamera.toPos.y - spawnCamera.fromPos.y) * s + lift + this.shakeOffset.y * flyShake,
        spawnCamera.fromPos.z + (spawnCamera.toPos.z - spawnCamera.fromPos.z) * s + this.shakeOffset.z * flyShake,
      );
      camTarget.set(
        spawnCamera.fromTarget.x + (spawnCamera.toTarget.x - spawnCamera.fromTarget.x) * s,
        spawnCamera.fromTarget.y + (spawnCamera.toTarget.y - spawnCamera.fromTarget.y) * s,
        spawnCamera.fromTarget.z + (spawnCamera.toTarget.z - spawnCamera.fromTarget.z) * s,
      );
      camera.lookAt(camTarget);
    } else {
      // Follow camera: ALWAYS behind the TURRET (its interpolated world
      // forward), for every weapon — Z/X swing the view with the barrel
      player.turretEntity.getWorldTransform().transformVector(pc.Vec3.UP.clone().set(0, 1, 0), forwardSim);
      forwardSim.y = 0;
      if (forwardSim.lengthSq() > 1e-10) {
        forwardSim.normalize();
      } else {
        player.entity.getWorldTransform().transformVector(pc.Vec3.UP.clone().set(0, 1, 0), forwardSim);
        forwardSim.y = 0;
        forwardSim.normalize();
      }
      // Shaft targeting: the camera sits BEHIND THE TURRET and looks along
      // the barrel (you see the turret's back, not its side). Z/X mid-aim
      // pans the whole camera smoothly around the tank at a bounded rate —
      // the smoothed yaw is what killed the old frame flips.
      if (shaftAim > 0) {
        player.getShotDirection(_shotDirSim);
        _shotDirWorld.set(_shotDirSim.x, _shotDirSim.y, _shotDirSim.z);
        simRoot.getWorldTransform().transformVector(_shotDirWorld.clone(), _shotDirWorld);
        // simRoot carries the 0.01 metres-per-unit scale, so the transformed
        // vector comes out ~0.01 long. Reading a pitch off it without
        // normalising gave asin(0.003) ~ 0 — the slope silently vanished.
        _shotDirWorld.normalize();
        const barrelYaw = Math.atan2(_shotDirWorld.x, _shotDirWorld.z);
        if (this.shaftLookYaw == null) {
          // enter targeting from the hull view, pan toward the barrel
          this.shaftLookYaw = Math.atan2(forwardSim.x, forwardSim.z);
        }
        let step = Math.atan2(Math.sin(barrelYaw - this.shaftLookYaw), Math.cos(barrelYaw - this.shaftLookYaw));
        const maxStep = 3.2 * dt;
        step = Math.max(-maxStep, Math.min(maxStep, step));
        this.shaftLookYaw += step;
        // Smooth only the YAW, but KEEP the barrel's pitch: the sniper view
        // follows the laser, so a tank on a slope sights along its gun.
        const barrelPitch = Math.asin(Math.max(-1, Math.min(1, _shotDirWorld.y)));
        const cosPitch = Math.cos(barrelPitch);
        _shotDirWorld.set(
          Math.sin(this.shaftLookYaw) * cosPitch,
          Math.sin(barrelPitch),
          Math.cos(this.shaftLookYaw) * cosPitch,
        );
      } else {
        this.shaftLookYaw = null;
      }
    }
    if (!spawnCameraHandled) {
      // No aim: fixed behind the hull. Aiming: the hull pose below is only the
      // START of the transition — the sniper pose is AT THE GUN (further down),
      // and shaftAim blends the two, as the original's
      // ManualTargetingActivationState lerps the follow camera into
      // TargetingCameraController's pose over targetingTransitionTime.
      const camDir = shaftAim > 0 ? _shotDirWorld : forwardSim;
      const camDist = 9;
      const camHeight = 4.5;
      // Port of FollowCameraController.getCollisionPoint: cast from the tank
      // toward where the camera wants to sit and pull it in to the first wall,
      // so it never ends up inside the garage on canyon or outside the tunnel.
      // Only the DISTANCE is clipped — the direction (hull or smoothed barrel
      // yaw for the Shaft) is whatever the block above decided.
      // Q/E tilt is resolved BEFORE the collision test: the rotated offset is
      // the one that has to clear the geometry. Testing the resting offset and
      // rotating afterwards let Q push the camera through a tunnel ceiling and
      // E drop it under the floor into the out-of-bounds void.
      // Sniper mode owns the camera: Q/E are ignored while aiming and the
      // tilt is blended OUT by shaftAim below, but the value itself is KEPT,
      // so the view returns to the player's own tilt after the shot (it used
      // to be zeroed here, which snapped the camera to the resting angle).
      if (shaftAim <= 0 && this.camTiltUp !== this.camTiltDown) {
        // Q raises the camera over the turret (bigger elevation angle, so it
        // also moves CLOSER in plan); E drops it toward the ground behind.
        const dir = this.camTiltUp ? 1 : -1;
        this.camExtraPitch = Math.max(
          -CAM_TILT_LIMIT,
          Math.min(CAM_TILT_LIMIT, this.camExtraPitch + dir * CAM_TILT_SPEED * dt),
        );
      }
      const restLen = Math.hypot(camDist, camHeight) || 1e-6;
      // The HULL FRAME (see SLOPE_FOLLOW_RATE; the owner's call, not the
      // original's, which keeps the elevation to the ground and never rolls):
      // the camera sits behind and above the tank in the hull's own plane, so
      // a tank on any slope — climbing, across it, or diagonal — is seen as on
      // the flat. Up is the hull's up, smoothed (bumps and suspension would
      // shake the view); forward is the TURRET's horizontal forward laid onto
      // the hull plane (the camera follows the turret, as always). Separate
      // pitch and roll terms were tried first and left the camera out of the
      // hull's symmetry plane on a diagonal slope.
      player.entity.getWorldTransform().transformVector(this._hullUpSim.set(0, 0, 1), this._hullUpWorld);
      this._hullUpWorld.normalize();
      // How much of the hull's frame applies (see FRAME_HULL_TILT): 1 upright, 0 past FRAME_WORLD_TILT.
      const hullShare = Math.max(0, Math.min(1, (this._hullUpWorld.y - Math.cos(FRAME_WORLD_TILT)) / (Math.cos(FRAME_HULL_TILT) - Math.cos(FRAME_WORLD_TILT))));
      const frameShare = hullShare * (1 - shaftAim);
      const upK = Math.min(1, SLOPE_FOLLOW_RATE * dt);
      this._camUp.x += (this._hullUpWorld.x * frameShare - this._camUp.x) * upK;
      this._camUp.y += (this._hullUpWorld.y * frameShare + (1 - frameShare) - this._camUp.y) * upK;
      this._camUp.z += (this._hullUpWorld.z * frameShare - this._camUp.z) * upK;
      if (this._camUp.lengthSq() > 1e-6) this._camUp.normalize();
      else this._camUp.set(0, 1, 0);
      const up = this._camUp;
      // The turret's forward in 3D already lies in the hull plane (the turret
      // turns about the hull's up). Flattening it to the horizontal first and
      // laying THAT back onto the plane is not the same thing: with pitch and
      // roll together it comes out yawed toward the uphill side (26 deg of
      // pitch and 18 of roll: 7 deg, the camera 1.1 m beside the hull's
      // symmetry plane, measured). Only the sniper blend keeps the flat
      // direction, whose yaw is the smoothed barrel's.
      player.turretEntity.getWorldTransform().transformVector(this._fwdSim.set(0, 1, 0), this._turretFwd);
      if (this._turretFwd.lengthSq() > 1e-10) this._turretFwd.normalize();
      else this._turretFwd.copy(camDir);
      const base = shaftAim > 0 ? camDir : this._turretFwd;
      const alongUp = base.x * up.x + base.y * up.y + base.z * up.z;
      this._hullFwd.set(base.x - up.x * alongUp, base.y - up.y * alongUp, base.z - up.z * alongUp);
      if (this._hullFwd.lengthSq() > 1e-6) this._hullFwd.normalize();
      else this._hullFwd.copy(camDir);
      const fwd = this._hullFwd;
      // Clamp the RESULTING elevation (to the hull plane), not just the tilt
      // offset: below CAM_MIN_ELEVATION the camera sinks under the tank and
      // looks up through the floor at the out-of-bounds void, and above
      // CAM_MAX_ELEVATION it ends up straight over the roof again.
      const wantAngle = Math.max(
        CAM_MIN_ELEVATION,
        Math.min(CAM_MAX_ELEVATION, Math.atan2(camHeight, camDist) + this.camExtraPitch * (1 - shaftAim)),
      );
      const wantDist = Math.cos(wantAngle) * restLen;
      const wantHeight = Math.sin(wantAngle) * restLen;
      // The resting offset in world metres: back along the hull-plane forward, up along the hull's up.
      this._camOffset.set(
        -fwd.x * wantDist + up.x * wantHeight,
        -fwd.y * wantDist + up.y * wantHeight,
        -fwd.z * wantDist + up.z * wantHeight,
      );
      const camT = this.clipCameraOffset(tankPos, this._camOffset);
      // Pitch correction only matters when a wall actually squeezed the camera.
      // Disabled while the Shaft is aiming: sniper mode owns the whole camera
      // (its look-ahead target and zoom), and nudging the pitch there would
      // throw the shot off the laser line.
      // Whatever the collision test kept, applied to the WHOLE offset so the
      // camera slides along its (already tilted) offset instead of only moving in.
      const tiltedDist = wantDist * camT;
      // Obstacle correction only — the Q/E tilt is already expressed by the
      // rotated offset above, so adding it here too would double-count it.
      const pitchCorrection =
        shaftAim > 0
          ? 0
          : FollowCamera.cameraPitchFor(camT, wantDist, wantHeight) -
            FollowCamera.cameraPitchFor(1, wantDist, wantHeight);
      // CameraShaker offset (sim units -> world metres via the simRoot scale)
      const shake = this.cameraShaker.isActive() ? SIM_TO_WORLD : 0;
      // The hull pose: behind the hull in its own frame, wall-clipped, Q/E-tilted; the wall lift is the world's up.
      const hullX = tankPos.x + this._camOffset.x * camT;
      const hullY = tankPos.y + this._camOffset.y * camT + this._camLift;
      const hullZ = tankPos.z + this._camOffset.z * camT;
      // The correction tilts the look target DOWN by dropping it: at the
      // squeezed distance that keeps the tank in frame instead of the wall.
      const lookDrop = Math.tan(-pitchCorrection) * Math.max(tiltedDist, 0.1);
      const lift = 1 - lookDrop;
      const hullTargetX = tankPos.x + fwd.x + up.x * lift;
      const hullTargetY = tankPos.y + fwd.y + up.y * lift;
      const hullTargetZ = tankPos.z + fwd.z + up.z * lift;
      // The sniper pose, the original's TargetingCameraController: the camera
      // sits AT THE GUN (setLocalPosition(getBarrelOrigin()), anchored to the
      // turret) and looks along the barrel, pitched by the elevation. So the
      // sight IS the laser line — no hull between the eye and the target. The
      // old third-person pose (5.5 m behind, 2.9 m up in WORLD axes, looking
      // along the barrel) put the hull's own rear in the picture whenever the
      // gun pointed downhill (hill: aiming down the slope showed the tank's
      // tail instead of the enemy).
      let x = hullX;
      let y = hullY;
      let z = hullZ;
      if (shaftAim > 0) {
        player.getMuzzleWorldPosition(this._muzzleSim);
        this.simToWorld(this._muzzleSim, _muzzleWorld);
        // Not ON the laser's axis: a beam looked at along its own axis is a
        // point, and the sight vanished. The eye sits a little above and
        // behind the muzzle, the view stays parallel to the barrel, so the
        // beam reads as a line running up into the spot (the original's
        // barrel origin is the gun's base, behind the muzzle, under a reticle).
        const eyeX = _muzzleWorld.x - _shotDirWorld.x * SNIPER_EYE_BACK;
        const eyeY = _muzzleWorld.y - _shotDirWorld.y * SNIPER_EYE_BACK + SNIPER_EYE_RISE;
        const eyeZ = _muzzleWorld.z - _shotDirWorld.z * SNIPER_EYE_BACK;
        x += (eyeX - hullX) * shaftAim;
        y += (eyeY - hullY) * shaftAim;
        z += (eyeZ - hullZ) * shaftAim;
      }
      camera.setPosition(x + this.shakeOffset.x * shake, y + this.shakeOffset.z * shake, z - this.shakeOffset.y * shake);
      // The look target: the hull view's point a metre over the tank, blended
      // into a point far along the barrel from the eye — along the laser, so
      // on a slope the sight pitches with the gun (the shot and the sight
      // agreed within the barrel's pitch before; now they are one line).
      const SNIPER_LOOK_AHEAD = 30;
      camTarget.set(
        hullTargetX + (x + _shotDirWorld.x * SNIPER_LOOK_AHEAD - hullTargetX) * shaftAim,
        hullTargetY + (y + _shotDirWorld.y * SNIPER_LOOK_AHEAD - hullTargetY) * shaftAim,
        hullTargetZ + (z + _shotDirWorld.z * SNIPER_LOOK_AHEAD - hullTargetZ) * shaftAim,
      );
      camera.lookAt(camTarget, this._camUp);
    }
    // Shaft zoom (original CameraFovCalculator initialFOV -> minimumFOV);
    // no crosshair overlay — the laser line IS the sight
    camera.camera!.fov = 45 - 27 * shaftAim;
  }
}

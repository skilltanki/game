// Port of the original Dust
//
// Dust kicked up from under the tracks. Per physics step, every suspension ray
// that is touching the ground and moving faster than `minSpeed` has a `density`
// chance of spawning one puff at the contact point, thrown BACKWARD along the
// hull's local X (the original flips a (100,0,0) bias per side) and upward.
//
// Differences from the original:
//  - the soft-transparency camera gate and the object pool are dropped (our
//    HitEffects owns pooling and the blend mode);
//  - LimitedDistanceAnimatedSpriteEffect's near/far distance fade is dropped —
//    particles just live out their lifetime;
//  - intensity/alpha scaling per particle becomes the puff's size scale, since
//    the flipbook material here has no per-instance alpha multiplier.

import { Matrix3 } from '../math/Matrix3';
import { Vector3 } from '../math/Vector3';
import type { Tank } from '../tank/Tank';
import type { Track } from '../tank/Track';
import * as pc from 'playcanvas';
import type { HitEffects } from '../weapon/HitEffects';

/**
 * Dust.CHANCE — per-ray chance each step. The ProTanki map data carries this
 * per map (visual.dustDensity, 0.15 on every summer map), so callers pass it
 * in; this is the fallback for maps with no visual block.
 */
const DEFAULT_DENSITY = 0.2;
/** Dust.addTankDust's default minimum ray speed. */
const MIN_SPEED = 100;
/** Minimum speed while the tracks counter-rotate (a spin in place still smokes). */
const MIN_SPEED_TURNING = 5;
/** Dust.SCALE_JITTER */
const SCALE_JITTER = 1;
/** Dust.bias — thrown backward along the hull's local X, sign flipped per side. */
const BIAS_X = 100;

const _bias = new Vector3();
const _particleVelocity = new Vector3();
const _particlePosition = new Vector3();

/** Dust.addJitter */
function addJitter(v: Vector3, amount: number): void {
  v.x += (Math.random() - 0.5) * 2 * amount;
  v.y += (Math.random() - 0.5) * 2 * amount;
  v.z += (Math.random() - 0.5) * 2 * amount;
}

export class Dust {
  enabled = true;

  /** Sprite-sheet key registered in HitEffects. */
  private readonly sheetKey: string;
  private readonly effects: HitEffects;
  /** Dust.dustSize — base puff size in sim units. */
  private readonly dustSize: number;
  private readonly lifetimeMs: number;
  /** Tank -> Dust.tanks value (boundSphereRadius / 600). */
  private readonly tanks = new Map<Tank, number>();

  /**
   * Dust colour. The original took a per-map `dustParticle` resource from the
   * server (sand on sand maps, snow on winter ones); that resource is not in
   * this asset dump, so the puff's alpha shape is reused and painted this
   * colour instead — dry light sand, NOT the black death smoke.
   */
  private readonly tint: pc.Color;
  /** Per-step emission chance per ray (visual.dustDensity). */
  private readonly density: number;

  constructor(
    effects: HitEffects,
    sheetKey: string,
    dustSize = 90,
    lifetimeMs = 700,
    tint = new pc.Color(0.78, 0.70, 0.55),
    density = DEFAULT_DENSITY,
  ) {
    this.density = density;
    this.effects = effects;
    this.sheetKey = sheetKey;
    this.dustSize = dustSize;
    this.lifetimeMs = lifetimeMs;
    this.tint = tint;
  }

  /** Dust.addTank: the scale factor is the tank's bound sphere over 600. */
  addTank(tank: Tank, boundSphereRadius: number): void {
    this.tanks.set(tank, boundSphereRadius / 600);
  }

  removeTank(tank: Tank): void {
    this.tanks.delete(tank);
  }

  /** Dust.update — call once per physics step. */
  update(): void {
    if (!this.enabled) {
      return;
    }
    for (const tank of this.tanks.keys()) {
      if (!tank.isDead()) {
        this.addTankDust(tank);
      }
    }
  }

  /** Dust.addTankDust */
  private addTankDust(tank: Tank): void {
    const scale = this.tanks.get(tank);
    if (scale == null) {
      return;
    }
    const left = tank.chassis.leftTrack;
    const right = tank.chassis.rightTrack;
    // Counter-rotating tracks (turning in place) still raise dust at low speed
    const minSpeed = left.animationSpeed * right.animationSpeed < 0 ? MIN_SPEED_TURNING : MIN_SPEED;

    const base = tank.getBody().baseMatrix;
    _bias.x = -BIAS_X;
    _bias.y = 0;
    _bias.z = 0;
    transform(base, _bias, _particleVelocity);
    this.addTrackDust(left, scale, _particleVelocity, minSpeed);

    _bias.x = BIAS_X;
    transform(base, _bias, _particleVelocity);
    this.addTrackDust(right, scale, _particleVelocity, minSpeed);
  }

  /** Dust.addTrackDust */
  private addTrackDust(track: Track, scale: number, velocity: Vector3, minSpeed: number): void {
    for (let i = 0; i < track.numRays; i++) {
      const ray = track.rays[i];
      const speed = ray.speed;
      if (speed > minSpeed && Math.random() < this.density) {
        // Original: alpha 1 above 500, ramping in below — here it scales size
        const strength = speed > 500 ? 1 : 0.3 + speed / 712;
        _particlePosition.copy(ray.getGlobalOrigin());
        addJitter(_particlePosition, 50);
        velocity.z = 100;
        addJitter(velocity, 20);
        this.createDustParticle(scale, _particlePosition, velocity, strength);
      }
    }
  }

  /** Dust.createDustParticle */
  private createDustParticle(scale: number, position: Vector3, velocity: Vector3, strength: number): void {
    const size = this.dustSize * scale * (1 + SCALE_JITTER * Math.random());
    this.effects.spawnJetParticle(
      this.sheetKey,
      position,
      size * strength,
      size * strength * 1.8, // puffs expand as they trail off
      this.lifetimeMs,
      { x: velocity.x, y: velocity.y, z: velocity.z },
      this.tint,
    );
  }
}

/** Matrix3.transformVector without allocating. */
function transform(m: Matrix3, v: Vector3, out: Vector3): void {
  out.x = m.m00 * v.x + m.m01 * v.y + m.m02 * v.z;
  out.y = m.m10 * v.x + m.m11 * v.y + m.m12 * v.z;
  out.z = m.m20 * v.x + m.m21 * v.y + m.m22 * v.z;
}

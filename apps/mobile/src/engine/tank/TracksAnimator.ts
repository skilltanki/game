// Port of the original TracksAnimator
//
// Drives the per-side track belt speed. Two regimes, exactly as the original:
//  - the track has contacts and the hull is upright → belt speed follows the
//    REAL ground speed of the middle suspension ray (so the belt matches the
//    surface and visibly slips when the tank is pushed or spins out), unless
//    that speed is too small to read, in which case it falls back to a
//    minimum "intent" speed from the control state;
//  - no contacts (airborne / on its side) → belt speed ramps to the intended
//    direction times the smoothed max speed.
//
// Differences from the original: none in the algorithm. `skin.updateTracks` is
// implemented by TankSkin over PlayCanvas UV buffers instead of
// the original engine's Vertex objects.

import { Vector3 } from '../math/Vector3';
import { Body } from '../physics/Body';
import { MathUtils } from './MathUtils';
import { Track } from './Track';
import { TrackedChassis } from './TrackedChassis';
import { ValueSmoother } from './ValueSmoother';

const MIN_TRACK_SPEED = 100;

const _bodyPointVelocity = new Vector3();

/** The visual side of the animator — TankSkin implements it. */
export interface TracksAnimationTarget {
  /** TankSkin.updateTracks(left, right): belt travel in mesh units this frame. */
  updateTracks(left: number, right: number): void;
}

export class TracksAnimator {
  private readonly chassis: TrackedChassis;
  private readonly skin: TracksAnimationTarget;
  private readonly maxSpeedSmoother: ValueSmoother;

  constructor(chassis: TrackedChassis, skin: TracksAnimationTarget, maxSpeedSmoother: ValueSmoother) {
    this.chassis = chassis;
    this.skin = skin;
    this.maxSpeedSmoother = maxSpeedSmoother;
  }

  /** TracksAnimator.animate */
  animate(dt: number): void {
    this.calculateTracksAnimationSpeed(dt);
    this.skin.updateTracks(dt * this.chassis.leftTrack.animationSpeed, dt * this.chassis.rightTrack.animationSpeed);
  }

  private calculateTracksAnimationSpeed(dt: number): void {
    this.calculateTrackAnimationSpeed(this.chassis.leftTrack, dt);
    this.calculateTrackAnimationSpeed(this.chassis.rightTrack, dt);
  }

  private calculateTrackAnimationSpeed(track: Track, dt: number): void {
    if (this.hasCorrectContacts(track)) {
      this.animateTrackWithContacts(track, dt);
    } else {
      this.animateTrackWithoutContacts(track, dt);
    }
  }

  /** Upright (baseMatrix.m22 > 0) and touching something. */
  private hasCorrectContacts(track: Track): boolean {
    return track.body.baseMatrix.m22 > 0 && track.numContacts > 0;
  }

  private animateTrackWithContacts(track: Track, dt: number): void {
    const speed = this.getTrackSpeed(track);
    if (this.requiresSynchronizedAnimation(track, speed)) {
      track.animationSpeed = speed;
    } else {
      const target = this.getDesiredSpeedCoeff(track) * MIN_TRACK_SPEED;
      track.setAnimationSpeed(target, this.chassis.getAcceleration() * dt);
    }
  }

  /**
   * Longitudinal speed of the middle suspension ray's origin relative to the
   * surface it stands on, projected on the hull's forward axis (baseMatrix
   * column 1 = local +Y).
   */
  private getTrackSpeed(track: Track): number {
    const surfaceVelocity = track.averageSurfaceVelocity;
    const middleRay = track.rays[track.numRays >> 1];
    getBodyPointVelocity(track.body, middleRay.getGlobalOrigin(), _bodyPointVelocity);
    const vx = _bodyPointVelocity.x - surfaceVelocity.x;
    const vy = _bodyPointVelocity.y - surfaceVelocity.y;
    const vz = _bodyPointVelocity.z - surfaceVelocity.z;
    const base = track.body.baseMatrix;
    return vx * base.m01 + vy * base.m11 + vz * base.m21;
  }

  /**
   * True when the measured ground speed is meaningful: fast enough to read, or
   * the player wants no motion, or the measured direction opposes the intent
   * (wheels spinning the other way — show the real thing).
   */
  private requiresSynchronizedAnimation(track: Track, speed: number): boolean {
    const desired = this.getDesiredSpeedCoeff(track);
    return (
      Math.abs(speed) > 0.8 * MIN_TRACK_SPEED ||
      desired === 0 ||
      MathUtils.numberSign(speed, 1) * MathUtils.sign(desired) === -1
    );
  }

  /**
   * Intended belt direction from the control state, in [-1, 1]:
   * pure turn → sides counter-rotate at half speed; pure drive → both full;
   * drive + turn → outer side 1, inner side 0.5.
   */
  private getDesiredSpeedCoeff(track: Track): number {
    const movement = this.chassis.getActualMovementDirection();
    const turn = this.chassis.getActualTurnDirection();
    if (movement === 0) {
      return track.side * turn * 0.5;
    }
    if (turn === 0) {
      return movement;
    }
    return (movement * (3 + track.side * turn)) / 4;
  }

  private animateTrackWithoutContacts(track: Track, dt: number): void {
    const desired = this.getDesiredSpeedCoeff(track);
    track.setAnimationSpeed(desired * this.maxSpeedSmoother.getTargetValue(), this.chassis.getAcceleration() * dt);
  }
}

/** TracksAnimator.getBodyPointVelocity: v + ω × r */
function getBodyPointVelocity(body: Body, point: Vector3, out: Vector3): void {
  const position = body.state.position;
  const rx = point.x - position.x;
  const ry = point.y - position.y;
  const rz = point.z - position.z;
  const omega = body.state.angularVelocity;
  out.x = omega.y * rz - omega.z * ry;
  out.y = omega.z * rx - omega.x * rz;
  out.z = omega.x * ry - omega.y * rx;
  const velocity = body.state.velocity;
  out.x += velocity.x;
  out.y += velocity.y;
  out.z += velocity.z;
}

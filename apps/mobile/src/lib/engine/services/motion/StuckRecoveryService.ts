// A hull that wants to move but does not (wedged on a prop, nose against a
// wall, tracks on a lip) backs out for a moment with a turn, then the
// navigator re-plans from wherever it ended up.
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import type { Rng } from '../../../../classes/engine/Rng';
import type { BotPerception } from '../../../../model/Perception';
import type { SteerResult } from './PathFollowService';

const STUCK_SPEED = 40;
/** On a steep (marginal) floor the hull crawls at 35-50 u/s and is NOT stuck. */
const STUCK_SPEED_STEEP = 12;
/** Below this yaw rate (rad/s) a slow hull is not pivoting either. */
const STUCK_YAW_RATE = 0.25;
const STUCK_AFTER_S = 1;
const REVERSE_FOR_S = 1.3;
/** After backing out, do not call "stuck" again for this long. */
const GRACE_S = 2.5;

export class StuckRecoveryService {
  /** Hook per recovery episode, with where it happened (set through a method: di-kit accessors do not forward field writes). */
  private onStuck: ((actorId: string, at: { x: number; y: number; z: number }, now: number) => void) | null = null;

  public setOnStuck = (hook: ((actorId: string, at: { x: number; y: number; z: number }, now: number) => void) | null): void => {
    this.onStuck = hook;
  };

  /**
   * Returns a steer while a recovery is running, else null. `wantsToMove`
   * tells whether standing still is intentional (holding a post, aiming).
   */
  public update = (perception: BotPerception, memory: BotMemory, rng: Rng, wantsToMove: boolean, dtSec: number, steep = false): SteerResult | null => {
    const self = perception.self;
    memory.navStateTime += dtSec;
    if (memory.navState === 'reverse') {
      if (memory.navStateTime >= memory.navStateDuration) {
        memory.navState = 'drive';
        memory.navStateTime = 0;
        memory.navStateDuration = GRACE_S;
        memory.stuckTime = 0;
        // Whatever path we were on is stale now; plan afresh.
        memory.follower.reset();
        return null;
      }
      return { move: -0.7, turn: memory.turnDirection };
    }
    const speed = Math.hypot(self.velocity.x, self.velocity.y, self.velocity.z);
    const yawDelta = Math.atan2(Math.sin(self.heading - memory.lastHeading), Math.cos(self.heading - memory.lastHeading));
    memory.lastHeading = self.heading;
    const yawRate = dtSec > 0 ? Math.abs(yawDelta) / dtSec : 0;
    const inGrace = memory.navStateTime < memory.navStateDuration;
    if (wantsToMove && speed < (steep ? STUCK_SPEED_STEEP : STUCK_SPEED) && yawRate < STUCK_YAW_RATE && !inGrace) {
      memory.stuckTime += dtSec;
      if (memory.stuckTime > STUCK_AFTER_S) {
        memory.navState = 'reverse';
        memory.navStateTime = 0;
        memory.navStateDuration = REVERSE_FOR_S;
        memory.stuckTime = 0;
        memory.turnDirection = rng.chance(0.5) ? -1 : 1;
        memory.lastStuckAt = perception.now;
        this.onStuck?.(self.id, self.position, perception.now);
        return { move: -0.7, turn: memory.turnDirection };
      }
    } else {
      memory.stuckTime = 0;
    }
    return null;
  };
}

export default StuckRecoveryService;

// The trigger finger of a bot: turns the gunner's "on target" verdict into
// what the mounted weapon actually needs. Most turrets fire while the trigger
// is HELD (the weapon paces itself by its reload), so the verdict is the
// trigger. A Shaft fires on RELEASE: a held trigger is the sniper charge
// (the hull stands still, the barrel is aimed by hand) and the shot goes out
// when the finger lets go — a bot that simply held it never fired until it
// lost its target, and that was the moment it was looking the wrong way.
// So for such a weapon the finger taps: a quick tap up close, a longer
// charge at range, released while still on target (or a little later, if the
// target slipped away mid-charge), with the barrel's pitch set at the target.
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import type { BotPerception } from '../../../../model/Perception';
import type { GunnerResult } from './GunnerService';

/** Up to this distance a release-to-fire weapon just taps (the quick shot: < 200 ms held). */
const QUICK_RANGE = 3000;
/** Out at the gunner's reach the charge is held this long (sim ms); linear in between. */
const CHARGE_AT_RANGE_MS = 1500;
const CHARGE_RANGE = 8000;
/** A tap is this long (two or three physics steps: under the Shaft's 200 ms quick-shot threshold). */
const TAP_MS = 80;
/** A charge is released at most this much later than planned when the target slipped out of the sights (the shot goes where the barrel points). */
const RELEASE_GRACE_MS = 400;

export interface TriggerResult {
  fire: boolean;
  /** Manual barrel pitch for a sniper charge, radians relative to the hull; null = the weapon's own vertical aim. */
  pitch: number | null;
}

export class TriggerService {
  public decide = (perception: BotPerception, memory: BotMemory, gun: GunnerResult): TriggerResult => {
    const self = perception.self;
    if (!self.firesOnRelease) {
      memory.triggerDown = false;
      return { fire: gun.fire, pitch: null };
    }
    const now = perception.now;
    if (!memory.triggerDown) {
      // Press only with a full gauge (the weapon would otherwise ignore the trigger until it refilled, and then charge on its own).
      if (!gun.fire || gun.target == null || self.weaponStatus < 1) return { fire: false, pitch: null };
      const t = gun.target.position;
      const distance = Math.hypot(t.x - self.position.x, t.y - self.position.y, t.z - self.position.z);
      const charge = Math.min(1, Math.max(0, (distance - QUICK_RANGE) / (CHARGE_RANGE - QUICK_RANGE)));
      memory.triggerDown = true;
      memory.triggerDownSince = now;
      memory.triggerHoldMs = distance <= QUICK_RANGE ? TAP_MS : TAP_MS + charge * CHARGE_AT_RANGE_MS;
    }
    const held = now - memory.triggerDownSince;
    const planned = held >= memory.triggerHoldMs;
    // Release on plan while still on target; a target that slipped away gets a short grace, then the shot goes anyway.
    if (planned && (gun.fire || held >= memory.triggerHoldMs + RELEASE_GRACE_MS)) {
      memory.triggerDown = false;
      return { fire: false, pitch: null };
    }
    // A charge is hand-aimed: the barrel's pitch goes at the aim point (a quick tap is too short to matter and gets the weapon's own vertical aim).
    const pitch = memory.triggerHoldMs > TAP_MS && gun.aimPoint != null ? self.gunElevationTo(gun.aimPoint) : null;
    return { fire: true, pitch };
  };
}

export default TriggerService;

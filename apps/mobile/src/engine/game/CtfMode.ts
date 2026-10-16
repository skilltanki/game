// Capture the Flag: the rules, ported from the ProTanki server's
// CaptureTheFlagModeHandler + CtfBattleHandler (which is where the authority
// for each transition lives) and the client's CTFModel.
//
// The original splits this across client and server: the CLIENT detects that a
// tank touched a flag and sends TriggerFlag, the SERVER decides what that
// touch means and broadcasts the result. Single-player collapses both halves
// into this class, but the split is kept visible — `triggerFlag` is exactly
// the server's handler, so a networked build can call it on the host and
// replay the outcome through the same `on*` callbacks.
//
// Difference from the original: FLAG_PICKUP_LOCK_DURATION (5 s) exists to stop
// a carrier who just dropped a flag from instantly re-grabbing it. It is kept
// per-tank-per-flag rather than globally.
import * as pc from 'playcanvas';
import { Vector3 } from '../math/Vector3';
import { CtfFlag, enemyFlagTeam } from './CtfFlag';
import type { GameTank } from './GameTank';
import type { CtfFlagPositions } from '../map/CtfFlags';
import { TankState } from './TankRoster';

/** CTFModel.FLAG_PICKUP_LOCK_DURATION */
const PICKUP_LOCK_MS = 5000;

export type CtfEvent =
  | { kind: 'taken'; team: 'red' | 'blue'; by: GameTank }
  | { kind: 'dropped'; team: 'red' | 'blue'; by: GameTank }
  | { kind: 'returned'; team: 'red' | 'blue'; by: GameTank | null }
  | { kind: 'delivered'; team: 'red' | 'blue'; by: GameTank };

/**
 * Which flag you carry and where you take it.
 *
 *  'ctf'     — steal the ENEMY flag, bring it to YOUR base (classic)
 *  'assault' — carry YOUR OWN flag to the ENEMY base (the original's
 *              BattleMode.AS; AssaultModel.flagDelivered returns the
 *              delivered flag to its own pedestal, same as here)
 */
export type FlagRules = 'ctf' | 'assault';

export class CtfMode {
  readonly flags: Record<'red' | 'blue', CtfFlag>;
  /** Classic capture-the-flag unless told otherwise. */
  rules: FlagRules = 'ctf';
  /** Fired on every state change, for the HUD, the kill log and sounds. */
  onEvent: ((event: CtfEvent) => void) | null = null;
  /** Credits a point to a team; wired to BattleScore. */
  onScore: ((team: 'red' | 'blue') => void) | null = null;

  /** Per-tank lock: sim time until which this tank may not pick flags up. */
  private readonly pickupLockUntil = new TankState<number>();

  constructor(flags: Record<'red' | 'blue', CtfFlag>) {
    this.flags = flags;
  }

  static create(
    positions: CtfFlagPositions,
    textures: { red: pc.Texture; blue: pc.Texture },
    simRoot: pc.Entity,
  ): CtfMode {
    return new CtfMode({
      red: new CtfFlag('red', positions.red, textures.red, simRoot),
      blue: new CtfFlag('blue', positions.blue, textures.blue, simRoot),
    });
  }

  /**
   * Port of CtfBattleHandler.triggerFlag — the full decision table for one
   * tank touching one flag. Returns true when something happened.
   */
  triggerFlag(flagTeam: 'red' | 'blue', tank: GameTank, now: number): boolean {
    const flag = this.flags[flagTeam];
    const team = tank.tank.team;
    if (team !== 'red' && team !== 'blue') {
      return false;
    }
    const lockedUntil = this.pickupLockUntil.get(tank) ?? 0;

    // Which flag may this tank pick up?
    const canCarry = this.rules === 'assault' ? team === flag.team : team !== flag.team;
    if (canCarry) {
      if (flag.state === 'carried' || now < lockedUntil) {
        return false;
      }
      flag.setCarrier(tank);
      this.onEvent?.({ kind: 'taken', team: flagTeam, by: tank });
      return true;
    }

    // Standing at my own base while carrying the enemy flag -> deliver.
    //
    // Differs from CtfBattleHandler.triggerFlag, which scores only when YOUR
    // flag is on its pedestal (`flag is FlagOnPedestalState`). A capture now
    // counts even while your own flag is stolen: with one carrier per side
    // that rule deadlocks both teams.
    const enemyTeam = enemyFlagTeam(team);
    if (enemyTeam != null) {
      const enemyFlag = this.flags[enemyTeam];
      if (enemyFlag.state === 'carried' && enemyFlag.carrier === tank) {
        enemyFlag.returnToBase();
        this.onScore?.(team);
        this.onEvent?.({ kind: 'delivered', team, by: tank });
        return true;
      }
    }
    return false;
  }

  /**
   * A carrier lost the flag: it returns to its pedestal immediately.
   *
   * Differs from CtfBattleHandler.dropFlag, which leaves a reachable flag
   * lying where the carrier fell (its `isRaycast` branch) for teammates to
   * grab. Resetting instead means a kill always undoes the run, rather than
   * the next attacker finishing it by walking into the dropped flag.
   *
   * The position/recoverable parameters are kept because a server sends them.
   */
  dropCarriedFlag(tank: GameTank, _position: Vector3, _recoverable: boolean, now: number): void {
    for (const team of ['red', 'blue'] as const) {
      const flag = this.flags[team];
      if (flag.state !== 'carried' || flag.carrier !== tank) {
        continue;
      }
      // Two events, in the order a server expects them: the carrier DROPPED
      // the flag (CtfBattleHandler.dropFlag), and the flag then RETURNED to
      // its pedestal (returnFlag). A networked build forwards both; locally
      // the drop is informational, since the flag never rests on the ground.
      this.onEvent?.({ kind: 'dropped', team, by: tank });
      flag.returnToBase();
      this.onEvent?.({ kind: 'returned', team, by: null });
      // The dropper cannot immediately snatch it back off the pedestal.
      this.pickupLockUntil.set(tank, now + PICKUP_LOCK_MS);
      return;
    }
  }

  /**
   * Is this tank standing on its own pedestal while carrying the enemy flag?
   *
   * Delivery cannot be driven by touching your own FLAG, the way taking one
   * is: when your flag has been stolen there is nothing at the base to touch.
   * The pedestal position is fixed, so the base itself is the trigger.
   */
  tryDeliverAtBase(tank: GameTank, position: Vector3, radius: number): boolean {
    const team = tank.tank.team;
    if (team !== 'red' && team !== 'blue') {
      return false;
    }
    const otherTeam = enemyFlagTeam(team);
    if (otherTeam == null) {
      return false;
    }
    // CTF scores at your own pedestal; assault at the enemy's.
    const goalTeam = this.rules === 'assault' ? otherTeam : team;
    // CTF delivers the enemy's flag; assault delivers your own.
    const cargoTeam = this.rules === 'assault' ? team : otherTeam;

    const base = this.flags[goalTeam].basePosition;
    const dx = position.x - base.x;
    const dy = position.y - base.y;
    if (dx * dx + dy * dy > radius * radius) {
      return false;
    }
    const cargo = this.flags[cargoTeam];
    if (cargo.state !== 'carried' || cargo.carrier !== tank) {
      return false;
    }
    // AssaultModel.flagDelivered calls returnFlag: a scored flag goes home.
    cargo.returnToBase();
    this.onScore?.(team);
    this.onEvent?.({ kind: 'delivered', team, by: tank });
    return true;
  }

  /**
   * The CHECK half of tryDeliverAtBase, with no mutation: a networked client
   * detects "standing on the goal with the cargo" and sends a claim; the
   * server owns the score.
   */
  isAtGoalWithCargo(tank: GameTank, position: Vector3, radius: number): boolean {
    const team = tank.tank.team;
    if (team !== 'red' && team !== 'blue') {
      return false;
    }
    const otherTeam = enemyFlagTeam(team);
    if (otherTeam == null) {
      return false;
    }
    const goalTeam = this.rules === 'assault' ? otherTeam : team;
    const cargoTeam = this.rules === 'assault' ? team : otherTeam;
    const base = this.flags[goalTeam].basePosition;
    const dx = position.x - base.x;
    const dy = position.y - base.y;
    if (dx * dx + dy * dy > radius * radius) {
      return false;
    }
    const cargo = this.flags[cargoTeam];
    return cargo.state === 'carried' && cargo.carrier === tank;
  }

  /**
   * Holds a tank off the flags for a moment.
   *
   * Assault starts every carrier standing ON their own pedestal, so without
   * this the flags are picked up on the spawn frame, before anyone has moved.
   * Reuses the original's FLAG_PICKUP_LOCK_DURATION rather than inventing a
   * second timer.
   */
  lockPickup(tank: GameTank, now: number): void {
    this.pickupLockUntil.set(tank, now + PICKUP_LOCK_MS);
  }

  /** True when this tank is carrying a flag. */
  carriedBy(tank: GameTank): 'red' | 'blue' | null {
    for (const team of ['red', 'blue'] as const) {
      if (this.flags[team].carrier === tank) {
        return team;
      }
    }
    return null;
  }

  update(camSimPos: pc.Vec3): void {
    this.flags.red.update(camSimPos);
    this.flags.blue.update(camSimPos);
  }
}

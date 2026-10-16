// The ONE control surface of a tank.
//
// Every tank in a battle — the human on the touch screen, a bot, a remote
// peer over the mesh — is driven by a stream of these. Nothing else may
// touch a GameTank's movement, turret or trigger (see TankDriverService).
// The struct is plain data: it serializes as-is for the network.

export type Axis = -1 | 0 | 1;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type SupplyKind = 'health' | 'armor' | 'damage' | 'nitro' | 'nuclear';

export const SUPPLY_KINDS: SupplyKind[] = ['health', 'armor', 'damage', 'nitro', 'nuclear'];

export interface TankCommand {
  /**
   * Drive, -1..1. The chassis integrates `move * acceleration`, so an analog
   * stick gives proportional acceleration (top speed stays the hull's).
   */
  move: number;
  /** Turn, -1..1; +1 = LEFT (the original left-minus-right convention). */
  turn: number;
  /** Invert turning while reversing (original BIT_REVERSE_TURN). */
  reverseBackTurn: boolean;
  /** Turret buttons: +1 left, -1 right. Ignored when turretTarget is set. */
  turret: Axis;
  /** Turret "centre" button held. */
  turretCenter: boolean;
  /**
   * World point the turret should traverse toward (bots, drag-aim, remote
   * aim). null = the turret buttons drive it.
   */
  turretTarget: Vec3Like | null;
  /**
   * World point the SHOT is fired at (the engine's aim assist). null = along
   * the barrel with the original vertical auto-aim.
   */
  aimPoint: Vec3Like | null;
  /** Shaft sniper mode: manual barrel pitch in radians; null = automatic. */
  pitch: number | null;
  /** Trigger held. */
  fire: boolean;
  /** One-shot supply request; consumed by the driver on the tick it arrives. */
  supply: SupplyKind | null;
  /** Self-destruct button held (the 5 s hold runs in the respawn system). */
  selfDestruct: boolean;
  /** Camera tilt (local presentation only; never leaves the device). */
  cameraTilt: Axis;
}

export const IDLE_COMMAND: Readonly<TankCommand> = Object.freeze({
  move: 0,
  turn: 0,
  reverseBackTurn: false,
  turret: 0,
  turretCenter: false,
  turretTarget: null,
  aimPoint: null,
  pitch: null,
  fire: false,
  supply: null,
  selfDestruct: false,
  cameraTilt: 0,
});

export function createCommand(partial: Partial<TankCommand> = {}): TankCommand {
  return { ...IDLE_COMMAND, ...partial };
}

export function cloneCommand(command: TankCommand): TankCommand {
  return {
    ...command,
    turretTarget: command.turretTarget == null ? null : { ...command.turretTarget },
    aimPoint: command.aimPoint == null ? null : { ...command.aimPoint },
  };
}

/** Quantises an analog axis to the original -1/0/+1 keyboard convention. */
export function quantiseAxis(value: number, deadZone = 0.2): Axis {
  if (value > deadZone) return 1;
  if (value < -deadZone) return -1;
  return 0;
}

/** True when two commands would drive the tank identically (used to dedupe network sends). */
export function commandsEqual(a: TankCommand, b: TankCommand): boolean {
  return (
    a.move === b.move &&
    a.turn === b.turn &&
    a.reverseBackTurn === b.reverseBackTurn &&
    a.turret === b.turret &&
    a.turretCenter === b.turretCenter &&
    vecEqual(a.turretTarget, b.turretTarget) &&
    vecEqual(a.aimPoint, b.aimPoint) &&
    a.pitch === b.pitch &&
    a.fire === b.fire &&
    a.supply === b.supply &&
    a.selfDestruct === b.selfDestruct &&
    a.cameraTilt === b.cameraTilt
  );
}

function vecEqual(a: Vec3Like | null, b: Vec3Like | null): boolean {
  if (a == null || b == null) {
    return a === b;
  }
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

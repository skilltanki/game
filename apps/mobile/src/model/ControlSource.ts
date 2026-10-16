// Where a tank's commands come from.
//
// The battle loop never asks a source for a command directly: every source
// PUSHES commands into a sink (the actor's CommandBuffer) whenever it has
// one, stamped with the simulation tick it is meant for. The loop then takes
// the newest command at or before the current tick. This is the same API for
// all three producers, and it is asynchronous by design:
//
//   touch   — pushes on every pointer change (and once per tick as a keepalive);
//   bot     — pushes from its `tick()` hook, in lockstep with the physics;
//   remote  — pushes whenever a packet arrives over the mesh, possibly late,
//             possibly out of order (the buffer sorts by tick).
import type { TankCommand } from './TankCommand';

export type ControlSourceKind = 'touch' | 'bot' | 'remote' | 'none';

export interface CommandSink {
  /** Delivers a command for the given tick (default: the next tick). */
  push(command: TankCommand, tick?: number): void;
}

export interface ControlSourceEnv {
  /** The actor this source drives. */
  actorId: string;
  /** Current simulation tick (read live). */
  currentTick(): number;
}

export interface ControlSource {
  readonly kind: ControlSourceKind;
  /**
   * Begins producing into the sink. Resolves once the source is ready
   * (a remote source resolves after its handshake).
   */
  start(sink: CommandSink, env: ControlSourceEnv): Promise<void>;
  /**
   * Optional lockstep hook, called once per fixed physics step BEFORE the
   * step is simulated. Bots think here; a touch source uses it as keepalive.
   */
  tick?(tick: number, dtSec: number): void;
  stop(): void;
}

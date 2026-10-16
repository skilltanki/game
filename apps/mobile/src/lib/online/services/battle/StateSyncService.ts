// The movement stream: this machine publishes every tank it DRIVES (its own,
// plus the bots when it is the host): the command on every change plus a
// keepalive, the pose at 15 Hz. The replicas follow what their owners
// publish: between physics steps (beforeStep) the latest pose is BLENDED in
// — half the remaining gap per step, so a 15 Hz feed reads as continuous
// motion rather than a twitch every 66 ms — and the owner's velocities and
// turret are taken as is, so the replica's chassis keeps integrating from
// the owner's state on the owner's last command. A gap too large to blend
// (a spawn, a teleport, a lost packet burst) snaps. A silent owner (250 ms
// without a pose) has its replica held still and its command cleared.
import type { BattleBridge } from '../../../../model/online/BattleBridge';
import { commandsEqual, type TankCommand } from '../../../../model/TankCommand';
import type { PeerWire, WirePose } from '../../../../model/online/wire';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type MeshService from '../rtc/MeshService';
import type RemoteControlService from './RemoteControlService';

/** Every n-th step publishes the pose (33 ms steps: 2 → 15 Hz). */
const POSE_EVERY_STEPS = 2;
/** A command repeats at least this often even when unchanged (a lost fast packet). */
const COMMAND_KEEPALIVE_STEPS = 10;
/** No pose for this long: the replica is frozen where it stands. */
const STALE_FREEZE_MS = 250;
/** The fraction of the remaining gap closed per step (two steps per pose: 75% by the next one). */
const BLEND_PER_STEP = 0.5;
/** Steps a pose keeps being blended in after it arrived (then the next one takes over). */
const BLEND_STEPS = 3;
/** Beyond this distance (sim units) the replica snaps instead of sliding. */
const SNAP_DISTANCE = 300;

interface Incoming {
  pose: WirePose;
  seq: number;
  atMs: number;
  /** Blend steps left for this pose (0 = settled). */
  stepsLeft: number;
  frozen: boolean;
}

interface Outgoing {
  lastCommand: TankCommand | null;
  lastCommandTick: number;
}

export class StateSyncService {
  private readonly meshService = inject<MeshService>(TYPES.meshService);
  private readonly remoteControlService = inject<RemoteControlService>(TYPES.remoteControlService);

  private bridge: BattleBridge | null = null;
  private readonly outgoing = new Map<string, Outgoing>();
  private readonly incoming = new Map<string, Incoming>();
  /** How far a replica was from its owner's pose when the latest pose arrived (sim units), for the report. */
  public lastCorrection = 0;
  /** Poses that had to snap (gap > SNAP_DISTANCE), for the report. */
  public snaps = 0;

  public start = (bridge: BattleBridge): void => {
    this.bridge = bridge;
    this.outgoing.clear();
    this.incoming.clear();
    this.lastCorrection = 0;
    this.snaps = 0;
  };

  public stop = (): void => {
    this.bridge = null;
    this.incoming.clear();
    this.outgoing.clear();
  };

  /** A stream packet (`cmd` / `pose`) for actor `id`; the caller has checked the sender owns it. */
  public receive = (id: string, message: PeerWire, nowMs: number): void => {
    switch (message.t) {
      case 'cmd':
        this.remoteControlService.deliver(id, message.tick, message.cmd);
        break;
      case 'pose': {
        const current = this.incoming.get(id);
        if (current != null && current.seq > message.tick) return;
        this.incoming.set(id, { pose: message.pose, seq: message.tick, atMs: nowMs, stepsLeft: BLEND_STEPS, frozen: false });
        break;
      }
      default:
        break;
    }
  };

  /** Before a physics step: the replicas move toward their owners' latest poses. */
  public beforeStep = (nowMs: number): void => {
    const bridge = this.bridge;
    if (bridge == null) return;
    for (const [id, entry] of this.incoming) {
      if (!bridge.has(id) || bridge.owns(id)) continue;
      if (entry.stepsLeft > 0) {
        entry.stepsLeft--;
        const target = entry.pose;
        // A pose from a previous life (before the host's spawn reached us) is noise.
        if (target.inc < bridge.incarnationOf(id)) continue;
        const current = bridge.readPose(id);
        const gap = current == null ? Infinity : distance(current.p, target.p);
        const snap = gap > SNAP_DISTANCE || target.inc > bridge.incarnationOf(id);
        if (entry.stepsLeft === BLEND_STEPS - 1) {
          this.lastCorrection = Number.isFinite(gap) ? gap : 0;
          if (snap) this.snaps++;
        }
        bridge.applyPose(id, target, snap ? 1 : BLEND_PER_STEP);
      } else if (!entry.frozen && nowMs - entry.atMs > STALE_FREEZE_MS) {
        entry.frozen = true;
        bridge.freezeReplica(id);
        this.remoteControlService.idle(id);
      }
    }
  };

  /** After a physics step: publish the command and pose of every tank this machine drives. */
  public afterStep = (tick: number): void => {
    const bridge = this.bridge;
    if (bridge == null) return;
    for (const id of bridge.ownedIds()) {
      let out = this.outgoing.get(id);
      if (out == null) {
        out = { lastCommand: null, lastCommandTick: -1 };
        this.outgoing.set(id, out);
      }
      const command = bridge.commandOf(id);
      if (command != null) {
        const changed = out.lastCommand == null || !commandsEqual(command, out.lastCommand);
        if (changed || tick - out.lastCommandTick >= COMMAND_KEEPALIVE_STEPS || command.supply != null) {
          this.meshService.broadcast({ t: 'cmd', id, tick, cmd: { ...command, cameraTilt: 0 } }, false);
          out.lastCommand = command;
          out.lastCommandTick = tick;
        }
      }
      if (tick % POSE_EVERY_STEPS === 0) {
        const pose = bridge.readPose(id);
        if (pose != null) {
          this.meshService.broadcast({ t: 'pose', id, tick, pose }, false);
        }
      }
    }
  };

  /** Milliseconds since the last pose for `id` arrived (Infinity before the first). */
  public poseAgeMs = (id: string, nowMs: number): number => {
    const entry = this.incoming.get(id);
    return entry == null ? Infinity : nowMs - entry.atMs;
  };

  /** An actor is gone (or became ours): forget its stream. */
  public forget = (id: string): void => {
    this.incoming.delete(id);
    this.outgoing.delete(id);
  };
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export default StateSyncService;

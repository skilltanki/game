// The HOST's half of the battle rules. The host's own weapons apply damage
// locally as in single player; the other peers send what THEIR weapons hit
// and the host applies it. Deaths (weapon, drowning, self-destruct) are
// decided here and announced with `kill`; the respawn timer, the spawn point
// and the incarnation are the host's; so are the clock, the score, the flag
// events and the final whistle. Every message carries the host epoch.
import type { BattleBridge, DamageClaim, DamageVerdict } from '../../../../model/online/BattleBridge';
import type { DeathCause } from '../../../../model/BattleEvents';
import type { AuthorityWire, HitMessage, PeerWire, SyncMessage } from '../../../../model/online/wire';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type MeshService from '../rtc/MeshService';
import type RoomSessionService from '../room/RoomSessionService';
import type DamageRuleService from './DamageRuleService';

/** Mirrors engine/logic/respawn.ts RESPAWN_DELAY_MS (the engine's death lifecycle is off while online). */
const RESPAWN_DELAY_MS = 2500;
/** Everybody's health goes out this often (ms); the kits and Isida heal on every machine in between. */
const HEALTH_ALL_EVERY_MS = 500;
/** A burning / chilled tank is announced at most this often (the jets hit ten times a second; the effect lasts 2.5 s). */
const STATUS_REPEAT_MS = 500;
const STATUS_TURRETS: Record<string, 'burn' | 'freeze'> = { Firebird: 'burn', Freeze: 'freeze' };

export class AuthorityService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly meshService = inject<MeshService>(TYPES.meshService);
  private readonly roomSessionService = inject<RoomSessionService>(TYPES.roomSessionService);
  private readonly damageRuleService = inject<DamageRuleService>(TYPES.damageRuleService);

  private bridge: BattleBridge | null = null;
  /** Sim time a tank died (host decides the respawn 2.5 s later). */
  private readonly deadSince = new Map<string, number>();
  /** Tanks whose health changed since the last flush. */
  private readonly dirtyHealth = new Set<string>();
  private lastHealthAllMs = 0;
  private lastClockSecond = -2;
  private finished = false;
  /** Last announcement per "<id>:<kind>", sim ms. */
  private readonly statusSentAt = new Map<string, number>();
  private nowMs = 0;

  public get active(): boolean {
    return this.bridge != null;
  }

  public start = (bridge: BattleBridge, nowMs: number): void => {
    this.stop();
    this.bridge = bridge;
    this.deadSince.clear();
    this.dirtyHealth.clear();
    this.lastHealthAllMs = nowMs;
    this.lastClockSecond = -2;
    this.finished = false;
    this.statusSentAt.clear();
    this.nowMs = nowMs;
    this.damageRuleService.reset();
    // Tanks already dead when the host seat arrives (a migration): their timers start now.
    for (const id of bridge.tankIds()) {
      if (bridge.isDead(id)) this.deadSince.set(id, nowMs);
    }
    bridge.setDamageInterceptor(this.intercept);
    bridge.setOnDeath(this.onDeath);
    bridge.setOnFlag((event) => {
      this.broadcast({ t: 'flag', e: this.epoch, ...event });
      // A delivery moved the team score.
      if (event.kind === 'delivered') this.broadcastScore();
    });
    bridge.setOnSuicide(() => this.suicide(bridge.localId));
    bridge.setFlagAuthority(true);
    bridge.setClockAuthority(true);
    this.loggerService.log('authority: host', bridge.localId, 'epoch', this.epoch);
    // Everyone learns the host's view of things at once.
    this.broadcast(this.syncMessage());
  };

  public stop = (): void => {
    const bridge = this.bridge;
    if (bridge == null) return;
    bridge.setDamageInterceptor(null);
    bridge.setOnDeath(null);
    bridge.setOnFlag(null);
    bridge.setOnSuicide(null);
    bridge.setFlagAuthority(false);
    bridge.setClockAuthority(false);
    this.bridge = null;
  };

  /** A claim from a peer (hit, suicide, hello). */
  public receive = (from: string, message: PeerWire): void => {
    const bridge = this.bridge;
    if (bridge == null) return;
    switch (message.t) {
      case 'hit':
        this.applyHit(from, message);
        break;
      case 'suicide':
        this.suicide(from);
        break;
      case 'hello':
        // A peer's battle is loaded, or its link came back: the host's whole view.
        this.meshService.send(from, this.syncMessage());
        break;
      default:
        break;
    }
  };

  /** A peer joined while the battle runs: its tank gets a spawn everybody uses. */
  public spawnNewcomer = (id: string, nowMs: number): void => {
    this.deadSince.delete(id);
    this.spawn(id, nowMs);
  };

  /** A seat changed hands (a tank is now a bot on `owner`'s machine, a bot moved, or its player is back): everybody updates its seat table. */
  public announceSeat = (id: string, bot: boolean, owner: string | null): void => {
    this.damageRuleService.forget(id);
    this.broadcast({ t: 'seat', e: this.epoch, id, bot, owner: owner ?? undefined });
  };

  /** A link to a peer (re)opened during the battle: it gets the host's view without asking. */
  public resync = (peerId: string): void => {
    if (this.bridge != null) this.meshService.send(peerId, this.syncMessage());
  };

  /** After every physics step: respawns, drownings, the clock, the health digest. */
  public step = (nowMs: number): void => {
    const bridge = this.bridge;
    if (bridge == null) return;
    this.nowMs = nowMs;
    for (const id of bridge.tankIds()) {
      if (bridge.isDead(id)) {
        const since = this.deadSince.get(id);
        if (since == null) {
          this.deadSince.set(id, nowMs);
        } else if (nowMs - since >= RESPAWN_DELAY_MS) {
          this.spawn(id, nowMs);
        }
      } else if (bridge.heightOf(id) < bridge.killZ()) {
        bridge.kill(id, bridge.creditFor(id), 'drown');
        // A drowning respawns at once (the engine's rule).
        this.deadSince.set(id, nowMs - RESPAWN_DELAY_MS);
      }
    }
    if (this.dirtyHealth.size > 0) {
      for (const id of this.dirtyHealth) {
        if (bridge.has(id)) this.broadcast({ t: 'health', e: this.epoch, id, hp: bridge.healthOf(id) });
      }
      this.dirtyHealth.clear();
    }
    if (nowMs - this.lastHealthAllMs >= HEALTH_ALL_EVERY_MS) {
      this.lastHealthAllMs = nowMs;
      this.broadcast({ t: 'hpAll', e: this.epoch, hp: bridge.tankIds().map((id) => [id, bridge.healthOf(id), bridge.incarnationOf(id)]) });
    }
    const msLeft = bridge.clockMsLeft();
    const second = msLeft == null ? -1 : Math.ceil(msLeft / 1000);
    if (second !== this.lastClockSecond) {
      this.lastClockSecond = second;
      this.broadcast({ t: 'clock', e: this.epoch, msLeft });
    }
    if (msLeft != null && msLeft <= 0) this.finish('time');
  };

  /**
   * The final whistle, once: everybody hears `finish` and the lobby hears
   * `finished`. The clock calls it at zero; the battle session calls it for
   * any other end on the host (so a host-side finish never leaves the
   * replicas playing on).
   */
  public finish = (reason: 'time' | 'left'): void => {
    if (this.bridge == null || this.finished) return;
    this.finished = true;
    this.broadcast({ t: 'finish', e: this.epoch, reason });
    this.roomSessionService.reportPhase('finished');
  };

  // --- internals ----------------------------------------------------------------------

  private get epoch(): number {
    return this.roomSessionService.hostEpoch;
  }

  /** The weapons this machine drives (its own, its bots): apply here; a replica's weapon firing on this machine: ignore. */
  private intercept = (claim: DamageClaim): DamageVerdict => {
    const bridge = this.bridge;
    if (bridge == null) return 'local';
    if (claim.sourceId != null && bridge.owns(claim.sourceId)) {
      this.dirtyHealth.add(claim.targetId);
      // The engine sets the status on this machine (statusAuthority); the others hear it from us.
      if (!claim.heal) this.announceStatus(claim.targetId, STATUS_TURRETS[bridge.turretOf(claim.sourceId)]);
      return 'local';
    }
    return 'drop';
  };

  /** Burn / freeze from a hit: everybody is told, at most twice a second per tank and kind. */
  private announceStatus(targetId: string, kind: 'burn' | 'freeze' | undefined): void {
    if (kind == null) return;
    const key = `${targetId}:${kind}`;
    const last = this.statusSentAt.get(key);
    if (last != null && this.nowMs - last < STATUS_REPEAT_MS) return;
    this.statusSentAt.set(key, this.nowMs);
    this.broadcast({ t: 'status', e: this.epoch, id: targetId, kind });
  }

  private applyHit(from: string, message: HitMessage): void {
    const bridge = this.bridge!;
    // The sender's own tank, or a bot the sender drives — nobody else's.
    const shooter = message.shooter ?? from;
    if (!bridge.has(shooter) || !this.roomSessionService.speaksFor(from, shooter)) return;
    // A shot from a previous life (the shooter died before its claim arrived).
    if (message.inc < bridge.incarnationOf(shooter)) return;
    const status = STATUS_TURRETS[message.turret];
    // Not on faith: clamped to the weapon, within its reach, no faster than it reloads.
    const targets = this.damageRuleService.check(bridge, shooter, message.targets, this.nowMs);
    let dealt = 0;
    for (const target of targets) {
      if (!bridge.has(target.id) || target.inc < bridge.incarnationOf(target.id)) continue;
      if (!(target.amount > 0)) continue;
      bridge.applyDamage({ sourceId: shooter, targetId: target.id, amount: target.amount, splash: target.splash === true, heal: target.heal === true });
      this.dirtyHealth.add(target.id);
      if (!target.heal) dealt += target.amount;
      // The shooter's turret decides the status; the host applies it here and tells everyone (the shooter included).
      if (status != null && !target.heal && !bridge.isDead(target.id)) {
        bridge.applyStatus(target.id, status);
        this.announceStatus(target.id, status);
      }
    }
    // Vampirism (Isida): the shooter's self-heal is the HOST's to compute, as the original server did — the shooter's
    // machine shows its own heal at once, but only this one survives the health digest (it used to roll back).
    const selfHeal = bridge.weaponLimits(shooter).selfHealFraction;
    if (dealt > 0 && selfHeal > 0 && !bridge.isDead(shooter)) {
      bridge.applyDamage({ sourceId: shooter, targetId: shooter, amount: dealt * selfHeal, splash: false, heal: true });
      this.dirtyHealth.add(shooter);
    }
  }

  private suicide(id: string): void {
    const bridge = this.bridge;
    if (bridge == null || !bridge.has(id) || bridge.isDead(id)) return;
    bridge.kill(id, bridge.creditFor(id), 'selfDestruct');
  }

  /** Every death recorded on the host; the respawn timer starts on the next step (a drowning pre-dates it so it respawns at once). */
  private onDeath = (victimId: string, killerId: string | null, cause: DeathCause): void => {
    const bridge = this.bridge;
    if (bridge == null) return;
    this.broadcast({ t: 'kill', e: this.epoch, victim: victimId, killer: killerId, cause });
    this.broadcastScore();
  };

  private spawn(id: string, nowMs: number): void {
    const bridge = this.bridge!;
    const inc = bridge.incarnationOf(id) + 1;
    const { p, rz } = bridge.pickSpawn(id);
    bridge.respawnAt(id, inc, p, rz);
    this.deadSince.delete(id);
    this.broadcast({ t: 'spawn', e: this.epoch, id, inc, p, rz });
    void nowMs;
  }

  private broadcastScore(): void {
    const bridge = this.bridge!;
    const { rows, red, blue } = bridge.readScore();
    this.broadcast({ t: 'score', e: this.epoch, rows, red, blue });
  }

  private syncMessage(): SyncMessage {
    const bridge = this.bridge!;
    const { rows, red, blue } = bridge.readScore();
    return {
      t: 'sync',
      e: this.epoch,
      tanks: bridge.tankIds().map((id) => {
        const pose = bridge.readPose(id);
        return { id, inc: bridge.incarnationOf(id), hp: bridge.healthOf(id), dead: bridge.isDead(id), p: pose?.p ?? [0, 0, 0], rz: pose == null ? 0 : yawOf(pose.o) };
      }),
      rows,
      red,
      blue,
      msLeft: bridge.clockMsLeft(),
      flags: bridge.readFlags(),
    };
  }

  private broadcast(message: AuthorityWire): void {
    this.meshService.broadcast(message, true);
  }
}

/** Yaw about Z of a (w, x, y, z) quaternion. */
function yawOf([w, x, y, z]: [number, number, number, number]): number {
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

export default AuthorityService;

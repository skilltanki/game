// A non-host peer's half of the rules: its own weapons only CLAIM (the hits
// go to the host, batched per step), a replica's weapon firing on this
// machine is dropped, and the host's word (health, kills, spawns, score,
// clock, flags, finish, sync) is applied as it arrives. Messages from anyone
// but the current host, or with an old epoch, are ignored.
import type { BattleBridge, DamageClaim, DamageVerdict } from '../../../../model/online/BattleBridge';
import { AUTHORITY_KINDS, type AuthorityWire, type HitTarget, type PeerWire } from '../../../../model/online/wire';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type MeshService from '../rtc/MeshService';
import type RoomSessionService from '../room/RoomSessionService';
import type OnlineEventService from '../room/OnlineEventService';

export class ReplicaService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly meshService = inject<MeshService>(TYPES.meshService);
  private readonly roomSessionService = inject<RoomSessionService>(TYPES.roomSessionService);
  private readonly onlineEventService = inject<OnlineEventService>(TYPES.onlineEventService);

  private bridge: BattleBridge | null = null;
  /** Hits claimed this step, per shooter this machine drives (its own tank, its bots). */
  private pendingHits = new Map<string, HitTarget[]>();

  public get active(): boolean {
    return this.bridge != null;
  }

  public start = (bridge: BattleBridge): void => {
    this.stop();
    this.bridge = bridge;
    this.pendingHits.clear();
    bridge.setDamageInterceptor(this.intercept);
    bridge.setOnDeath(null);
    bridge.setOnFlag(null);
    bridge.setOnSuicide(() => this.toHost({ t: 'suicide' }));
    bridge.setFlagAuthority(false);
    bridge.setClockAuthority(false);
    this.loggerService.log('replica of host', this.roomSessionService.hostId, 'epoch', this.roomSessionService.hostEpoch);
    this.toHost({ t: 'hello' });
  };

  public stop = (): void => {
    const bridge = this.bridge;
    if (bridge == null) return;
    bridge.setDamageInterceptor(null);
    bridge.setOnSuicide(null);
    this.bridge = null;
  };

  /** The host's word. */
  public receive = (from: string, message: PeerWire): void => {
    const bridge = this.bridge;
    if (bridge == null || !AUTHORITY_KINDS.has(message.t)) return;
    const authority = message as AuthorityWire;
    if (from !== this.roomSessionService.hostId || authority.e < this.roomSessionService.hostEpoch) return;
    switch (authority.t) {
      case 'health':
        if (bridge.has(authority.id)) bridge.setHealth(authority.id, authority.hp);
        break;
      case 'hpAll':
        for (const [id, hp, inc] of authority.hp) {
          if (!bridge.has(id)) continue;
          if (inc > bridge.incarnationOf(id)) bridge.setIncarnation(id, inc);
          bridge.setHealth(id, hp);
        }
        break;
      case 'kill':
        if (bridge.has(authority.victim) && !bridge.isDead(authority.victim)) {
          bridge.kill(authority.victim, authority.killer != null && bridge.has(authority.killer) ? authority.killer : null, authority.cause);
        }
        break;
      case 'spawn':
        if (bridge.has(authority.id)) bridge.respawnAt(authority.id, authority.inc, authority.p, authority.rz);
        break;
      case 'score':
        bridge.setStats(authority.rows, authority.red, authority.blue);
        break;
      case 'clock':
        bridge.setClock(authority.msLeft);
        break;
      case 'flag':
        bridge.applyFlag({ kind: authority.kind, flag: authority.flag, byId: authority.byId });
        break;
      case 'finish':
        bridge.finish(authority.reason);
        break;
      case 'status':
        if (bridge.has(authority.id)) bridge.applyStatus(authority.id, authority.kind);
        break;
      case 'seat':
        this.roomSessionService.setSeatBot(authority.id, authority.bot, authority.owner ?? null);
        this.onlineEventService.emit('seat', { id: authority.id, bot: authority.bot, owner: authority.owner ?? null });
        break;
      case 'sync':
        for (const tank of authority.tanks) {
          if (!bridge.has(tank.id)) continue;
          if (tank.dead) {
            if (!bridge.isDead(tank.id)) bridge.kill(tank.id, null, 'weapon');
            bridge.setIncarnation(tank.id, tank.inc);
          } else {
            bridge.respawnAt(tank.id, tank.inc, tank.p, tank.rz);
            bridge.setHealth(tank.id, tank.hp);
          }
        }
        bridge.setStats(authority.rows, authority.red, authority.blue);
        bridge.setClock(authority.msLeft);
        for (const { flag, carrier } of authority.flags) {
          bridge.applyFlag(carrier != null && bridge.has(carrier) ? { kind: 'taken', flag, byId: carrier } : { kind: 'returned', flag, byId: null });
        }
        break;
      default:
        break;
    }
  };

  /** After every physics step: the hits the weapons this machine drives claimed go to the host, one message per shooter. */
  public afterStep = (): void => {
    const bridge = this.bridge;
    if (bridge == null || this.pendingHits.size === 0) return;
    for (const [shooter, targets] of this.pendingHits) {
      if (!bridge.has(shooter)) continue;
      this.toHost({ t: 'hit', shooter, inc: bridge.incarnationOf(shooter), turret: bridge.turretOf(shooter), targets });
    }
    this.pendingHits.clear();
  };

  /** The link to the host came back: ask for its view again. */
  public resync = (): void => {
    if (this.bridge != null) this.toHost({ t: 'hello' });
  };

  // --- internals ----------------------------------------------------------------------

  private intercept = (claim: DamageClaim): DamageVerdict => {
    const bridge = this.bridge;
    if (bridge == null) return 'local';
    // Only the tanks this machine drives (its own, the bots it was given) may claim.
    if (claim.sourceId == null || !bridge.owns(claim.sourceId)) return 'drop';
    // Isida on yourself (vampirism): shown at once here; the host computes the same heal from the accepted damage, so the digest keeps it.
    if (claim.heal && claim.targetId === claim.sourceId) return 'local';
    let targets = this.pendingHits.get(claim.sourceId);
    if (targets == null) {
      targets = [];
      this.pendingHits.set(claim.sourceId, targets);
    }
    targets.push({ id: claim.targetId, inc: bridge.incarnationOf(claim.targetId), amount: claim.amount, splash: claim.splash || undefined, heal: claim.heal || undefined });
    return 'drop';
  };

  private toHost(message: PeerWire): void {
    const hostId = this.roomSessionService.hostId;
    if (hostId != null) this.meshService.send(hostId, message, true);
  }
}

export default ReplicaService;

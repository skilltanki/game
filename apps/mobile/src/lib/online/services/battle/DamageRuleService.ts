// The host's sanity check of a hit claim. A peer's machine says what its
// weapon hit and for how much (the shooter rolls the dice, as in the
// original); the host does not take the figure on faith: every hit is
// clamped to what that weapon can do in one hit (its balance figure, the
// shooter's damage supply, a margin for the roll), a target out of the
// weapon's reach is dropped, and a shooter that claims shots faster than its
// reload (or stream tick) has the extra ones dropped. A shot may still hit
// several tanks at once (a Railgun's penetration, Thunder's splash, a jet's
// cone), so hits arriving within one short window count as the same shot.
import type { BattleBridge } from '../../../../model/online/BattleBridge';
import type { HitTarget } from '../../../../model/online/wire';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

/** Hits this close together (ms) belong to the same shot (one physics step is 33 ms). */
const SAME_SHOT_MS = 120;
/** Reach slack: the shooter's poses lag the host by a step or two, and hulls are not points. */
const RANGE_SLACK = 1.25;
const RANGE_PAD_UNITS = 600;

interface ShooterRecord {
  lastShotAt: number;
  /** Targets already hit by the current shot. */
  shotTargets: Set<string>;
  dropped: number;
  clamped: number;
}

export class DamageRuleService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private readonly shooters = new Map<string, ShooterRecord>();
  /** Counters for the owner's report. */
  public readonly stats = { accepted: 0, clamped: 0, droppedRate: 0, droppedRange: 0 };

  public reset = (): void => {
    this.shooters.clear();
    this.stats.accepted = this.stats.clamped = this.stats.droppedRate = this.stats.droppedRange = 0;
  };

  /** The targets of a claim the host may apply, with amounts clamped. */
  public check = (bridge: BattleBridge, from: string, targets: HitTarget[], nowMs: number): HitTarget[] => {
    const limits = bridge.weaponLimits(from);
    let record = this.shooters.get(from);
    if (record == null) {
      record = { lastShotAt: -Infinity, shotTargets: new Set(), dropped: 0, clamped: 0 };
      this.shooters.set(from, record);
    }
    const sameShot = nowMs - record.lastShotAt < SAME_SHOT_MS;
    if (!sameShot) {
      if (nowMs - record.lastShotAt < limits.minIntervalMs) {
        this.stats.droppedRate += targets.length;
        record.dropped += targets.length;
        this.loggerService.warn('hit claim faster than the weapon reloads', from, Math.round(nowMs - record.lastShotAt), 'ms');
        return [];
      }
      record.lastShotAt = nowMs;
      record.shotTargets.clear();
    }
    const accepted: HitTarget[] = [];
    for (const target of targets) {
      if (!bridge.has(target.id)) continue;
      if (record.shotTargets.has(target.id) || (record.shotTargets.size > 0 && !limits.multiTarget)) {
        this.stats.droppedRate++;
        continue;
      }
      if (Number.isFinite(limits.maxRange) && bridge.distanceBetween(from, target.id) > limits.maxRange * RANGE_SLACK + RANGE_PAD_UNITS) {
        this.stats.droppedRange++;
        this.loggerService.warn('hit claim out of reach', from, '->', target.id);
        continue;
      }
      record.shotTargets.add(target.id);
      let amount = target.amount;
      if (!(amount > 0)) continue;
      if (amount > limits.maxPerHit) {
        this.stats.clamped++;
        record.clamped++;
        amount = limits.maxPerHit;
      }
      this.stats.accepted++;
      accepted.push({ ...target, amount });
    }
    return accepted;
  };

  /** A tank left (or respawned as someone else's): its shot history goes. */
  public forget = (id: string): void => {
    this.shooters.delete(id);
  };
}

export default DamageRuleService;

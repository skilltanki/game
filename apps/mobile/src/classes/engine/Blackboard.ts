// One shared memory per team: who is on it, what they have seen, who does
// what, and the carrier's current path. Written by the engine's tactics
// services every tick, read by the strategies through a TeamContext.
import type { BotPerception } from '../../model/Perception';
import type { TeamType } from '../../model/BattleConfig';
import type { Vec3Like } from '../../model/TankCommand';
import type { CostLayer } from '../../model/engine/Nav';
import type { Sighting, SquadRole } from '../../model/engine/Tactics';
import type { Path } from '../../model/engine/Path';

export class Blackboard {
  readonly members = new Map<string, BotPerception>();
  readonly sightings = new Map<string, Sighting>();
  readonly roles = new Map<string, SquadRole>();
  /** Latest planned path per member (reference, not a copy). */
  readonly paths = new Map<string, Vec3Like[]>();
  lastAuctionAt = -Infinity;
  /** Predicted route of the enemy carrier (for interception), and when it was planned. */
  interceptPath: Path | null = null;
  interceptPlannedAt = -Infinity;
  interceptFor: string | null = null;
  threat: CostLayer | null = null;
  threatAt = -Infinity;

  constructor(readonly team: TeamType) {}

  clear(): void {
    this.members.clear();
    this.sightings.clear();
    this.roles.clear();
    this.paths.clear();
    this.lastAuctionAt = -Infinity;
    this.interceptPath = null;
    this.interceptPlannedAt = -Infinity;
    this.interceptFor = null;
    this.threat = null;
    this.threatAt = -Infinity;
  }
}

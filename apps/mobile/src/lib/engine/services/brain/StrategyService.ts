// Picks the strategy for the battle's mode and rate-limits its decisions
// (a strategy re-evaluates a few times a second, not every physics step, so
// objectives do not flicker between two equally good choices). Hands each
// decision the squad's shared knowledge as a TeamContext.
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import {
  AssaultStrategy,
  CtfStrategy,
  DeathmatchStrategy,
  TeamDeathmatchStrategy,
  type BotStrategy,
} from '../../../../classes/engine/strategies';
import type { BattleModeId } from '../../../../model/BattleConfig';
import type { BotPerception } from '../../../../model/Perception';
import type { Objective } from '../../../../model/Objective';
import type { TeamContext } from '../../../../model/engine/Tactics';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BlackboardService from '../squad/BlackboardService';
import type RoleAuctionService from '../squad/RoleAuctionService';
import type EscortService from '../squad/EscortService';
import type InterceptService from '../squad/InterceptService';
import type SightingService from '../tactics/SightingService';
import type UtilityPlannerService from './UtilityPlannerService';
import type { BotPersona } from '../../../../model/engine/Persona';
import type { Rng } from '../../../../classes/engine/Rng';
import { Rng as RngImpl } from '../../../../classes/engine/Rng';
import type MapInsightService from '../insight/MapInsightService';

const DECISION_INTERVAL_MS = 250;

export class StrategyService {
  private readonly blackboardService = inject<BlackboardService>(TYPES.blackboardService);
  private readonly roleAuctionService = inject<RoleAuctionService>(TYPES.roleAuctionService);
  private readonly escortService = inject<EscortService>(TYPES.escortService);
  private readonly interceptService = inject<InterceptService>(TYPES.interceptService);
  private readonly sightingService = inject<SightingService>(TYPES.sightingService);
  private readonly utilityPlannerService = inject<UtilityPlannerService>(TYPES.utilityPlannerService);
  private readonly mapInsightService = inject<MapInsightService>(TYPES.mapInsightService);
  /** Posts are picked deterministically per battle; a fresh rng per query keeps them stable. */
  private postSeed = 7;

  private readonly strategies: Record<BattleModeId, BotStrategy> = {
    dm: new DeathmatchStrategy(),
    tdm: new TeamDeathmatchStrategy(),
    ctf: new CtfStrategy(),
    assault: new AssaultStrategy(),
    explore: new DeathmatchStrategy(),
  };
  private readonly lastObjective = new Map<string, Objective>();

  public strategyFor = (mode: BattleModeId): BotStrategy => this.strategies[mode] ?? this.strategies.dm;

  public assignRole = (perception: BotPerception, memory: BotMemory, index: number): void => {
    memory.slot = index;
    this.strategyFor(perception.mode).assignRole(perception, memory, index);
  };

  public decide = (perception: BotPerception, memory: BotMemory, persona: BotPersona, rng: Rng): Objective => {
    const now = perception.now;
    const previous = this.lastObjective.get(perception.self.id);
    if (previous != null && now < memory.nextDecisionAt && this.stillValid(previous)) {
      return previous;
    }
    memory.nextDecisionAt = now + DECISION_INTERVAL_MS;
    const team = this.teamContext(perception);
    const mission = this.strategyFor(perception.mode).decide(perception, memory, team);
    const planned = this.utilityPlannerService.plan(perception, memory, team, persona, rng, mission);
    const next: Objective = planned.kind === 'hunt' ? { ...planned, mobile: persona.mobility >= 0.5 } : planned;
    this.lastObjective.set(perception.self.id, next);
    return next;
  };

  /** The squad as one bot may ask it. */
  public teamContext = (perception: BotPerception): TeamContext => {
    const board = this.blackboardService.boardFor(perception.self.team);
    return {
      knownEnemies: () => this.sightingService.known(perception, board),
      roleOf: (id) => this.roleAuctionService.roleOf(board, id),
      escortPoint: (role, out) => this.escortService.point(board, role, out),
      interceptPoint: (out) => this.interceptService.point(board, perception, out),
      threatLayer: () => board.threat,
      defencePost: (slot, out) => {
        const flags = perception.flags();
        const team = perception.self.team;
        if (flags == null || (team !== 'red' && team !== 'blue')) return false;
        const enemy = team === 'red' ? 'blue' : 'red';
        return this.mapInsightService.defencePost(flags[team].basePosition, flags[enemy].basePosition, slot, new RngImpl(this.postSeed + slot), out);
      },
      ambushPost: (out) => {
        const flags = perception.flags();
        const team = perception.self.team;
        if (flags == null || (team !== 'red' && team !== 'blue')) return false;
        const enemy = team === 'red' ? 'blue' : 'red';
        return this.mapInsightService.ambushPost(flags[enemy].basePosition, flags[team].basePosition, new RngImpl(this.postSeed ^ perception.self.id.length), out);
      },
      flagRoutes: (from, to) => this.mapInsightService.flagRoutes(from, to),
      chokepoints: (from, to) => this.mapInsightService.chokepoints(from, to),
    };
  };

  public forget = (actorId: string): void => {
    this.lastObjective.delete(actorId);
  };

  public clear = (): void => {
    this.lastObjective.clear();
  };

  private stillValid(objective: Objective): boolean {
    return objective.kind !== 'hunt' || objective.target.alive;
  }
}

export default StrategyService;

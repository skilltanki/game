// Kills, deaths and the team score. Wraps the engine's BattleScore (the one
// place a death is recorded) and turns its callbacks into battle events.
import { BattleScore, type DeathEvent } from '../../../../engine/game/BattleScore';
import type { GameTank } from '../../../../engine/game/GameTank';
import type { TeamType } from '../../../../model/BattleConfig';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BattleStateService from './BattleStateService';
import type BattleEventService from './BattleEventService';

export interface ScoreRow {
  actorId: string;
  name: string;
  team: TeamType;
  hull: string;
  turret: string;
  frags: number;
  deaths: number;
  isLocal: boolean;
}

export class ScoreService {
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);

  private _score: BattleScore | null = null;
  /** Hooks other services add for a death (flag drop, clock start). */
  private readonly deathHooks: ((event: DeathEvent) => void)[] = [];

  /** The engine credits every kill to the killer's team; flag modes count flags only. */
  private addTeamPointReal: ((team: TeamType) => void) | null = null;

  public create = (flagMode: boolean): void => {
    const score = new BattleScore();
    this.addTeamPointReal = score.addTeamPoint.bind(score);
    if (flagMode) {
      // Kills still count in the standings, but not on the team scoreboard.
      score.addTeamPoint = () => {};
    }
    score.nameTag = (t) => t?.name ?? '???';
    score.onChange = (red, blue) => this.battleEventService.emit('teamScore', { red, blue });
    score.onDeath = (event) => {
      for (const hook of this.deathHooks) {
        hook(event);
      }
      const victim = this.battleStateService.actorOf(event.victim);
      const killer = event.killer != null ? this.battleStateService.actorOf(event.killer) : null;
      this.battleEventService.emit('death', {
        victimId: victim?.id ?? event.victim.id,
        victimName: event.victim.name,
        victimTeam: event.victim.tank.team,
        killerId: killer?.id ?? event.killer?.id ?? null,
        killerName: event.killer?.name ?? null,
        killerTeam: event.killer?.tank.team ?? null,
        cause: event.cause,
      });
    };
    this._score = score;
  };

  public onDeath = (hook: (event: DeathEvent) => void): (() => void) => {
    this.deathHooks.push(hook);
    return () => {
      const index = this.deathHooks.indexOf(hook);
      if (index >= 0) {
        this.deathHooks.splice(index, 1);
      }
    };
  };

  public get score(): BattleScore {
    if (this._score == null) {
      throw new Error('ScoreService.create() has not run');
    }
    return this._score;
  }

  public register = (gameTank: GameTank): void => this.score.register(gameTank);

  public unregister = (gameTank: GameTank): void => this.score.unregister(gameTank);

  public addTeamPoint = (team: TeamType): void => this.addTeamPointReal?.(team);

  public get teamScore(): { red: number; blue: number } {
    return this.score.teamScore;
  }

  public fragsOf = (gameTank: GameTank): number => this.score.statsOf(gameTank)?.frags ?? 0;

  public rows = (): ScoreRow[] =>
    this.battleStateService.actors().map((actor) => {
      const stats = this.score.statsOf(actor.gameTank);
      return {
        actorId: actor.id,
        name: actor.name,
        team: actor.gameTank.tank.team,
        hull: actor.gameTank.hullName,
        turret: actor.gameTank.turretName,
        frags: stats?.frags ?? 0,
        deaths: stats?.deaths ?? 0,
        isLocal: actor.isLocal,
      };
    });

  /** The best frag count on the field (for the deathmatch score line). */
  public leaderFrags = (): number => Math.max(0, ...this.rows().map((r) => r.frags));

  public dispose = (): void => {
    this._score = null;
    this.addTeamPointReal = null;
    this.deathHooks.length = 0;
  };
}

export default ScoreService;

// Owns the per-team blackboards for the current battle.
import { Blackboard } from '../../../../classes/engine/Blackboard';
import type { TeamType } from '../../../../model/BattleConfig';
import type { BotPerception } from '../../../../model/Perception';

export class BlackboardService {
  private readonly boards = new Map<TeamType, Blackboard>();

  public boardFor = (team: TeamType): Blackboard => {
    let board = this.boards.get(team);
    if (board == null) {
      board = new Blackboard(team);
      this.boards.set(team, board);
    }
    return board;
  };

  public all = (): Blackboard[] => [...this.boards.values()];

  public join = (id: string, perception: BotPerception): void => {
    this.boardFor(perception.self.team).members.set(id, perception);
  };

  public leave = (id: string): void => {
    for (const board of this.boards.values()) {
      board.members.delete(id);
      board.roles.delete(id);
      board.paths.delete(id);
    }
  };

  public clear = (): void => {
    this.boards.clear();
  };
}

export default BlackboardService;

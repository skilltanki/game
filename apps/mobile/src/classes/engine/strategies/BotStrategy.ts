// A strategy answers one question per tick: what should this bot be doing?
// Deathmatch, team deathmatch, CTF and Assault each have their own; the
// navigator and gunner then execute the objective the same way for all.
// The team context carries the squad's shared knowledge and roles.
import type { BotMemory } from '../BotMemory';
import type { BotPerception } from '../../../model/Perception';
import type { Objective } from '../../../model/Objective';
import type { TeamContext } from '../../../model/engine/Tactics';

export interface BotStrategy {
  readonly id: string;
  /** Called when the bot joins (or respawns) to pick a role. `index` is its slot among its team's bots. */
  assignRole(perception: BotPerception, memory: BotMemory, index: number): void;
  decide(perception: BotPerception, memory: BotMemory, team: TeamContext): Objective;
}

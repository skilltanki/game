// What the menu hands to the battle. Replaces the desktop client's URL
// parameters (logic/urlState.ts): the PWA never reloads the page.
import type { BattleModeId } from '../engine/game/BattleMode';
import type { TeamType } from '../engine/tank/Tank';
import type { OnlineSeat } from './online/wire';

export type { BattleModeId, TeamType };

export type TeamSide = 'red' | 'blue';

export interface TankLoadout {
  hull: string;
  turret: string;
  /** Garage paint id; undefined keeps the team colour. */
  paint?: string;
  /** Visual modification "M0".."M3". */
  modification: string;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BattleConfig {
  mode: BattleModeId;
  mapId: string;
  /** The local player's call sign and loadout. */
  playerName: string;
  loadout: TankLoadout;
  /** Side in the team modes; ignored in deathmatch. */
  team: TeamSide;
  /**
   * Bots to spawn. Deathmatch: all hostile. Team modes: split so that the
   * player's side plus bots and the enemy side are balanced (see
   * ModeRuleService.assignTeams).
   */
  bots: number;
  botDifficulty: BotDifficulty;
  /** Difficulty of the ENEMY side's bots in team modes when it differs (balance benchmarks); defaults to botDifficulty. */
  enemyBotDifficulty?: BotDifficulty;
  /** Seed for the bots' decisions (benchmarks replay); random when omitted. */
  seed?: number;
  /** A multiplayer battle: the room's seats drive the roster (no bots), the host peer is the authority. */
  online?: OnlineBattleInfo;
}

export interface OnlineBattleInfo {
  roomId: string;
  /** This machine's seat; its actor id. */
  localPeerId: string;
  hostId: string;
  hostEpoch: number;
  durationMs: number | null;
  /** Everyone seated when the battle started, the local player included (the host's bots carry `bot: true`). */
  seats: OnlineSeat[];
  /** The host's bots think at this level on whichever machine hosts them. */
  botDifficulty: BotDifficulty;
}

export interface ActorDescriptor {
  id: string;
  name: string;
  team: TeamType;
  loadout: TankLoadout;
  /** Who drives it. */
  control: 'touch' | 'bot' | 'remote';
  /** Bots only. */
  difficulty?: BotDifficulty;
}

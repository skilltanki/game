// The battle modes this port supports.
//
// Mirrors the original's BattleMode enum (DM=1, TDM=2, CTF=3, CP=4) for the
// three that are playable here; CP is absent because neither the original client
// nor the ProTanki server carries its capture formula (the client only
// renders a progress the server sends, and the server's handler is a stub).
//
// 'explore' is NOT an original mode: it is a single-player free drive used to
// look around a map, with no opponents and no scoring.

export type BattleModeId = 'dm' | 'tdm' | 'ctf' | 'assault' | 'explore';

export interface BattleModeInfo {
  id: BattleModeId;
  /** Original protocol id, where one exists. */
  protocolId: number | null;
  name: string;
  description: string;
  /** Red vs blue. DM and explore are free-for-all / solo. */
  teams: boolean;
  /** Opponents are spawned. */
  bots: boolean;
  /** Needs <ctf-flags> in the map XML. */
  requiresFlags: boolean;
  /** Other players may join this battle. */
  joinable: boolean;
  /**
   * The battle can be padded out with bots.
   *
   * Only deathmatch offers this: the team modes are meant to be filled by
   * real players, and a side stacked with bots is not a team game.
   */
  fillsWithBots: boolean;
}

export const BATTLE_MODES: Record<BattleModeId, BattleModeInfo> = {
  dm: {
    id: 'dm',
    protocolId: 1,
    name: 'Deathmatch',
    description: 'Every tank for itself',
    teams: false,
    bots: true,
    requiresFlags: false,
    joinable: true,
    fillsWithBots: true,
  },
  tdm: {
    id: 'tdm',
    protocolId: 2,
    name: 'Team Deathmatch',
    description: 'Red versus blue',
    teams: true,
    bots: true,
    requiresFlags: false,
    joinable: true,
    fillsWithBots: false,
  },
  ctf: {
    id: 'ctf',
    protocolId: 3,
    name: 'Capture the Flag',
    description: 'Take the enemy flag to your base',
    teams: true,
    bots: true,
    requiresFlags: true,
    joinable: true,
    fillsWithBots: false,
  },
  assault: {
    id: 'assault',
    // The original's BattleMode.AS (projects.tanks.client.battleservice).
    protocolId: 5,
    name: 'Assault',
    description: 'Carry YOUR flag to the enemy base',
    teams: true,
    bots: true,
    requiresFlags: true,
    joinable: true,
    fillsWithBots: false,
  },
  explore: {
    id: 'explore',
    protocolId: null,
    name: 'Explore Map',
    description: 'Drive around on your own',
    teams: false,
    bots: false,
    requiresFlags: false,
    joinable: false,
    fillsWithBots: false,
  },
};

/**
 * What a player lands on first.
 *
 * Deathmatch: it fills itself with bots, so a new player gets a real battle
 * without waiting for anyone to join. The team modes need people.
 */
export const DEFAULT_MODE: BattleModeId = 'dm';

/**
 * Opponents a deathmatch starts with. Five makes the free-for-all feel like
 * one — the bots fight each other as well as the player — without the field
 * getting crowded.
 */
export const DEFAULT_BOT_COUNT = 5;
/**
 * Range the menu's stepper allows. Zero is a valid choice: a solo deathmatch
 * with no bots is just a private drive on the map, and the multiplayer flow
 * never spawns bots at all.
 */
export const MIN_BOT_COUNT = 0;
export const MAX_BOT_COUNT = 7;

export function isBattleMode(value: string | null): value is BattleModeId {
  return value != null && Object.prototype.hasOwnProperty.call(BATTLE_MODES, value);
}

// What the peers say to each other over the DataChannels (never through the
// server). Plain JSON; small on purpose.
//
// Two channels per link: `reliable` (ordered, retransmitted) carries the
// lobby, the hit claims and everything the host decides; `fast` (unordered,
// no retransmits) carries the command and pose stream, where a late packet
// is worthless because a newer one follows 33 ms later.
//
// Authority: the HOST peer decides damage, deaths, spawns, flags, the score
// and the clock. Every authority message carries the host epoch (`e`) from
// the signalling server; a peer drops messages from an old host.
import type { TankCommand } from '../TankCommand';
import type { DeathCause } from '../BattleEvents';
import type { BattleModeId } from '../BattleConfig';
import type { TeamName } from './protocol';

export type WireVec3 = [number, number, number];
/** w, x, y, z — the engine's Quaternion.reset order. */
export type WireQuat = [number, number, number, number];

/** One seat of a started battle: who sits where (actor id = peerId; a bot's id is `bot<n>`, the host drives it). */
export interface OnlineSeat {
  peerId: string;
  name: string;
  hull: string;
  turret: string;
  paint: string | null;
  team: TeamName | null;
  /** A bot: its brain runs on `owner`'s machine, whose commands and poses drive it everywhere else. */
  bot?: boolean;
  /** The peer driving this bot (bots are spread over the players; the host reassigns when one leaves). */
  owner?: string;
}

/** A tank's pose and turret, as the owner publishes it. */
export interface WirePose {
  /** Incarnation: bumped by the host on every spawn, so a pose from a previous life is dropped. */
  inc: number;
  p: WireVec3;
  o: WireQuat;
  v: WireVec3;
  av: WireVec3;
  /** Turret angle, hull-relative radians. */
  tr: number;
}

// --- lobby (reliable) ---------------------------------------------------------

export interface ReadyMessage {
  t: 'ready';
  on: boolean;
}

export interface TeamMessage {
  t: 'team';
  team: TeamName;
}

/** The host starts the battle (also sent to a peer that joins while it runs). */
export interface StartMessage {
  t: 'start';
  mode: BattleModeId;
  mapId: string;
  seed: number;
  durationMs: number | null;
  /** Humans and the host's bots (`bot: true`). */
  seats: OnlineSeat[];
  botDifficulty: 'easy' | 'normal' | 'hard';
}

// --- the stream (fast) ---------------------------------------------------------

/** The owner's command for a tank it drives (its own, or a bot on the host); every other peer applies it to the replica. */
export interface CommandMessage {
  t: 'cmd';
  /** Actor id; equals the sender's peerId except for the host's bots. */
  id: string;
  tick: number;
  cmd: TankCommand;
}

/** The owner's pose; the replicas blend toward it. */
export interface PoseMessage {
  t: 'pose';
  id: string;
  tick: number;
  pose: WirePose;
}

// --- claims to the host (reliable) --------------------------------------------

export interface HitTarget {
  id: string;
  inc: number;
  /** Hit points, as the shooter's weapon computed them (range falloff, buffs). */
  amount: number;
  splash?: boolean;
  heal?: boolean;
}

/** "My weapon hit these tanks" — the shooter's claim; the host applies it (and the turret's status: Firebird burns, Freeze chills). */
export interface HitMessage {
  t: 'hit';
  /** The tank that fired: the sender's own (default) or a bot the sender drives. */
  shooter?: string;
  inc: number;
  turret: string;
  targets: HitTarget[];
}

export interface SuicideMessage {
  t: 'suicide';
}

/** A peer's battle is loaded: the host answers with `sync`. */
export interface HelloMessage {
  t: 'hello';
}

// --- the host's word (reliable, with the epoch) ------------------------------

export interface HealthMessage {
  t: 'health';
  e: number;
  id: string;
  hp: number;
}

export interface KillMessage {
  t: 'kill';
  e: number;
  victim: string;
  killer: string | null;
  cause: DeathCause;
}

export interface SpawnMessage {
  t: 'spawn';
  e: number;
  id: string;
  inc: number;
  p: WireVec3;
  rz: number;
}

export interface ScoreRowWire {
  id: string;
  frags: number;
  deaths: number;
}

export interface ScoreMessage {
  t: 'score';
  e: number;
  rows: ScoreRowWire[];
  red: number;
  blue: number;
}

export interface ClockMessage {
  t: 'clock';
  e: number;
  msLeft: number | null;
}

export interface FlagMessage {
  t: 'flag';
  e: number;
  kind: 'taken' | 'dropped' | 'returned' | 'delivered';
  flag: 'red' | 'blue';
  byId: string | null;
}

export interface FinishMessage {
  t: 'finish';
  e: number;
  reason: 'time' | 'left';
}

/** A seat changed hands: a player who left is driven by a bot brain on `owner`'s machine (bot: true), a bot moved to another owner, or a player came back (bot: false). */
export interface SeatMessage {
  t: 'seat';
  e: number;
  id: string;
  bot: boolean;
  owner?: string;
}

/** A tank is burning (Firebird) or chilled (Freeze): the host's word, replayed on every machine. */
export interface StatusMessage {
  t: 'status';
  e: number;
  id: string;
  kind: 'burn' | 'freeze';
}

/** Everybody's health, twice a second: the repair kit and Isida heal on every machine, this keeps them honest. */
export interface HealthAllMessage {
  t: 'hpAll';
  e: number;
  hp: [string, number, number][]; // id, hp, inc
}

/** The whole authoritative state, for a peer that just loaded (or joined mid-battle). */
export interface SyncMessage {
  t: 'sync';
  e: number;
  tanks: { id: string; inc: number; hp: number; dead: boolean; p: WireVec3; rz: number }[];
  rows: ScoreRowWire[];
  red: number;
  blue: number;
  msLeft: number | null;
  flags: { flag: 'red' | 'blue'; carrier: string | null }[];
}

export type LobbyWire = ReadyMessage | TeamMessage | StartMessage;
export type StreamWire = CommandMessage | PoseMessage;
export type ClaimWire = HitMessage | SuicideMessage | HelloMessage;
export type AuthorityWire = HealthMessage | KillMessage | SpawnMessage | ScoreMessage | ClockMessage | FlagMessage | FinishMessage | HealthAllMessage | SyncMessage | StatusMessage | SeatMessage;

export type PeerWire = LobbyWire | StreamWire | ClaimWire | AuthorityWire;

export type AuthorityKind = AuthorityWire['t'];

export const AUTHORITY_KINDS: ReadonlySet<string> = new Set<AuthorityKind>(['health', 'kill', 'spawn', 'score', 'clock', 'flag', 'finish', 'hpAll', 'sync', 'status', 'seat']);

// Everything that depends on the battle mode and nothing else: who is
// hostile to whom, how a roster is built from a config (teams, bot
// loadouts), what the score counts. Strategies and the HUD ask here instead
// of switching on the mode themselves.
import { BATTLE_MODES, type BattleModeInfo } from '../../../../engine/game/BattleMode';
import { WEAPON_SPECS } from '../../../../engine/weapon/WeaponSpecs';
import type { ActorDescriptor, BattleConfig, BattleModeId, TeamSide, TeamType } from '../../../../model/BattleConfig';
import type { OnlineSeat } from '../../../../model/online/wire';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type AssetCatalogService from '../asset/AssetCatalogService';

/** Loadouts cycled through the bots, so a crowded field is not seven Mammoths. */
const BOT_HULLS = ['Mammoth', 'Hunter', 'Viking', 'Titan', 'Hornet', 'Dictator', 'Wasp'];
const BOT_TURRETS = ['Thunder', 'Railgun', 'Smoky', 'Twins', 'Ricochet', 'Firebird', 'Freeze', 'Isida', 'Shaft'];
const BOT_NAMES = [
  'Pahom', 'Viper', 'Granit', 'Shturm', 'Bars', 'Kometa', 'Molot', 'Sokol', 'Taran', 'Zenit',
  'Ural', 'Vihr', 'Rysʹ', 'Kedr', 'Buran',
];

/** Fallback for weapons with no explicit range (hitscan has none). */
const DEFAULT_RANGE = 12000;

export class ModeRuleService {
  private readonly assetCatalogService = inject<AssetCatalogService>(TYPES.assetCatalogService);

  public info = (mode: BattleModeId): BattleModeInfo => BATTLE_MODES[mode];

  public isTeamMode = (mode: BattleModeId): boolean => BATTLE_MODES[mode].teams;

  public isFlagMode = (mode: BattleModeId): boolean => mode === 'ctf' || mode === 'assault';

  /** Deathmatch: everybody; team modes: the other colour. */
  public hostile = (a: TeamType, b: TeamType): boolean => a === 'dm' || b === 'dm' || a !== b;

  public enemyOf = (team: TeamSide): TeamSide => (team === 'red' ? 'blue' : 'red');

  public scoreLabel = (mode: BattleModeId): string => (this.isFlagMode(mode) ? 'Flags' : 'Kills');

  /** The player plus bots, teams balanced around the player; online, the room's seats (no bots). */
  public buildRoster = (config: BattleConfig): ActorDescriptor[] => {
    const info = this.info(config.mode);
    if (config.online != null) {
      return this.buildOnlineRoster(config, info.teams);
    }
    const playerTeam: TeamType = info.teams ? config.team : 'dm';
    const roster: ActorDescriptor[] = [
      {
        id: 'player',
        name: config.playerName,
        team: playerTeam,
        loadout: config.loadout,
        control: 'touch',
      },
    ];
    if (!info.bots || config.mode === 'explore') {
      return roster;
    }
    const bots = Math.max(0, config.bots);
    const hulls = this.assetCatalogService.hulls.map((h) => h.id);
    const turrets = this.assetCatalogService.turrets.map((t) => t.id);
    const pickHull = (i: number): string => BOT_HULLS.filter((h) => hulls.includes(h))[i % BOT_HULLS.length] ?? hulls[i % hulls.length];
    const pickTurret = (i: number): string => BOT_TURRETS.filter((t) => turrets.includes(t))[i % BOT_TURRETS.length] ?? turrets[i % turrets.length];
    const names = shuffle(BOT_NAMES);
    for (let i = 0; i < bots; i++) {
      let team: TeamType = 'dm';
      if (info.teams) {
        // Enemies get the odd one: a 5-bot TDM is you + 2 against 3.
        const enemies = Math.ceil((bots + 1) / 2);
        team = i < enemies ? this.enemyOf(config.team) : config.team;
      }
      const enemySide = info.teams && team !== config.team;
      roster.push({
        id: `bot${i + 1}`,
        name: names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''),
        team,
        loadout: { hull: pickHull(i), turret: pickTurret(i), modification: 'M0' },
        control: 'bot',
        difficulty: enemySide ? (config.enemyBotDifficulty ?? config.botDifficulty) : config.botDifficulty,
      });
    }
    return roster;
  };

  /**
   * The bots a room's host adds to the battle, as seats everyone will spawn:
   * ids `bot1..n`, loadouts and names as in single player, sides balanced
   * around the humans already seated (the emptier team first).
   */
  public buildBotSeats = (mode: BattleModeId, count: number, humans: OnlineSeat[]): OnlineSeat[] => {
    const info = this.info(mode);
    const hulls = this.assetCatalogService.hulls.map((h) => h.id);
    const turrets = this.assetCatalogService.turrets.map((t) => t.id);
    const pickHull = (i: number): string => BOT_HULLS.filter((h) => hulls.includes(h))[i % BOT_HULLS.length] ?? hulls[i % hulls.length];
    const pickTurret = (i: number): string => BOT_TURRETS.filter((t) => turrets.includes(t))[i % BOT_TURRETS.length] ?? turrets[i % turrets.length];
    const names = shuffle(BOT_NAMES);
    const sides = { red: humans.filter((s) => s.team === 'red').length, blue: humans.filter((s) => s.team === 'blue').length };
    const seats: OnlineSeat[] = [];
    for (let i = 0; i < Math.max(0, count); i++) {
      let team: 'red' | 'blue' | null = null;
      if (info.teams) {
        team = sides.red <= sides.blue ? 'red' : 'blue';
        sides[team]++;
      }
      seats.push({
        peerId: `bot${i + 1}`,
        name: names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''),
        hull: pickHull(i),
        turret: pickTurret(i),
        paint: null,
        team,
        bot: true,
      });
    }
    return seats;
  };

  /**
   * Online: one actor per seat, actor id = peerId (the same on every
   * machine), the local seat on touch, a bot on bot here when THIS machine is
   * its owner (remote elsewhere), the other humans remote. A seat
   * without a side in a team mode takes the emptier one, in seat order.
   */
  private buildOnlineRoster(config: BattleConfig, teams: boolean): ActorDescriptor[] {
    const online = config.online!;
    const count = { red: 0, blue: 0 };
    return online.seats.map((seat) => {
      const local = seat.peerId === online.localPeerId;
      let team: TeamType = 'dm';
      if (teams) {
        const pick = local ? config.team : (seat.team ?? (count.red <= count.blue ? 'red' : 'blue'));
        team = pick;
        count[pick]++;
      }
      const bot = seat.bot === true;
      return {
        id: seat.peerId,
        name: seat.name,
        team,
        loadout: local ? config.loadout : { hull: seat.hull, turret: seat.turret, paint: seat.paint ?? undefined, modification: 'M0' },
        // A bot's brain runs where its owner sits; everywhere else it is a replica of that machine's stream.
        control: local ? 'touch' : bot && seat.owner === online.localPeerId ? 'bot' : 'remote',
        difficulty: bot ? online.botDifficulty : undefined,
      };
    });
  }

  /** The turret fires on the trigger's RELEASE (the Shaft: holding is the sniper charge). */
  public firesOnRelease = (turret: string): boolean => WEAPON_SPECS[turret]?.kind === 'shaft';

  /** Engagement range of a turret, sim units. */
  public weaponRange = (turret: string): number => {
    const spec = WEAPON_SPECS[turret];
    if (spec == null) {
      return DEFAULT_RANGE;
    }
    switch (spec.kind) {
      case 'hitscan':
        return spec.maxRange ?? DEFAULT_RANGE;
      case 'projectile':
        return spec.maxRange;
      case 'stream':
        return spec.maxRange;
      case 'shaft':
        return DEFAULT_RANGE;
    }
  };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default ModeRuleService;

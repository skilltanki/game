import { CC_DEFAULT_BOTS, CC_DEFAULT_HULL, CC_DEFAULT_MAP, CC_DEFAULT_TURRET, CC_STORAGE_PREFIX } from '../../../../config/params';
import type { BattleModeId, BotDifficulty, TeamSide } from '../../../../model/BattleConfig';
import type { PlaySide } from '../../../../model/Lobby';
import type { QualityPreset } from './GraphicsQualityService';

/** What survives between launches: the call sign and the last menu choices. */
export interface PlayerProfile {
  name: string;
  hull: string;
  turret: string;
  paint?: string;
  modification: string;
  mode: BattleModeId;
  mapId: string;
  bots: number;
  team: TeamSide;
  botDifficulty: BotDifficulty;
  /** Graphics preset; absent = LOW (GraphicsQualityService). */
  quality?: QualityPreset;
  /** All sound off (AudioSettingsService). */
  muted?: boolean;
  /** When the home-screen prompt was shown (ms since epoch); shown once (FullscreenPromptService). */
  homeScreenPromptAt?: number;
  /** Against the bots or in a room; absent = single player (the default). */
  play?: PlaySide;
  /** The create-room form's last values (RoomsMenuService). */
  roomName?: string;
  roomMaxPlayers?: number;
  roomDurationMin?: number;
  /** Bots the host adds to ITS rooms (apart from the single-player `bots`: a 2-player team room must not spawn five of them). */
  roomBots?: number;
}

const DEFAULT_PROFILE: PlayerProfile = {
  name: 'Player',
  hull: CC_DEFAULT_HULL,
  turret: CC_DEFAULT_TURRET,
  modification: 'M0',
  mode: 'dm',
  mapId: CC_DEFAULT_MAP,
  bots: CC_DEFAULT_BOTS,
  team: 'red',
  botDifficulty: 'normal',
};

/** localStorage with a namespace; every failure (private mode, quota) is swallowed. */
export class StorageService {
  public read = <T>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(CC_STORAGE_PREFIX + key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  };

  public write = <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(CC_STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage disabled: the value simply will not be remembered.
    }
  };

  public getProfile = (): PlayerProfile => ({ ...DEFAULT_PROFILE, ...this.read<Partial<PlayerProfile>>('profile', {}) });

  public saveProfile = (patch: Partial<PlayerProfile>): PlayerProfile => {
    const next = { ...this.getProfile(), ...patch };
    this.write('profile', next);
    return next;
  };
}

export default StorageService;

// What a shot looks and sounds like, and what a kill does — the engine's
// combat presenter, wired to this battle's effects, roster, score and camera.
import { createCombatPresenter, type CombatPresenter } from '../../../../engine/logic/combat';
import type { WeaponListener } from '../../../../engine/weapon/RailgunWeapon';
import type { GameTank } from '../../../../engine/game/GameTank';
import type { TeamType } from '../../../../model/BattleConfig';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BattleStateService from './BattleStateService';
import type EffectsService from './EffectsService';
import type ScoreService from './ScoreService';
import type CameraService from './CameraService';

export class CombatService {
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly effectsService = inject<EffectsService>(TYPES.effectsService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);
  private readonly cameraService = inject<CameraService>(TYPES.cameraService);

  private _presenter: CombatPresenter | null = null;
  /** Online: who may set burn/freeze here (null = everyone, single player). */
  private statusAuthority: ((shooter: GameTank | null) => boolean) | null = null;

  public create = (): void => {
    this._presenter = createCombatPresenter({
      effects: this.effectsService.effects,
      statusEffects: this.effectsService.status,
      roster: this.battleStateService.roster,
      battleScore: this.scoreService.score,
      getNow: () => this.battleStateService.timeMs,
      shakeCamera: (preset) => this.cameraService.shake(preset),
      statusAuthority: (shooter) => this.statusAuthority == null || this.statusAuthority(shooter),
    });
  };

  public setStatusAuthority = (rule: ((shooter: GameTank | null) => boolean) | null): void => {
    this.statusAuthority = rule;
  };

  public get presenter(): CombatPresenter {
    if (this._presenter == null) {
      throw new Error('CombatService.create() has not run');
    }
    return this._presenter;
  }

  /** The listener a new tank's weapon reports its shots to. */
  public listenerFor = (team: TeamType, getShooter: () => GameTank | null, turret: string): WeaponListener => ({
    onShot: this.presenter.onShotFor(team, getShooter, turret),
    onStartCharging: this.presenter.onChargeFor(getShooter),
  });

  public detonateWreck = (gameTank: GameTank): void => {
    this._presenter?.detonateWreck(gameTank);
  };

  public dispose = (): void => {
    this._presenter = null;
    this.statusAuthority = null;
  };
}

export default CombatService;

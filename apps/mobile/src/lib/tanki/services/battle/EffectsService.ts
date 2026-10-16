// Battle-wide visual effects (tracers, flipbooks, railgun trail, dust) and
// the per-tank status effects (burn, chill, charge glows, stream jets).
// Both are the engine's own classes; this service owns their lifetime.
import { createBattleEffects, type BattleEffects } from '../../../../engine/logic/effects';
import { StatusEffects } from '../../../../engine/logic/statusEffects';
import type { MapVisual } from '../../../../engine/logic/bootstrap';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type EngineService from '../base/EngineService';
import type GraphicsQualityService from '../base/GraphicsQualityService';
import type BattleStateService from './BattleStateService';

export class EffectsService {
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly graphicsQualityService = inject<GraphicsQualityService>(TYPES.graphicsQualityService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);

  private _effects: BattleEffects | null = null;
  private _status: StatusEffects | null = null;

  public create = async (visual: MapVisual | undefined): Promise<void> => {
    this._effects = await createBattleEffects(this.engineService.app, this.engineService.simRoot, visual);
    // The low preset drops the track dust: a puff per suspension ray per step.
    this._effects.dust.enabled = this.graphicsQualityService.settings.dust;
    this._status = new StatusEffects({
      hitEffects: this._effects.hitEffects,
      tanks: () => this.battleStateService.gameTanks(),
    });
  };

  public get effects(): BattleEffects {
    if (this._effects == null) {
      throw new Error('EffectsService.create() has not run');
    }
    return this._effects;
  }

  public get status(): StatusEffects {
    if (this._status == null) {
      throw new Error('EffectsService.create() has not run');
    }
    return this._status;
  }

  public get ready(): boolean {
    return this._effects != null;
  }

  public dispose = (): void => {
    // Entities live under the battle's simRoot, which the engine destroys.
    this._effects = null;
    this._status = null;
  };
}

export default EffectsService;

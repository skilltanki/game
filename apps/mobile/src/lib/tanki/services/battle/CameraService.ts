// The follow camera (behind the turret, Shaft scope, wall clipping, spawn
// fly-in, shake): the engine's FollowCamera, owned per battle, with the
// manual tilt fed from the local actor's command instead of Q/E keys.
import { FollowCamera } from '../../../../engine/logic/camera';
import type { ShakePreset } from '../../../../engine/logic/combat';
import type { SpawnPoint } from '../../../../engine/map/SpawnPoints';
import type { Axis } from '../../../../model/TankCommand';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type EngineService from '../base/EngineService';
import type BattleStateService from './BattleStateService';
import type RespawnService from './RespawnService';

export class CameraService {
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly respawnService = inject<RespawnService>(TYPES.respawnService);

  private _camera: FollowCamera | null = null;

  public create = async (): Promise<void> => {
    this._camera = await FollowCamera.create({
      camera: this.engineService.camera,
      simRoot: this.engineService.simRoot,
      physicsScene: this.battleStateService.physics,
      localPlayer: () => this.battleStateService.local.gameTank,
      respawnTimerMs: () => this.respawnService.respawnTimerMs(this.battleStateService.local.gameTank),
    });
  };

  public get ready(): boolean {
    return this._camera != null;
  }

  public setTilt = (axis: Axis): void => {
    if (this._camera == null) {
      return;
    }
    this._camera.camTiltUp = axis > 0;
    this._camera.camTiltDown = axis < 0;
  };

  public shake = (preset: ShakePreset): void => {
    this._camera?.shake(preset);
  };

  public startSpawnFlyIn = (spawn: SpawnPoint): void => {
    this._camera?.startSpawnFlyIn(spawn);
  };

  public cancelFlyIn = (): void => {
    this._camera?.cancelFlyIn();
  };

  public updateShake = (dtMs: number): void => {
    this._camera?.updateShake(dtMs);
  };

  public renderTick = (dtSec: number, shaftAim: number): void => {
    if (this.battleStateService.hasLocal) {
      this._camera?.renderTick(dtSec, shaftAim);
    }
  };

  public dispose = (): void => {
    this._camera = null;
    this.engineService.camera.camera!.fov = 45;
  };
}

export default CameraService;

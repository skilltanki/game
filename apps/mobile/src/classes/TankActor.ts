// One tank in the battle: the engine's GameTank plus everything the mobile
// client attaches to it — who controls it, its command inbox and supplies.
// Actors are created by TankSpawnService and only ever looked up by id.
import type { GameTank } from '../engine/game/GameTank';
import type { Supplies } from '../engine/game/Supplies';
import { CommandBuffer } from './CommandBuffer';
import type { ControlSource } from '../model/ControlSource';
import type { ActorDescriptor } from '../model/BattleConfig';
import type { TankCommand } from '../model/TankCommand';

export class TankActor {
  readonly commands = new CommandBuffer();
  /** The command applied on the latest physics step. */
  lastCommand: TankCommand | null = null;
  /** Shaft sniper pitch, integrated from the command's drive axis. */
  shaftPitch = 0;
  /** Sim time until which the repair-kit icon stays over the tank (the heal itself is shorter). */
  healShownUntil = 0;
  /** Health at the end of the previous step's supply pass (SupplyRuleService's hit detector). */
  lastHealth = -1;

  constructor(
    readonly descriptor: ActorDescriptor,
    readonly gameTank: GameTank,
    readonly supplies: Supplies,
    public control: ControlSource,
  ) {}

  get id(): string {
    return this.descriptor.id;
  }

  get name(): string {
    return this.descriptor.name;
  }

  get isLocal(): boolean {
    return this.descriptor.control === 'touch';
  }

  get isBot(): boolean {
    return this.descriptor.control === 'bot';
  }

  get alive(): boolean {
    return !this.gameTank.tank.isDead();
  }
}

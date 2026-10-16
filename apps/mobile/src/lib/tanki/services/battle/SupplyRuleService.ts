// Battle rules on top of the engine's Supplies that the engine itself does
// not enforce. One so far: the repair kit is interruptible — a hit ends the
// running kit (the original's rule), so a tank under fire cannot sit on a
// 3 s top-up. The engine keeps no damage hook, so hits are read off the
// health drop between two steps.
import type { TankActor } from '../../../../classes/TankActor';

export class SupplyRuleService {
  /**
   * Runs after the weapons have dealt this step's damage and BEFORE the
   * supplies tick, so a hit is seen before the kit's next heal masks it.
   */
  public detectHits = (actor: TankActor): void => {
    const tank = actor.gameTank.tank;
    if (actor.lastHealth >= 0 && tank.health < actor.lastHealth && actor.supplies.getState('health').active) {
      actor.supplies.cancel('health');
      actor.healShownUntil = 0;
    }
  };

  /** Runs after the supplies tick: the baseline the next step compares against. */
  public rememberHealth = (actor: TankActor): void => {
    actor.lastHealth = actor.gameTank.tank.health;
  };
}

export default SupplyRuleService;

// Supplies are free and infinite for everyone, bots included: the question
// is "is now the moment", not "can I afford it".
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import type { BotPerception, TankView } from '../../../../model/Perception';
import type { SupplyKind } from '../../../../model/TankCommand';

const CHECK_EVERY_MS = 700;

export class SupplyService {
  public pick = (perception: BotPerception, memory: BotMemory, engaged: TankView | null, difficulty: 'easy' | 'normal' | 'hard'): SupplyKind | null => {
    const now = perception.now;
    if (now < memory.nextSupplyCheckAt) {
      return null;
    }
    memory.nextSupplyCheckAt = now + CHECK_EVERY_MS;
    if (difficulty === 'easy') {
      // Easy bots only patch themselves up.
      return this.healIfLow(perception, 0.3);
    }
    const self = perception.self;
    const healthFraction = self.health / Math.max(1, self.maxHealth);
    if (self.carriesFlag != null) {
      // A carrier spends everything on the run home: speed first, then skin, then a patch-up.
      if (self.supplyReady('nitro')) return 'nitro';
      if (self.supplyReady('armor')) return 'armor';
      if (healthFraction < 0.6 && self.supplyReady('health')) return 'health';
    }
    // About to grab the enemy flag: top up first, a wounded carrier dies in seconds.
    const flags = perception.flags();
    const enemyTeam = self.team === 'red' ? 'blue' : self.team === 'blue' ? 'red' : null;
    if (flags != null && enemyTeam != null) {
      const f = flags[enemyTeam].position;
      if (Math.hypot(f.x - self.position.x, f.y - self.position.y) < 2200) {
        const topUp = this.healIfLow(perception, 0.7);
        if (topUp != null) return topUp;
      }
    }
    const heal = this.healIfLow(perception, difficulty === 'hard' ? 0.5 : 0.4);
    if (heal != null) {
      return heal;
    }
    if (engaged != null && engaged.alive) {
      // Under fire at mid health: armour first.
      if (healthFraction < 0.7 && self.supplyReady('armor')) {
        return 'armor';
      }
      // Target in the sights with a ready gun: double damage.
      if (memory.hasLineOfSight && self.weaponStatus >= 0.95 && self.supplyReady('damage')) {
        return 'damage';
      }
      if (difficulty === 'hard' && self.weaponStatus < 0.3 && self.supplyReady('nuclear')) {
        return 'nuclear';
      }
    } else if (self.carriesFlag != null && self.supplyReady('nitro')) {
      // A carrier runs.
      return 'nitro';
    }
    return null;
  };

  private healIfLow(perception: BotPerception, threshold: number): SupplyKind | null {
    const self = perception.self;
    if (self.health / Math.max(1, self.maxHealth) < threshold && self.supplyReady('health')) {
      return 'health';
    }
    return null;
  }
}

export default SupplyService;

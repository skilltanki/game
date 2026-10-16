// Isida's beam heals teammates: a bot with an Isida points it at a wounded
// ally close by instead of at an enemy, the carrier first. The gunner then
// aims and "fires" at the ally exactly as it would at a target.
import type { BotPerception, TankView } from '../../../../model/Perception';
import type { TeamContext } from '../../../../model/engine/Tactics';

const HEAL_TURRET = 'Isida';
/** The beam reaches about this far. */
const HEAL_RANGE = 900;
/** Patients below this health fraction are worth the beam. */
const HEAL_BELOW = 0.75;
/** With a visible enemy this close, the gun matters more than the bandage. */
const DANGER_RADIUS = 1000;

export class MedicService {
  public pickPatient = (perception: BotPerception, team: TeamContext): TankView | null => {
    const self = perception.self;
    if (self.turret !== HEAL_TURRET) return null;
    const danger = team.knownEnemies().some((k) => k.visible && Math.hypot(k.view.position.x - self.position.x, k.view.position.y - self.position.y) < DANGER_RADIUS);
    if (danger) return null;
    let best: TankView | null = null;
    let bestScore = Infinity;
    for (const ally of perception.allies()) {
      if (!ally.alive) continue;
      const hp = ally.health / Math.max(1, ally.maxHealth);
      if (hp >= HEAL_BELOW) continue;
      const d = Math.hypot(ally.position.x - self.position.x, ally.position.y - self.position.y);
      if (d > HEAL_RANGE) continue;
      // The carrier always comes first; then the most wounded.
      const score = (ally.carriesFlag != null ? -1000 : 0) + hp * 1000 + d * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = ally;
      }
    }
    return best;
  };
}

export default MedicService;

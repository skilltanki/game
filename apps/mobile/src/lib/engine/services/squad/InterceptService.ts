// Cutting off the enemy carrier: plan the route it is most likely taking
// (shortest path from where it is to its home base), and meet it a little
// way ahead instead of chasing its tail.
import type { Blackboard } from '../../../../classes/engine/Blackboard';
import type { BotPerception } from '../../../../model/Perception';
import type { Vec3Like } from '../../../../model/TankCommand';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type PathfindingService from '../nav/PathfindingService';

const REPLAN_MS = 1000;
/** Meet the carrier this far ahead along its route (capped by the route's length). */
const AHEAD = 2500;

export class InterceptService {
  private readonly pathfindingService = inject<PathfindingService>(TYPES.pathfindingService);

  public point = (board: Blackboard, perception: BotPerception, out: Vec3Like): boolean => {
    const flags = perception.flags();
    const team = perception.self.team;
    if (flags == null || (team !== 'red' && team !== 'blue')) return false;
    const enemyTeam = team === 'red' ? 'blue' : 'red';
    // CTF: an enemy carries OUR flag to ITS base; assault: an enemy carries ITS flag to OUR base.
    const assault = perception.flagRules === 'assault';
    const stolen = assault ? flags[enemyTeam] : flags[team];
    if (stolen.carrierId == null) return false;
    const thief = perception.tanks().find((t) => t.id === stolen.carrierId);
    if (thief == null || !thief.alive) return false;
    const home = assault ? flags[team].basePosition : flags[enemyTeam].basePosition;
    const now = perception.now;
    if (board.interceptFor !== thief.id || now - board.interceptPlannedAt > REPLAN_MS) {
      board.interceptPath = this.pathfindingService.find({ from: thief.position, to: home, maxNodes: 8000 });
      board.interceptPlannedAt = now;
      board.interceptFor = thief.id;
    }
    const path = board.interceptPath;
    if (path == null || path.points.length < 2) {
      out.x = thief.position.x;
      out.y = thief.position.y;
      out.z = thief.position.z;
      return true;
    }
    let budget = AHEAD;
    let cur: Vec3Like = thief.position;
    for (const to of path.points) {
      const seg = Math.hypot(to.x - cur.x, to.y - cur.y);
      if (seg >= budget) {
        const t = seg > 0 ? budget / seg : 1;
        out.x = cur.x + (to.x - cur.x) * t;
        out.y = cur.y + (to.y - cur.y) * t;
        out.z = cur.z + (to.z - cur.z) * t;
        return true;
      }
      budget -= seg;
      cur = to;
    }
    out.x = cur.x;
    out.y = cur.y;
    out.z = cur.z;
    return true;
  };
}

export default InterceptService;

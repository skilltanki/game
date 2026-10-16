// Where an escort belongs: ahead of the carrier on its path (clearing the
// way) or behind it (between the carrier and whoever is chasing).
import type { Blackboard } from '../../../../classes/engine/Blackboard';
import type { Vec3Like } from '../../../../model/TankCommand';

/** Far enough ahead / behind that the escort never sits in the carrier's avoidance cone (900). */
const FRONT_AHEAD = 1000;
const REAR_BEHIND = 900;
/** With a known enemy this close to the carrier, the rear escort stands between them, this far from the carrier. */
const BLOCK_THREAT_RADIUS = 2500;
const BLOCK_DISTANCE = 350;
const BLOCK_SIGHTING_MS = 6000;

export class EscortService {
  public point = (board: Blackboard, role: 'escortFront' | 'escortRear', out: Vec3Like): boolean => {
    let carrierId: string | null = null;
    for (const [id, r] of board.roles) {
      if (r === 'carrier') carrierId = id;
    }
    if (carrierId == null) return false;
    const carrier = board.members.get(carrierId);
    if (carrier == null) return false;
    const pos = carrier.self.position;
    if (role === 'escortRear') {
      // Body-block: put the hull between the carrier and the nearest fresh threat.
      let threat: { x: number; y: number } | null = null;
      let threatD = BLOCK_THREAT_RADIUS;
      const now = carrier.now;
      for (const s of board.sightings.values()) {
        if (now - s.at > BLOCK_SIGHTING_MS) continue;
        const d = Math.hypot(s.x - pos.x, s.y - pos.y);
        if (d < threatD) {
          threatD = d;
          threat = s;
        }
      }
      if (threat != null && threatD > 1) {
        out.x = pos.x + ((threat.x - pos.x) / threatD) * BLOCK_DISTANCE;
        out.y = pos.y + ((threat.y - pos.y) / threatD) * BLOCK_DISTANCE;
        out.z = pos.z;
        return true;
      }
    }
    const path = board.paths.get(carrierId);
    if (path == null || path.length < 2) {
      out.x = pos.x;
      out.y = pos.y;
      out.z = pos.z;
      return true;
    }
    // The carrier's progress along its path: nearest waypoint.
    let index = 0;
    let bestD = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot(path[i].x - pos.x, path[i].y - pos.y);
      if (d < bestD) {
        bestD = d;
        index = i;
      }
    }
    const offset = role === 'escortFront' ? FRONT_AHEAD : -REAR_BEHIND;
    walk(path, index, pos, offset, out);
    return true;
  };
}

/** The point `offset` along the path from `from` near waypoint `index` (negative = backward). */
function walk(path: Vec3Like[], index: number, from: Vec3Like, offset: number, out: Vec3Like): void {
  let budget = Math.abs(offset);
  const step = offset >= 0 ? 1 : -1;
  let cur: Vec3Like = from;
  for (let i = index + (step > 0 ? 1 : 0); i >= 0 && i < path.length; i += step) {
    const to = path[i];
    const seg = Math.hypot(to.x - cur.x, to.y - cur.y);
    if (seg >= budget) {
      const t = seg > 0 ? budget / seg : 1;
      out.x = cur.x + (to.x - cur.x) * t;
      out.y = cur.y + (to.y - cur.y) * t;
      out.z = cur.z + (to.z - cur.z) * t;
      return;
    }
    budget -= seg;
    cur = to;
  }
  out.x = cur.x;
  out.y = cur.y;
  out.z = cur.z;
}

export default EscortService;

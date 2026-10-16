// A flag run by route: which of the base-to-base routes to take and how to
// drive it (waypoint at the middle first, then the goal). Shared by CTF and
// Assault; the MapInsight routes come through the TeamContext.
import type { BotMemory } from '../BotMemory';
import type { BotPerception } from '../../../model/Perception';
import type { Objective } from '../../../model/Objective';
import type { TeamContext } from '../../../model/engine/Tactics';
import type { Vec3Like } from '../../../model/TankCommand';

/** Route waypoint: this far along the chosen route (fraction of its length), passed within this radius. */
const ROUTE_WAYPOINT_AT = 0.5;
const ROUTE_WAYPOINT_RADIUS = 700;
/** A carrier re-checks which route is safer only against sightings this fresh. */
const SIGHTING_FRESH_MS = 5000;

export function routeLength(route: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
  return total;
}

/** The point at `fraction` of the route's length. */
export function pointAlong(route: Vec3Like[], fraction: number): Vec3Like {
  let budget = routeLength(route) * fraction;
  for (let i = 1; i < route.length; i++) {
    const seg = Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
    if (seg >= budget) {
      const t = seg > 0 ? budget / seg : 0;
      return { x: route[i - 1].x + (route[i].x - route[i - 1].x) * t, y: route[i - 1].y + (route[i].y - route[i - 1].y) * t, z: route[i - 1].z + (route[i].z - route[i - 1].z) * t };
    }
    budget -= seg;
  }
  return route[route.length - 1];
}

/** The route whose nearest point to any fresh sighting is farthest away. */
export function saferRoute(routes: Vec3Like[][], team: TeamContext): number {
  const fresh = team.knownEnemies().filter((k) => k.ageMs < SIGHTING_FRESH_MS);
  if (fresh.length === 0) return 0;
  let best = 0;
  let bestClearance = -1;
  for (let i = 0; i < routes.length; i++) {
    let clearance = Infinity;
    for (const p of routes[i]) {
      for (const k of fresh) {
        const d = Math.hypot(p.x - k.lastSeen.x, p.y - k.lastSeen.y);
        if (d < clearance) clearance = d;
      }
    }
    if (clearance > bestClearance) {
      bestClearance = clearance;
      best = i;
    }
  }
  return best;
}

/** Goto the chosen route's waypoint first (once), then the goal itself. */
export function alongRoute(perception: BotPerception, memory: BotMemory, routes: Vec3Like[][], goal: Vec3Like, arriveRadius: number): Objective {
  const route = routes[memory.routeIndex] ?? null;
  if (route == null || memory.routeWaypointDone) {
    return { kind: 'goto', point: goal, engage: true, arriveRadius };
  }
  const waypoint = pointAlong(route, ROUTE_WAYPOINT_AT);
  const self = perception.self;
  const toWaypoint = Math.hypot(waypoint.x - self.position.x, waypoint.y - self.position.y);
  const toGoal = Math.hypot(goal.x - self.position.x, goal.y - self.position.y);
  const waypointToGoal = Math.hypot(goal.x - waypoint.x, goal.y - waypoint.y);
  // Passed it, or already nearer the goal than the waypoint is: straight to the goal.
  if (toWaypoint < ROUTE_WAYPOINT_RADIUS || toGoal < waypointToGoal) {
    memory.routeWaypointDone = true;
    return { kind: 'goto', point: goal, engage: true, arriveRadius };
  }
  return { kind: 'goto', point: waypoint, engage: true, arriveRadius: ROUTE_WAYPOINT_RADIUS };
}

// The StaticWorld (model/engine/World) that lib/engine reflects the map
// through: downward/upward probes and box overlaps into the physics
// kd-tree, built once per battle after the map geometry is in.
import { Vector3 } from '../../../../engine/math/Vector3';
import { RayHit } from '../../../../engine/physics/collision/types/RayHit';
import { CollisionBox } from '../../../../engine/physics/collision/primitives/CollisionBox';
import { PhysicsMaterial } from '../../../../engine/physics/PhysicsMaterial';
import type { Box3Like, GroundHit, StaticWorld } from '../../../../model/engine/World';
import type { Vec3Like } from '../../../../model/TankCommand';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BattleStateService from '../battle/BattleStateService';

const _from = new Vector3();
const _dir = new Vector3();
const _hit = new RayHit();
const _probePos = new Vector3();
const DOWN = new Vector3(0, 0, -1);
const UP = new Vector3(0, 0, 1);

export class NavWorldAdapterService {
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);

  /** A world over the CURRENT battle's physics; valid until the battle is disposed. */
  public world = (): StaticWorld => {
    const physics = this.battleStateService.physics;
    const stage = this.battleStateService.mapStage;
    const detector = physics.getCollisionDetector();
    const bounds: Box3Like = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const shape of stage.staticShapes) {
      const a = shape.aabb;
      if (a.minX < bounds.minX) bounds.minX = a.minX;
      if (a.minY < bounds.minY) bounds.minY = a.minY;
      if (a.minZ < bounds.minZ) bounds.minZ = a.minZ;
      if (a.maxX > bounds.maxX) bounds.maxX = a.maxX;
      if (a.maxY > bounds.maxY) bounds.maxY = a.maxY;
      if (a.maxZ > bounds.maxZ) bounds.maxZ = a.maxZ;
    }
    if (bounds.minX === Infinity) {
      Object.assign(bounds, { minX: -1000, minY: -1000, minZ: -100, maxX: 1000, maxY: 1000, maxZ: 100 });
    }
    // A free probe box (no body of its own, so it tests against the static body).
    const probe = new CollisionBox(new Vector3(1, 1, 1), 0xffff, PhysicsMaterial.DEFAULT_MATERIAL);
    return {
      bounds,
      killZ: stage.killZ,
      gravity: Math.abs(physics.getGravity()),
      raycastDown(x: number, y: number, fromZ: number, depth: number, out: GroundHit): boolean {
        _from.reset(x, y, fromZ);
        const hit = detector.raycastStatic(_from, DOWN, 0xffff, depth, null, _hit);
        if (hit) {
          out.z = _hit.position.z;
          out.normalZ = _hit.normal.z;
        }
        _hit.clear();
        return hit;
      },
      headroom(x: number, y: number, z: number, height: number): boolean {
        _from.reset(x, y, z);
        return !detector.hasStaticHit(_from, UP, 0xffff, height, null);
      },
      probeBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): boolean {
        probe.hs.reset(hx, hy, hz);
        probe.transform.toIdentity();
        _probePos.reset(cx, cy, cz);
        probe.transform.setPosition(_probePos);
        probe.calculateAABB();
        return detector.testStaticCollision(probe);
      },
      lineOfSight(a: Vec3Like, b: Vec3Like): boolean {
        _from.reset(a.x, a.y, a.z);
        _dir.reset(b.x - a.x, b.y - a.y, b.z - a.z);
        const distance = _dir.length();
        if (distance < 1) return true;
        _dir.scale(1 / distance);
        return !detector.hasStaticHit(_from, _dir, 0xffff, distance, null);
      },
    };
  };
}

export default NavWorldAdapterService;

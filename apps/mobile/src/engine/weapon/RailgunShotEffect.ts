// Port of the railgun shot visuals from
// the original railgun effects: ShotTrailEffect + ShotTrail,
// ShotSmokeEffect + ShotSmoke, and RailgunPowEffect.
//
// Both the trail and the smoke are the same thing with different numbers: a
// quad spanning the whole ray (width x rayLength), axially billboarded to face
// the camera around the ray, whose texture V scrolls along the ray while the
// quad widens and fades out. RailgunEffects.createShotTrail spawns them as a
// pair on every shot; the "pow" flash is a flipbook at the hit point.
//
// Differences from the original:
//  - the original engine's Mesh/Vertex -> one PlayCanvas quad mesh built once and
//    scaled per shot (the original rebuilt vertex positions in ShotTrail.init);
//  - Sorting.DYNAMIC_BSP / softAttenuation / shadow-map thresholds are engine
//    features with no equivalent here and are dropped;
//  - the object pool is replaced by a plain array of live effects.

import * as pc from 'playcanvas';
import { buildMesh } from '../render/buildMesh';
import { Vector3 } from '../math/Vector3';

// RailgunEffects constants
const TRAIL_WIDTH = 25;
const TRAIL_BEGIN_SCALE = 0.5;
const TRAIL_END_SCALE = 1.5;
const TRAIL_MOVE_DISTANCE = 20;
const TRAIL_LIFE_TIME = 500;

const SMOKE_WIDTH = 80;
const SMOKE_BEGIN_SCALE = 0.5;
const SMOKE_END_SCALE = 2;
const SMOKE_MOVE_DISTANCE = 100;
const SMOKE_LIFE_TIME = 2200;

/** RailgunPowEffect: AnimatedPlane(30, 200, 0, -100, 0) — 200 wide, pulled back 100. */
const POW_SIZE = 200;
const POW_FPS = 30;

interface RibbonEffect {
  entity: pc.Entity;
  material: pc.StandardMaterial;
  /** Start point of the ray (the muzzle). */
  origin: Vector3;
  /** Unit direction along the ray. */
  direction: Vector3;
  length: number;
  /** ShotTrail.init's `width` — the quad's base width before scaling. */
  width: number;
  beginScale: number;
  endScale: number;
  /** ShotTrail.distanceV = moveDistance / width. */
  distanceV: number;
  /** ShotTrail.bottomV = rayLength / (width * texHeight / texWidth). */
  bottomV: number;
  ageMs: number;
  lifeMs: number;
}

/** A quad from y=0..1, x=-0.5..0.5 — scaled to width x length per shot. */
function ribbonMesh(device: pc.GraphicsDevice): pc.Mesh {
  const positions = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  return buildMesh(device, { positions, indices, uvs });
}

function ribbonMaterial(texture: pc.Texture, additive: boolean): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  configureRibbonMaterial(material, texture, additive);
  return material;
}

function configureRibbonMaterial(material: pc.StandardMaterial, texture: pc.Texture, additive: boolean): void {
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.useLighting = false;
  // The glowing rail trail is additive; the smoke is a dark puff and must be
  // alpha-blended or it would simply vanish against the sky.
  material.blendType = additive ? pc.BLEND_ADDITIVE : pc.BLEND_NORMAL;
  material.cull = pc.CULLFACE_NONE;
  material.depthWrite = false;
  // V tiles along the ray; U spans the ribbon width
  material.emissiveMap.addressV = pc.ADDRESS_REPEAT;
  material.opacityMap.addressV = pc.ADDRESS_REPEAT;
  material.opacity = 1;
  material.update();
}

async function loadTexture(app: pc.AppBase, url: string): Promise<pc.Texture> {
  return await new Promise((resolve, reject) => {
    const asset = new pc.Asset(url, 'texture', { url });
    asset.on('load', () => resolve(asset.resource as pc.Texture));
    asset.on('error', () => reject(new Error(`Failed to load ${url}`)));
    app.assets.add(asset);
    app.assets.load(asset);
  });
}

export class RailgunShotEffect {
  private readonly effects: RibbonEffect[] = [];
  /** Retired entities kept for reuse — see the note in update(). */
  private readonly pool: { entity: pc.Entity; material: pc.StandardMaterial }[] = [];
  private readonly mesh: pc.Mesh;

  private readonly _qA = new pc.Quat();
  private readonly _axisX = new pc.Vec3();
  private readonly _axisZ = new pc.Vec3();
  private readonly _dir = new pc.Vec3();

  private constructor(
    app: pc.AppBase,
    private readonly simRoot: pc.Entity,
    private readonly trailTexture: pc.Texture,
    private readonly smokeTexture: pc.Texture,
  ) {
    this.mesh = ribbonMesh(app.graphicsDevice);
  }

  static async create(app: pc.AppBase, simRoot: pc.Entity, trailUrl: string, smokeUrl: string): Promise<RailgunShotEffect> {
    const [trail, smoke] = await Promise.all([loadTexture(app, trailUrl), loadTexture(app, smokeUrl)]);
    return new RailgunShotEffect(app, simRoot, trail, smoke);
  }

  /**
   * RailgunEffects.createShotTrail: a trail and a smoke ribbon along the ray.
   * `from` is the muzzle, `to` the hit point (or a distant point on a miss).
   */
  spawnShot(from: Vector3, to: Vector3): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-3) {
      return;
    }
    const direction = new Vector3(dx / length, dy / length, dz / length);
    this.addRibbon(from, direction, length, this.trailTexture,
      TRAIL_WIDTH, TRAIL_BEGIN_SCALE, TRAIL_END_SCALE, TRAIL_MOVE_DISTANCE, TRAIL_LIFE_TIME, true);
    this.addRibbon(from, direction, length, this.smokeTexture,
      SMOKE_WIDTH, SMOKE_BEGIN_SCALE, SMOKE_END_SCALE, SMOKE_MOVE_DISTANCE, SMOKE_LIFE_TIME, false);
  }

  private addRibbon(
    from: Vector3,
    direction: Vector3,
    length: number,
    texture: pc.Texture,
    width: number,
    beginScale: number,
    endScale: number,
    moveDistance: number,
    lifeMs: number,
    additive: boolean,
  ): void {
    const reused = this.pool.pop();
    let entity: pc.Entity;
    let material: pc.StandardMaterial;
    if (reused != null) {
      entity = reused.entity;
      material = reused.material;
      entity.enabled = true;
      configureRibbonMaterial(material, texture, additive);
    } else {
      material = ribbonMaterial(texture, additive);
      entity = new pc.Entity('railgunRibbon');
      entity.addComponent('render', { meshInstances: [new pc.MeshInstance(this.mesh, material)] });
      this.simRoot.addChild(entity);
    }
    // ShotTrail.init: V repeats over the ray by the texture's aspect ratio.
    // bottomV is fixed for this ribbon's life, so the tiling is set once here
    // rather than rewritten every frame.
    const aspect = texture.height / texture.width;
    const bottomV = length / (width * aspect);
    material.emissiveMapTiling.set(1, bottomV);
    material.opacityMapTiling.set(1, bottomV);
    material.update();
    this.effects.push({
      entity,
      material,
      origin: new Vector3(from.x, from.y, from.z),
      direction,
      length,
      width,
      beginScale,
      endScale,
      distanceV: moveDistance / width,
      bottomV,
      ageMs: 0,
      lifeMs,
    });
    // Positioned on the first update(), which also rolls it toward the camera.
  }

  /** ShotTrailEffect.play — scale, fade and scroll, then align to the camera. */
  update(dtMs: number, cameraSimPos: pc.Vec3): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.ageMs += dtMs;
      if (fx.ageMs > fx.lifeMs) {
        // Only unparent the entity. The quad mesh is SHARED by every ribbon and
        // each material holds a shared texture, so destroying either the render
        // component's mesh or the material frees GPU resources still in use by
        // other live ribbons (and by the next shot) — that crashed the renderer.
        this.recycle(fx);
        this.effects.splice(i, 1);
        continue;
      }
      const t = fx.ageMs / fx.lifeMs;
      const progress = Math.sqrt(t); // the original's sqrt easing
      const width = (fx.beginScale + (fx.endScale - fx.beginScale) * progress) * fx.width;
      fx.material.opacity = 1 - t;
      // ShotTrail.update: V slides by distanceV * progress
      const offsetV = fx.distanceV * progress;
      fx.material.emissiveMapOffset.set(0, offsetV);
      fx.material.opacityMapOffset.set(0, offsetV);
      // One update() AFTER every change — PlayCanvas warns (and defers the
      // change a frame) if a map transform is written past the last update().
      fx.material.update();
      this.alignToCamera(fx, width, cameraSimPos);
    }
  }

  /** Park a finished ribbon for reuse (never destroys shared GPU resources). */
  private recycle(fx: RibbonEffect): void {
    fx.entity.enabled = false;
    this.pool.push({ entity: fx.entity, material: fx.material });
  }

  /**
   * SFXUtils.alignObjectPlaneToView: +Y of the quad runs along the ray, and the
   * quad rolls around that axis so its face turns toward the camera.
   */
  private alignToCamera(fx: RibbonEffect, width: number, cameraSimPos: pc.Vec3): void {
    this._dir.set(fx.direction.x, fx.direction.y, fx.direction.z);
    this._qA.setFromDirections(pc.Vec3.UP, this._dir);
    this._qA.transformVector(pc.Vec3.RIGHT, this._axisX);
    this._axisZ.set(0, 0, 1);
    this._qA.transformVector(this._axisZ, this._axisZ);
    const cx = cameraSimPos.x - fx.origin.x;
    const cy = cameraSimPos.y - fx.origin.y;
    const cz = cameraSimPos.z - fx.origin.z;
    const roll = Math.atan2(
      cx * this._axisX.x + cy * this._axisX.y + cz * this._axisX.z,
      cx * this._axisZ.x + cy * this._axisZ.y + cz * this._axisZ.z,
    );
    const rollQuat = new pc.Quat().setFromAxisAngle(pc.Vec3.UP, (roll * 180) / Math.PI);
    this._qA.mul(rollQuat);
    fx.entity.setLocalPosition(fx.origin.x, fx.origin.y, fx.origin.z);
    fx.entity.setLocalRotation(this._qA);
    fx.entity.setLocalScale(width, fx.length, 1);
  }

  /** RailgunPowEffect's size and frame rate, for the caller's flipbook. */
  static readonly POW_SIZE = POW_SIZE;
  static readonly POW_FPS = POW_FPS;
}

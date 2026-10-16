// Hit/death effects: the original flipbook sprite sheets (Battle/Death/
// explosion.png 17 frames, smoke.png 20 frames, 200x200 each, horizontal
// strip) played on camera-facing quads. Until the sheets finish loading a
// plain expanding flash quad is used as a fallback.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { Vector3 } from '../math/Vector3';

const FLASH_LIFETIME_MS = 350;

const EXPLOSION_URL = assetUrl('/battle/death/explosion.png');
const SMOKE_URL = assetUrl('/battle/death/smoke.png');
const MUSHROOM_URL = assetUrl('/battle/death/mushroom.png');
const EXPLOSION_FRAMES = 17;
const MUSHROOM_FRAMES = 16;
/** Tile is drawn with the blast seated on its bottom edge (ground at 0.95h). */
const MUSHROOM_GROUND_FRACTION = 0.95;
/**
 * Fraction of the tile height the grown cloud actually covers (measured off
 * the sheet: drawn rows 17..190 of 192 => 0.90). Callers pass the height they
 * want the CLOUD to have, so the tile is scaled up by the inverse.
 */
const MUSHROOM_FILL_FRACTION = 0.90;
/**
 * Small sink into the ground, as a fraction of the tile, so the foot of the
 * stem is buried in the wreck/terrain instead of ending on a hard edge.
 */
const MUSHROOM_SINK = 0.04;
const SMOKE_FRAMES = 20;

interface Flash {
  entity: pc.Entity;
  material: pc.StandardMaterial;
  ttlMs: number;
  startSize: number;
  endSize: number;
}

interface Flipbook {
  entity: pc.Entity;
  material: pc.StandardMaterial;
  frames: number;
  durationMs: number;
  ageMs: number;
  startSize: number;
  endSize: number;
  // units/s drift (smoke rises, jet particles fly along the stream)
  vx: number;
  vy: number;
  vz: number;
  /** When set, the effect follows this point every frame (muzzle charge). */
  follow: ((out: Vector3) => void) | null;
  /**
   * Keeps the quad's BOTTOM edge pinned while it grows (the mushroom rises
   * from the wreck instead of scaling around its centre, which would sink
   * the stem into the ground).
   */
  groundZ: number | null;
}

export class HitEffects {
  private flashes: Flash[] = [];
  private flipbooks: Flipbook[] = [];
  private explosionTexture: pc.Texture | null = null;
  private smokeTexture: pc.Texture | null = null;
  private mushroomTexture: pc.Texture | null = null;
  private sheets = new Map<string, { texture: pc.Texture; frames: number }>();
  private app: pc.AppBase | null = null;

  constructor(private simRoot: pc.Entity) {}

  /** Loads the sprite sheets (effects fall back to flat flashes until then). */
  init(app: pc.AppBase): void {
    this.app = app;
    const load = (url: string, assign: (t: pc.Texture) => void): void => {
      app.assets.loadFromUrl(url, 'texture', (err, asset) => {
        if (err == null && asset != null) {
          assign(asset.resource as pc.Texture);
        } else {
          console.warn(`HitEffects: failed to load ${url}`, err);
        }
      });
    };
    load(EXPLOSION_URL, (t) => (this.explosionTexture = t));
    load(SMOKE_URL, (t) => (this.smokeTexture = t));
    load(MUSHROOM_URL, (t) => (this.mushroomTexture = t));
  }

  /** Registers a named flipbook sheet (e.g. per-turret muzzle flash). */
  registerSheet(key: string, url: string, frames: number): void {
    if (this.app == null || this.sheets.has(key)) {
      return;
    }
    this.app.assets.loadFromUrl(url, 'texture', (err, asset) => {
      if (err == null && asset != null) {
        this.sheets.set(key, { texture: asset.resource as pc.Texture, frames });
      } else {
        console.warn(`HitEffects: failed to load sheet ${url}`, err);
      }
    });
  }

  hasSheet(key: string): boolean {
    return this.sheets.has(key);
  }

  /** Plays a registered flipbook at a position (no-op until it loaded). */
  spawnSheet(key: string, position: Vector3, size: number, durationMs: number): void {
    const sheet = this.sheets.get(key);
    if (sheet != null) {
      this.spawnFlipbook(sheet.texture, sheet.frames, position, size, durationMs, 0);
    }
  }

  /**
   * Flamethrower-style jet particle: spawns at the muzzle, flies along the
   * stream, grows from startSize to endSize and burns through its frames.
   */
  spawnJetParticle(
    key: string,
    position: Vector3,
    startSize: number,
    endSize: number,
    durationMs: number,
    velocity: { x: number; y: number; z: number },
    tint: pc.Color | null = null,
  ): void {
    const sheet = this.sheets.get(key);
    if (sheet == null) {
      return;
    }
    this.spawnFlipbook(sheet.texture, sheet.frames, position, startSize, durationMs, 0, tint);
    const fx = this.flipbooks[this.flipbooks.length - 1];
    fx.endSize = endSize;
    fx.vx = velocity.x;
    fx.vy = velocity.y;
    fx.vz = velocity.z;
  }

  /** Fire burst on a tank hit (original explosion flipbook, small). */
  spawnTankHit(position: Vector3): void {
    if (this.explosionTexture != null) {
      this.spawnFlipbook(this.explosionTexture, EXPLOSION_FRAMES, position, 190, 450, 0);
    } else {
      this.spawnFlash(position, new pc.Color(1, 0.55, 0.15), 60, 220);
    }
  }

  /** Grey puff on static geometry. */
  spawnStaticHit(position: Vector3): void {
    if (this.smokeTexture != null) {
      this.spawnFlipbook(this.smokeTexture, SMOKE_FRAMES, position, 120, 500, 60);
    } else {
      this.spawnFlash(position, new pc.Color(0.75, 0.73, 0.68), 40, 140);
    }
  }

  /**
   * Big blast + rising smoke on a tank death. Pass the tank CENTER — the
   * effect lifts itself above the hull so the fireball is not swallowed by
   * the opaque tank mesh (depth test clips the lower half otherwise).
   *
   * Sized well above the hull on purpose: at the old 560 the fireball was
   * about as wide as the turret and sat behind the wreck, so a kill looked
   * like it had no explosion at all. The fireball now engulfs the tank and
   * the smoke lingers after it burns out.
   */
  spawnExplosion(position: Vector3): void {
    const lifted = this._lifted.copy(position);
    lifted.z += 150;
    if (this.explosionTexture != null) {
      this.spawnFlipbook(this.explosionTexture, EXPLOSION_FRAMES, lifted, 1150, 1000, 40);
      if (this.smokeTexture != null) {
        this.spawnFlipbook(this.smokeTexture, SMOKE_FRAMES, lifted, 900, 2200, 150);
      }
    } else {
      this.spawnFlash(lifted, new pc.Color(1, 0.45, 0.1), 240, 960);
      this.spawnFlash(lifted, new pc.Color(1, 0.8, 0.3), 120, 600);
    }
  }

  /**
   * Mushroom cloud for the self-destruct / death blast. Drawn for this port
   * (the SWF dump has no explosion art beyond the small fireball) by
   * scripts/make_mushroom.py.
   *
   * `cloudHeight` is the height of the VISIBLE cloud in sim units (ground line
   * to the top of the cap), not the quad size — the sheet leaves headroom, so
   * the tile is scaled up to compensate.
   */
  spawnMushroom(position: Vector3, cloudHeight: number, durationMs = 2600): void {
    if (this.mushroomTexture == null) {
      // Sheet still loading — fall back to the existing blast so the death
      // always reads as an explosion.
      this.spawnExplosion(position);
      return;
    }
    const size = cloudHeight / MUSHROOM_FILL_FRACTION;
    this.spawnFlipbook(this.mushroomTexture, MUSHROOM_FRAMES, position, size, durationMs, 0);
    const fx = this.flipbooks[this.flipbooks.length - 1];
    // Grow from a tight flash to full height, hinged on the ground.
    fx.startSize = size * 0.45;
    fx.endSize = size;
    fx.groundZ = position.z;
    fx.entity.setLocalScale(fx.startSize, 1, fx.startSize);
    this.placeAnchored(fx, fx.startSize);
  }

  /**
   * Puts a bottom-anchored quad so its drawn ground line sits on groundZ.
   *
   * The chase camera sits low and close behind the tank, so a cloud anchored
   * strictly to the ground pushes its centre up by ~0.45 of the tile and ends
   * up above the viewport entirely (measured: tile centre projected to y=-64
   * on a 677px canvas, with the spawn point dead centre at y=339). The cloud
   * is therefore sunk by SINK so the mass of it stays on screen; the stem's
   * base goes slightly below ground, which is hidden by the wreck and the
   * terrain anyway.
   */
  private placeAnchored(fx: Flipbook, size: number): void {
    if (fx.groundZ == null) {
      return;
    }
    const p = fx.entity.getLocalPosition();
    const centreZ = fx.groundZ + size * (MUSHROOM_GROUND_FRACTION - 0.5 - MUSHROOM_SINK);
    fx.entity.setLocalPosition(p.x, p.y, centreZ);
  }

  private readonly _lifted = new Vector3();

  private spawnFlipbook(
    texture: pc.Texture,
    frames: number,
    position: Vector3,
    size: number,
    durationMs: number,
    riseSpeed: number,
    tint: pc.Color | null = null,
  ): void {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0, 0, 0);
    if (tint != null) {
      // Recolouring: the smoke sheet's RGB is essentially black (max channel 46)
      // and its shape lives in the ALPHA channel, so a tint only works by
      // dropping the colour map and painting a flat colour through that mask.
      // The original loaded a per-map dust sprite from the server; that
      // resource is not in this dump, hence reusing the puff's alpha shape.
      material.emissive = tint;
    } else {
      material.emissive = new pc.Color(1, 1, 1);
      material.emissiveMap = texture;
    }
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.useLighting = false;
    material.blendType = pc.BLEND_NORMAL;
    material.cull = pc.CULLFACE_NONE;
    material.depthWrite = false;
    if (material.emissiveMap != null) {
      material.emissiveMapTiling = new pc.Vec2(1 / frames, 1);
    }
    material.opacityMapTiling = new pc.Vec2(1 / frames, 1);
    material.update();

    const entity = new pc.Entity('hitFx');
    entity.addComponent('render', { type: 'plane' });
    entity.render!.material = material;
    entity.setLocalPosition(position.x, position.y, position.z);
    entity.setLocalScale(size, 1, size);
    this.simRoot.addChild(entity);
    this.flipbooks.push({
      entity, material, frames, durationMs, ageMs: 0,
      startSize: size, endSize: size, vx: 0, vy: 0, vz: riseSpeed, follow: null,
      groundZ: null,
    });
  }

  /**
   * Flipbook pinned to a moving point (original ChargeEffect: the railgun
   * charge sprite rides the muzzle while the turret turns). Frames play over
   * exactly durationMs, like getChargingEffectFPS did.
   */
  spawnAttachedSheet(key: string, follow: (out: Vector3) => void, size: number, durationMs: number): void {
    const sheet = this.sheets.get(key);
    if (sheet == null) {
      return;
    }
    follow(this._followPoint);
    this.spawnFlipbook(sheet.texture, sheet.frames, this._followPoint, size, durationMs, 0);
    this.flipbooks[this.flipbooks.length - 1].follow = follow;
  }

  private readonly _followPoint = new Vector3();

  private spawnFlash(position: Vector3, color: pc.Color, startSize: number, endSize: number): void {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0, 0, 0);
    material.emissive = color;
    material.useLighting = false;
    material.blendType = pc.BLEND_ADDITIVE;
    material.opacity = 0.95;
    material.cull = pc.CULLFACE_NONE;
    material.depthWrite = false;
    material.update();

    const entity = new pc.Entity('hit');
    entity.addComponent('render', { type: 'plane' });
    entity.render!.material = material;
    entity.setLocalPosition(position.x, position.y, position.z);
    entity.setLocalScale(startSize, 1, startSize);
    this.simRoot.addChild(entity);
    this.flashes.push({ entity, material, ttlMs: FLASH_LIFETIME_MS, startSize, endSize });
  }

  /**
   * Turns a quad toward the camera.
   *
   * `upright` billboards around the vertical axis ONLY (yaw, no pitch): a
   * mushroom cloud stands on the ground, and tilting it to face the camera
   * head-on lays it over so it reads as a flat smudge floating in the sky.
   * Round puffs (hits, smoke) have no up, so they take the full billboard.
   */
  private faceCamera(entity: pc.Entity, camSimPos: pc.Vec3, upright = false): void {
    // Plane is +Y-up in local space: yaw around sim Z, then tilt by pitch
    const p = entity.getLocalPosition();
    const angle = Math.atan2(-(camSimPos.x - p.x), camSimPos.y - p.y);
    if (upright) {
      // Stand the plane up (90 deg about X) and only spin it to face the camera.
      entity.setLocalEulerAngles(90, 0, (angle * 180) / Math.PI);
      return;
    }
    const dx = camSimPos.x - p.x;
    const dy = camSimPos.y - p.y;
    const horizontal = Math.sqrt(dx * dx + dy * dy);
    const pitch = Math.atan2(camSimPos.z - p.z, horizontal);
    entity.setLocalEulerAngles(90 - (pitch * 180) / Math.PI, 0, (angle * 180) / Math.PI);
  }

  /** Per-frame: advance frames/fade, face the camera (camSimPos in sim space). */
  update(dtMs: number, camSimPos: pc.Vec3): void {
    for (let i = this.flipbooks.length - 1; i >= 0; i--) {
      const fx = this.flipbooks[i];
      fx.ageMs += dtMs;
      if (fx.ageMs >= fx.durationMs) {
        fx.entity.destroy();
        this.flipbooks[i] = this.flipbooks[this.flipbooks.length - 1];
        this.flipbooks.pop();
        continue;
      }
      const t = fx.ageMs / fx.durationMs;
      const frame = Math.min(fx.frames - 1, (t * fx.frames) | 0);
      fx.material.emissiveMapOffset.set(frame / fx.frames, 0);
      fx.material.opacityMapOffset.set(frame / fx.frames, 0);
      fx.material.update();
      if (fx.follow != null) {
        fx.follow(this._followPoint);
        fx.entity.setLocalPosition(this._followPoint.x, this._followPoint.y, this._followPoint.z);
      } else if (fx.vx !== 0 || fx.vy !== 0 || fx.vz !== 0) {
        const p = fx.entity.getLocalPosition();
        const k = dtMs / 1000;
        fx.entity.setLocalPosition(p.x + fx.vx * k, p.y + fx.vy * k, p.z + fx.vz * k);
      }
      if (fx.endSize !== fx.startSize) {
        const size = fx.startSize + (fx.endSize - fx.startSize) * t;
        fx.entity.setLocalScale(size, 1, size);
        this.placeAnchored(fx, size);
      }
      this.faceCamera(fx.entity, camSimPos, fx.groundZ != null);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.ttlMs -= dtMs;
      if (flash.ttlMs <= 0) {
        flash.entity.destroy();
        this.flashes[i] = this.flashes[this.flashes.length - 1];
        this.flashes.pop();
        continue;
      }
      const t = 1 - flash.ttlMs / FLASH_LIFETIME_MS;
      const size = flash.startSize + (flash.endSize - flash.startSize) * t;
      flash.entity.setLocalScale(size, 1, size);
      flash.material.opacity = 0.95 * (1 - t);
      flash.material.update();
      this.faceCamera(flash.entity, camSimPos);
    }
  }
}

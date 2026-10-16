// Shot tracers: a glowing beam from the muzzle to the hit point that fades
// out. Hitscan turrets use their original shot textures (smoky/snowman
// shot.png, shaft_trail.png) stretched along the beam; stream turrets get
// tinted plain beams. Fallback (and Railgun base) is the plain colored beam.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { Vector3 } from '../math/Vector3';

const TRACER_LIFETIME_MS = 280;

interface TracerStyle {
  /** Original shot texture stretched along the beam (optional). */
  url?: string;
  tint: pc.Color;
  thickness: number;
  lifetimeMs?: number;
}

// Keyed by turret name; 'default' is the old plain blue beam
const STYLES: Record<string, TracerStyle> = {
  default: { tint: new pc.Color(0.55, 0.8, 1), thickness: 7 },
  Railgun: { tint: new pc.Color(0.5, 0.75, 1), thickness: 10 },
  Smoky: { url: assetUrl('/turrets/smoky/m0/shot.png'), tint: new pc.Color(1, 1, 1), thickness: 12 },
  Shaft: { url: assetUrl('/turrets/shaft/m0/shaft_trail.png'), tint: new pc.Color(1, 1, 1), thickness: 16, lifetimeMs: 450 },
  Firebird: { tint: new pc.Color(1, 0.5, 0.1), thickness: 22, lifetimeMs: 200 },
  Freeze: { tint: new pc.Color(0.6, 0.85, 1), thickness: 22, lifetimeMs: 200 },
  Isida: { tint: new pc.Color(1, 0.25, 0.25), thickness: 12, lifetimeMs: 220 },
};

interface Tracer {
  entity: pc.Entity;
  material: pc.StandardMaterial;
  ttlMs: number;
  lifetimeMs: number;
}

export class TracerEffects {
  private tracers: Tracer[] = [];
  private textures = new Map<string, pc.Texture>();

  constructor(private simRoot: pc.Entity) {}

  /** Loads the per-turret shot textures (plain beams until loaded). */
  init(app: pc.AppBase): void {
    const urls = new Set<string>();
    for (const style of Object.values(STYLES)) {
      if (style.url != null) {
        urls.add(style.url);
      }
    }
    for (const url of urls) {
      app.assets.loadFromUrl(url, 'texture', (err, asset) => {
        if (err == null && asset != null) {
          this.textures.set(url, asset.resource as pc.Texture);
        } else {
          console.warn(`TracerEffects: failed to load ${url}`, err);
        }
      });
    }
  }

  spawn(from: Vector3, to: Vector3, styleKey = 'default'): void {
    const style = STYLES[styleKey] ?? STYLES.default;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1) {
      return;
    }
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0, 0, 0);
    material.emissive = style.tint.clone();
    material.useLighting = false;
    material.depthWrite = false;
    const texture = style.url != null ? this.textures.get(style.url) : undefined;
    if (texture != null) {
      material.emissiveMap = texture;
      material.opacityMap = texture;
      material.opacityMapChannel = 'a';
      material.blendType = pc.BLEND_NORMAL;
      material.cull = pc.CULLFACE_NONE;
    } else {
      material.blendType = pc.BLEND_ADDITIVE;
      material.opacity = 0.9;
    }
    material.update();

    const entity = new pc.Entity('tracer');
    entity.addComponent('render', { type: 'box' });
    entity.render!.material = material;
    entity.setLocalScale(style.thickness, length, style.thickness);
    entity.setLocalPosition(from.x + dx / 2, from.y + dy / 2, from.z + dz / 2);
    // Orient local +Y along the shot: euler ZYX with pitch about X, yaw about Z
    const horizontal = Math.sqrt(dx * dx + dy * dy);
    const pitch = Math.atan2(dz, horizontal);
    const yaw = Math.atan2(-dx, dy);
    entity.setLocalEulerAngles((pitch * 180) / Math.PI, 0, (yaw * 180) / Math.PI);
    this.simRoot.addChild(entity);
    const lifetimeMs = style.lifetimeMs ?? TRACER_LIFETIME_MS;
    this.tracers.push({ entity, material, ttlMs: lifetimeMs, lifetimeMs });
  }

  update(dtMs: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.ttlMs -= dtMs;
      if (tracer.ttlMs <= 0) {
        tracer.entity.destroy();
        this.tracers[i] = this.tracers[this.tracers.length - 1];
        this.tracers.pop();
      } else {
        tracer.material.opacity = 0.9 * (tracer.ttlMs / tracer.lifetimeMs);
        tracer.material.update();
      }
    }
  }
}

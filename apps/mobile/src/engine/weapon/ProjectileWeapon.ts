// Projectile weapons (original plasma/thunder/ricochet models): glowing shells
// fly at a finite speed, detonate on impact; Thunder adds splash damage
// (SplashParams falloff formula ported), Ricochet bounces off static geometry.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { Vector3 } from '../math/Vector3';
import { dealDamage } from './DamageSink';
import { rollBaseDamage, weakeningMultiplier, UNITS_PER_METER } from './DamageModel';
import { WEAPON_BALANCE, type WeaponBalance } from './WeaponBalance';
import { RayHit } from '../physics/collision/types/RayHit';
import type { Body } from '../physics/Body';
import type { IRayCollisionFilter } from '../physics/collision/filters';
import type { Tank } from '../tank/Tank';
import type { TanksCollisionDetector } from '../tank/TanksCollisionDetector';
import type { Weapon } from './Weapon';
import type { ShotResult, WeaponListener } from './RailgunWeapon';

// SplashSpec and the SplashParams falloff moved to WeaponSpecs.ts (a pure
// module the multiplayer server imports); re-exported for existing importers.
export { splashCoeff, type SplashSpec } from './WeaponSpecs';
import { splashCoeff, type SplashSpec } from './WeaponSpecs';

export interface ProjectileSpec {
  /** Balance profile id (WEAPON_BALANCE); see RailgunSpec.balance. */
  balance?: string;
  reloadTime: number;
  damage: number;
  speed: number; // units/s
  impactForce: number;
  recoilForce: number;
  maxRange: number;
  bounces: number; // Ricochet
  splash: SplashSpec | null; // Thunder
  color: { r: number; g: number; b: number };
  /** Original shell sprite (horizontal flipbook strip when frames > 1). */
  sprite?: { url: string; frames: number; size: number };
  /**
   * PlasmaShot.render: the shell fades out over the LAST this-many units of its
   * range (PlasmaShotParams.ALPHA_FADE_DISTANCE = 500 for Twins) and spins
   * about the view axis at `spinRate` rad/s (the original used 3).
   */
  alphaFadeDistance?: number;
  spinRate?: number;
}

interface Projectile {
  /**
   * A remote tank's relayed launch: flies, spins and bounces like a real
   * shell but deals no damage and vanishes silently on impact — the
   * authoritative detonation arrives as its own relayed event.
   */
  visual?: boolean;
  position: Vector3;
  direction: Vector3;
  traveled: number;
  bouncesLeft: number;
  entity: pc.Entity;
  spriteMaterial: pc.StandardMaterial | null;
  ageMs: number;
  /** PlasmaShot.render: sprite roll, advanced by spinRate each step. */
  spin: number;
}

export class ProjectileWeapon implements Weapon {
  private nextTime = 0;
  private triggerPressed = false;
  private projectiles: Projectile[] = [];
  private readonly rayHit = new RayHit();
  private readonly filter: IRayCollisionFilter;
  private readonly _muzzle = new Vector3();
  private readonly _dir = new Vector3();
  private readonly _tmp = new Vector3();
  private readonly _occPoint = new Vector3();
  private readonly _occDir = new Vector3();
  private readonly _occHit = new RayHit();
  private material: pc.StandardMaterial;
  private spriteTexture: pc.Texture | null = null;

  constructor(
    private owner: Tank,
    private spec: ProjectileSpec,
    private detector: TanksCollisionDetector,
    private simRoot: pc.Entity,
    private listener: WeaponListener | null,
    private getAllTanks: () => Tank[],
    app: pc.AppBase | null = null,
  ) {
    const ownBody = owner.getBody();
    this.filter = { considerBody: (body: Body) => body !== ownBody };
    this.material = new pc.StandardMaterial();
    this.material.diffuse = new pc.Color(0, 0, 0);
    this.material.emissive = new pc.Color(spec.color.r, spec.color.g, spec.color.b);
    this.material.useLighting = false;
    this.material.blendType = pc.BLEND_ADDITIVE;
    this.material.depthWrite = false;
    this.material.update();
    if (spec.sprite != null && app != null) {
      // spec.sprite.url is pure data (WeaponSpecs is shared with the worker);
      // the base-aware rewrite happens here, at the consumer.
      app.assets.loadFromUrl(assetUrl(spec.sprite.url), 'texture', (err, asset) => {
        if (err == null && asset != null) {
          this.spriteTexture = asset.resource as pc.Texture;
        } else {
          console.warn(`ProjectileWeapon: failed to load ${spec.sprite!.url}`, err);
        }
      });
    }
  }

  /**
   * Shell visual: a single camera-facing sprite quad (billboarded every frame
   * via updateBillboards) so the fireball reads as a volumetric ball, with a
   * glowing sphere as the fallback until the texture loads.
   */
  private buildShellEntity(): { entity: pc.Entity; spriteMaterial: pc.StandardMaterial | null } {
    const sprite = this.spec.sprite;
    if (sprite == null || this.spriteTexture == null) {
      const entity = new pc.Entity('shell');
      entity.addComponent('render', { type: 'sphere' });
      entity.render!.material = this.material;
      entity.setLocalScale(26, 26, 26);
      return { entity, spriteMaterial: null };
    }
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0, 0, 0);
    material.emissive = new pc.Color(1, 1, 1);
    material.emissiveMap = this.spriteTexture;
    material.opacityMap = this.spriteTexture;
    material.opacityMapChannel = 'a';
    material.useLighting = false;
    // NORMAL blend honors the sprite alpha; ADDITIVE painted the transparent
    // background as a white square ("envelopes" instead of fireballs)
    material.blendType = pc.BLEND_NORMAL;
    material.cull = pc.CULLFACE_NONE;
    material.depthWrite = false;
    if (sprite.frames > 1) {
      material.emissiveMapTiling = new pc.Vec2(1 / sprite.frames, 1);
      material.opacityMapTiling = new pc.Vec2(1 / sprite.frames, 1);
    }
    material.update();
    const entity = new pc.Entity('shell');
    entity.addComponent('render', { type: 'plane' });
    entity.render!.material = material;
    entity.setLocalScale(sprite.size, 1, sprite.size);
    return { entity, spriteMaterial: material };
  }

  private readonly _billboardQuat = new pc.Quat();
  private readonly _spinQuat = new pc.Quat();

  /** Called from the render loop: turn every shell sprite toward the camera. */
  updateBillboards(camSimPos: { x: number; y: number; z: number }): void {
    for (const projectile of this.projectiles) {
      if (projectile.spriteMaterial == null) {
        continue;
      }
      // Same math as HitEffects.faceCamera: unrotated, the plane stands
      // vertical facing sim +Y; yaw about Z, elevation about X.
      const p = projectile.position;
      const dx = camSimPos.x - p.x;
      const dy = camSimPos.y - p.y;
      const yaw = Math.atan2(-dx, dy);
      const horizontal = Math.sqrt(dx * dx + dy * dy);
      const pitch = Math.atan2(camSimPos.z - p.z, horizontal);
      this._billboardQuat.setFromEulerAngles((pitch * 180) / Math.PI, 0, (yaw * 180) / Math.PI);
      // PlasmaShot.render: the sprite also spins about the VIEW axis, i.e.
      // about the plane's own normal (local +Y). Applied first, in local
      // space, so it stays a spin whatever the billboard's tilt (a Y euler
      // between X and Z turned it about the WORLD Y instead).
      this._spinQuat.setFromAxisAngle(pc.Vec3.UP, (projectile.spin * 180) / Math.PI);
      this._billboardQuat.mul(this._spinQuat);
      projectile.entity.setLocalRotation(this._billboardQuat);
      // PlasmaShot.render: alpha ramps down over the last ALPHA_FADE_DISTANCE
      const fade = this.spec.alphaFadeDistance;
      if (fade != null && fade > 0) {
        const left = this.spec.maxRange - projectile.traveled;
        const alpha = left < fade ? Math.max(0, left / fade) : 1;
        if (alpha !== projectile.spriteMaterial.opacity) {
          projectile.spriteMaterial.opacity = alpha;
          projectile.spriteMaterial.update();
        }
      }
    }
  }

  /** Called with the shell position when a projectile dies at max range. */
  onExpire: ((position: Vector3) => void) | null = null;

  /**
   * Spawns a VISUAL-ONLY shell for a remote tank's relayed launch. It rides
   * the same advance loop as real shells — speed, spin, flipbook, Ricochet
   * bounces, max-range fade — but never deals damage or reports events.
   */
  launchVisualShell(origin: Vector3, direction: Vector3): void {
    const { entity, spriteMaterial } = this.buildShellEntity();
    entity.setLocalPosition(origin.x, origin.y, origin.z);
    this.simRoot.addChild(entity);
    this.projectiles.push({
      position: origin.clone(),
      direction: direction.clone().normalize(),
      traveled: 0,
      spin: 0,
      bouncesLeft: this.spec.bounces,
      entity,
      spriteMaterial,
      ageMs: 0,
      visual: true,
    });
  }

  setTrigger(pressed: boolean): void {
    this.triggerPressed = pressed;
  }

  /**
   * Nuclear fuel tops the weapon up. A timer-reload gun has no gauge, so the
   * equivalent of "full energy" is finishing the pending reload at once —
   * without this the supply did nothing at all for Thunder/Twins/Ricochet.
   */
  addEnergy(delta: number): void {
    if (delta > 0) {
      this.nextTime = 0;
    }
  }

  getStatus(timeMs: number): number {
    const reload = this.spec.reloadTime * this.owner.getReloadScale();
    return Math.max(0, Math.min(1, 1 - (this.nextTime - timeMs) / reload));
  }

  reset(): void {
    this.triggerPressed = false;
    this.nextTime = 0;
    for (const projectile of this.projectiles) {
      projectile.entity.destroy();
    }
    this.projectiles.length = 0;
  }

  update(timeMs: number, getMuzzle: (out: Vector3) => void, getDirection: (out: Vector3) => void): void {
    // Fire
    if (!this.owner.isDead() && this.triggerPressed && timeMs >= this.nextTime) {
      this.nextTime = timeMs + this.spec.reloadTime * this.owner.getReloadScale();
      getMuzzle(this._muzzle);
      getDirection(this._dir);
      this.owner.getBody().addWorldForceScaled(this._muzzle, this._dir, -this.spec.recoilForce);
      const { entity, spriteMaterial } = this.buildShellEntity();
      entity.setLocalPosition(this._muzzle.x, this._muzzle.y, this._muzzle.z);
      this.simRoot.addChild(entity);
      this.projectiles.push({
        position: this._muzzle.clone(),
        direction: this._dir.clone(),
        traveled: 0,
        spin: 0,
        bouncesLeft: this.spec.bounces,
        entity,
        spriteMaterial,
        ageMs: 0,
      });
      // Muzzle "shot" event for sound/flash (no instant tracer/hit)
      this.listener?.onShot({
        origin: this._muzzle.clone(),
        direction: this._dir.clone(),
        endPoint: this._muzzle.clone(),
        staticHit: false,
        hits: [],
      });
    }
    // Advance shells (fixed physics step dt is encoded by caller cadence: 33ms)
    const dt = 0.033;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      // PlasmaShot.render: sprite.rotation -= 3 * dt
      projectile.spin -= (this.spec.spinRate ?? 0) * dt;
      let remaining = this.spec.speed * dt;
      let exploded = false;
      for (let hop = 0; hop < 3 && remaining > 0.01 && !exploded; hop++) {
        const hasHit = this.detector.raycast(projectile.position, projectile.direction, 0xffff, remaining, this.filter, this.rayHit);
        if (!hasHit) {
          projectile.position.addScaled(remaining, projectile.direction);
          projectile.traveled += remaining;
          remaining = 0;
          break;
        }
        const hitDistance = this.rayHit.t;
        const hitBody = this.rayHit.shape!.body!;
        const target = hitBody.tank as Tank | null;
        projectile.position.copy(this.rayHit.position);
        projectile.traveled += hitDistance;
        remaining -= hitDistance;
        if (target == null && projectile.bouncesLeft > 0) {
          // Ricochet: reflect off static geometry
          projectile.bouncesLeft--;
          const n = this.rayHit.normal;
          const d = projectile.direction;
          const dot = d.x * n.x + d.y * n.y + d.z * n.z;
          d.x -= 2 * dot * n.x;
          d.y -= 2 * dot * n.y;
          d.z -= 2 * dot * n.z;
          d.normalize();
          projectile.position.addScaled(1, d); // nudge off the surface
        } else if (projectile.visual) {
          // Remote shell: vanish; the relayed detonation draws the boom.
          projectile.entity.destroy();
          exploded = true;
        } else {
          this.explode(projectile, target);
          exploded = true;
        }
      }
      if (!exploded && projectile.traveled >= this.spec.maxRange) {
        // Shell ran out of range without hitting anything — the original
        // dissipated the plasma ball here (Twins' fade.png).
        this.onExpire?.(projectile.position);
        projectile.entity.destroy();
        this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
        this.projectiles.pop();
        continue;
      }
      if (exploded) {
        this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
        this.projectiles.pop();
      } else {
        projectile.entity.setLocalPosition(projectile.position.x, projectile.position.y, projectile.position.z);
        projectile.ageMs += dt * 1000;
        const sprite = this.spec.sprite;
        if (sprite != null && sprite.frames > 1 && projectile.spriteMaterial != null) {
          // ~30 fps looping flipbook (e.g. the Ricochet plasma ball)
          const frame = ((projectile.ageMs / 33) | 0) % sprite.frames;
          projectile.spriteMaterial.emissiveMapOffset.set(frame / sprite.frames, 0);
          projectile.spriteMaterial.opacityMapOffset.set(frame / sprite.frames, 0);
          projectile.spriteMaterial.update();
        }
      }
    }
  }

  private explode(projectile: Projectile, directTarget: Tank | null): void {
    const result: ShotResult = {
      origin: projectile.position.clone(),
      direction: projectile.direction.clone(),
      endPoint: projectile.position.clone(),
      staticHit: directTarget == null,
      hits: [],
    };
    // Base damage: gaussian roll from the server's range, faded by the shot's
    // travel distance. The existing splash coefficient below is the port's own
    // falloff and stays as-is — it shapes the blast, not the base roll.
    const balance = (this.spec as { modBalance?: WeaponBalance }).modBalance
      ?? (this.spec.balance != null ? WEAPON_BALANCE[this.spec.balance] : undefined);
    let damage = balance != null
      ? rollBaseDamage(balance.damage)
      : this.spec.damage;
    if (balance?.damage.weakening != null) {
      damage *= weakeningMultiplier(balance.damage.weakening, projectile.traveled / UNITS_PER_METER);
    }
    damage *= this.owner.outgoingDamageMultiplier;
    const isEnemy = (tank: Tank): boolean => tank.team === 'dm' || tank.team !== this.owner.team;
    if (directTarget != null && isEnemy(directTarget)) {
      directTarget.applyWeaponHit(projectile.position, projectile.direction, this.spec.impactForce);
      const lethal = dealDamage({ source: this.owner, target: directTarget, amount: damage, at: projectile.position });
      result.hits.push({ tank: directTarget, position: projectile.position.clone(), lethal });
    }
    if (this.spec.splash != null) {
      for (const tank of this.getAllTanks()) {
        // Self-damage: the ProTanki server enables it by default
        // (BattleProperty.SelfDamageEnabled = true), so a shell at your own
        // feet hurts. The shooter is excluded from the projectile's RAYCAST
        // (this.filter drops ownBody, or the shell would burst on its own
        // barrel) but must still take the blast.
        if (tank === directTarget || tank.isDead()) {
          continue;
        }
        if (tank !== this.owner && !isEnemy(tank)) {
          continue;
        }
        const distance = tank.getBody().state.position.distanceTo(projectile.position);
        const coeff = splashCoeff(distance, this.spec.splash);
        // Original SplashModel.isTankOccluded: no splash through walls
        if (coeff > 0 && !this.isTankOccluded(tank, projectile.position)) {
          this._tmp.diff(tank.getBody().state.position, projectile.position).normalize();
          tank.applyWeaponHit(tank.getBody().state.position, this._tmp, this.spec.impactForce * coeff);
          const lethal = dealDamage({
            source: this.owner, target: tank, amount: damage * coeff, splash: true, at: projectile.position,
          });
          result.hits.push({ tank, position: tank.getBody().state.position.clone(), lethal });
        }
      }
    }
    projectile.entity.destroy();
    this.listener?.onShot(result);
  }

  // Port of SplashModel.isTankOccluded: the tank is shielded only when ALL
  // three sample points (center, ±0.75*halfLength along local Y) are blocked
  // by static geometry from the explosion point.
  private isTankOccluded(tank: Tank, explosion: Vector3): boolean {
    const half = 0.75 * tank.halfLength;
    return (
      this.isPointOccluded(explosion, tank, 0) &&
      this.isPointOccluded(explosion, tank, -half) &&
      this.isPointOccluded(explosion, tank, half)
    );
  }

  private isPointOccluded(explosion: Vector3, tank: Tank, offsetY: number): boolean {
    const body = tank.getBody();
    this._occPoint.reset(0, offsetY, 0);
    body.baseMatrix.transformVector(this._occPoint.clone(), this._occPoint);
    this._occPoint.add(body.state.position);
    this._occDir.diff(this._occPoint, explosion);
    const distance = this._occDir.length();
    if (distance < 1) {
      return false;
    }
    this._occDir.scale(1 / distance);
    return this.detector.raycastStatic(explosion, this._occDir, 0xffff, distance, null, this._occHit);
  }
}

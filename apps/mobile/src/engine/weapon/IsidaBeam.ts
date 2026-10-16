// Isida's original three-part beam (reconstructed from the m0 assets, the
// Isida SWF model is absent from the dump): an animated muzzle flare
// (damage_start, 10 frames), a scrolling textured "shaft" ribbon tiled along
// the beam (damage_shaft 500x500), and an animated impact flare at the far
// end (damage_end, 11 frames). The ribbon is axially billboarded like the
// Shaft laser so it always faces the camera as ONE beam.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { buildMesh } from '../render/buildMesh';
import { Vector3 } from '../math/Vector3';
import { StreamWeapon } from './StreamWeapon';
import type { GameTank } from '../game/GameTank';

const BASE = assetUrl('/turrets/isida/m0');
const SHAFT_TEXTURE = `${BASE}/damage_shaft.png`;
const START_SHEET = `${BASE}/damage_start.png`; // 10 frames 150x150
const END_SHEET = `${BASE}/damage_end.png`; // 11 frames 100x100
// Healing mode (LocalHealingGun.getEffectType: same team -> HEALING). The
// heal_* sheets have exactly the same layout as the damage_* ones, so the
// beam only swaps textures.
const HEAL_SHAFT_TEXTURE = `${BASE}/heal_shaft.png`;
const HEAL_START_SHEET = `${BASE}/heal_start.png`;
const HEAL_END_SHEET = `${BASE}/heal_end.png`;
const START_FRAMES = 10;
const END_FRAMES = 11;
const BEAM_WIDTH = 70;
const SHAFT_TILE_LENGTH = 500; // world units per texture repeat
const SCROLL_PER_SECOND = 2.5; // texture repeats scrolled per second
const FLARE_FPS = 24;

function loadTexture(app: pc.AppBase, url: string): Promise<pc.Texture> {
  return new Promise((resolve, reject) => {
    app.assets.loadFromUrl(url, 'texture', (err, asset) => {
      if (err != null || asset == null) {
        reject(new Error(String(err ?? 'texture load failed')));
      } else {
        resolve(asset.resource as pc.Texture);
      }
    });
  });
}

function spriteMaterial(texture: pc.Texture, frames: number): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.useLighting = false;
  // NORMAL blend: these PNGs store transparency as white pixels with alpha=0,
  // ADDITIVE would paint them as opaque white frames
  material.blendType = pc.BLEND_NORMAL;
  material.cull = pc.CULLFACE_NONE;
  material.depthWrite = false;
  if (frames > 1) {
    material.emissiveMapTiling = new pc.Vec2(1 / frames, 1);
    material.opacityMapTiling = new pc.Vec2(1 / frames, 1);
  }
  material.update();
  return material;
}

/** Ribbon quad along local +Y (0..1, scaled to beam length), V tiled. */
function beamMesh(device: pc.GraphicsDevice): pc.Mesh {
  const w = BEAM_WIDTH / 2;
  const positions = [-w, 0, 0, w, 0, 0, w, 1, 0, -w, 1, 0];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  return buildMesh(device, { positions, indices, uvs });
}

export class IsidaBeam {
  private readonly damageTextures: { shaft: pc.Texture; start: pc.Texture; end: pc.Texture };
  /** Which texture set is currently bound (avoids redundant material updates). */
  private healingMode = false;
  private beam: pc.Entity;
  private beamMaterial: pc.StandardMaterial;
  private startFlare: pc.Entity;
  private startMaterial: pc.StandardMaterial;
  private endFlare: pc.Entity;
  private endMaterial: pc.StandardMaterial;
  private timeMs = 0;

  private readonly _muzzle = new Vector3();
  private readonly _dir = new Vector3();
  private readonly _qA = new pc.Quat();
  private readonly _qB = new pc.Quat();
  private readonly _axisX = new pc.Vec3();
  private readonly _axisZ = new pc.Vec3();

  private constructor(
    app: pc.AppBase,
    private gameTank: GameTank,
    simRoot: pc.Entity,
    shaftTexture: pc.Texture,
    startTexture: pc.Texture,
    endTexture: pc.Texture,
    private readonly healTextures: { shaft: pc.Texture; start: pc.Texture; end: pc.Texture },
  ) {
    this.damageTextures = { shaft: shaftTexture, start: startTexture, end: endTexture };
    this.beamMaterial = spriteMaterial(shaftTexture, 1);
    this.beam = new pc.Entity('isidaBeam');
    this.beam.addComponent('render', {
      meshInstances: [new pc.MeshInstance(beamMesh(app.graphicsDevice), this.beamMaterial)],
    });
    simRoot.addChild(this.beam);

    this.startMaterial = spriteMaterial(startTexture, START_FRAMES);
    this.startFlare = new pc.Entity('isidaStart');
    this.startFlare.addComponent('render', { type: 'plane' });
    this.startFlare.render!.material = this.startMaterial;
    this.startFlare.setLocalScale(160, 1, 160);
    simRoot.addChild(this.startFlare);

    this.endMaterial = spriteMaterial(endTexture, END_FRAMES);
    this.endFlare = new pc.Entity('isidaEnd');
    this.endFlare.addComponent('render', { type: 'plane' });
    this.endFlare.render!.material = this.endMaterial;
    this.endFlare.setLocalScale(130, 1, 130);
    simRoot.addChild(this.endFlare);
    this.setActive(false);
  }

  static async create(app: pc.AppBase, simRoot: pc.Entity, gameTank: GameTank): Promise<IsidaBeam> {
    const [shaft, start, end, healShaft, healStart, healEnd] = await Promise.all([
      loadTexture(app, SHAFT_TEXTURE),
      loadTexture(app, START_SHEET),
      loadTexture(app, END_SHEET),
      loadTexture(app, HEAL_SHAFT_TEXTURE),
      loadTexture(app, HEAL_START_SHEET),
      loadTexture(app, HEAL_END_SHEET),
    ]);
    return new IsidaBeam(app, gameTank, simRoot, shaft, start, end,
      { shaft: healShaft, start: healStart, end: healEnd });
  }

  getOwner(): GameTank {
    return this.gameTank;
  }

  /** Binds the damage_* or heal_* texture set (IsisState DAMAGING / HEALING). */
  private setHealingMode(healing: boolean): void {
    if (healing === this.healingMode) {
      return;
    }
    this.healingMode = healing;
    const set = healing ? this.healTextures : this.damageTextures;
    this.beamMaterial.emissiveMap = set.shaft;
    this.beamMaterial.opacityMap = set.shaft;
    this.beamMaterial.update();
    this.startMaterial.emissiveMap = set.start;
    this.startMaterial.opacityMap = set.start;
    this.startMaterial.update();
    this.endMaterial.emissiveMap = set.end;
    this.endMaterial.opacityMap = set.end;
    this.endMaterial.update();
  }

  private setActive(active: boolean): void {
    this.beam.enabled = active;
    this.startFlare.enabled = active;
    this.endFlare.enabled = active;
  }

  update(dtMs: number, camSimPos: pc.Vec3): void {
    const weapon = this.gameTank.weapon;
    const active =
      weapon instanceof StreamWeapon && weapon.isStreaming() && !this.gameTank.tank.isDead();
    this.setActive(active);
    if (!active) {
      return;
    }
    // LocalHealingGun.getEffectType: the beam turns green on a teammate
    this.setHealingMode((weapon as StreamWeapon).isHealing());
    this.timeMs += dtMs;
    this.gameTank.getMuzzleWorldPosition(this._muzzle);
    this.gameTank.getShotDirection(this._dir);
    const length = Math.max(120, (weapon as StreamWeapon).lastBeamLength);
    const d = this._dir;

    // Ribbon: base frame with +Y along the beam, then axial-billboard roll
    const horizontal = Math.sqrt(d.x * d.x + d.y * d.y);
    const pitch = Math.atan2(d.z, horizontal);
    const yaw = Math.atan2(-d.x, d.y);
    this._qA.setFromAxisAngle(pc.Vec3.BACK.clone().set(0, 0, 1), (yaw * 180) / Math.PI);
    this._qB.setFromAxisAngle(pc.Vec3.RIGHT, (pitch * 180) / Math.PI);
    this._qA.mul(this._qB);
    this._qA.transformVector(pc.Vec3.RIGHT, this._axisX);
    this._qA.transformVector(pc.Vec3.BACK.clone().set(0, 0, 1), this._axisZ);
    const cx = camSimPos.x - this._muzzle.x;
    const cy = camSimPos.y - this._muzzle.y;
    const cz = camSimPos.z - this._muzzle.z;
    const roll = Math.atan2(
      cx * this._axisX.x + cy * this._axisX.y + cz * this._axisX.z,
      cx * this._axisZ.x + cy * this._axisZ.y + cz * this._axisZ.z,
    );
    this._qB.setFromAxisAngle(pc.Vec3.UP, (roll * 180) / Math.PI);
    this._qA.mul(this._qB);
    this.beam.setLocalPosition(this._muzzle.x, this._muzzle.y, this._muzzle.z);
    this.beam.setLocalRotation(this._qA);
    this.beam.setLocalScale(1, length, 1);
    // Tile the shaft texture along the beam and scroll it toward the target
    this.beamMaterial.emissiveMapTiling.set(1, length / SHAFT_TILE_LENGTH);
    this.beamMaterial.opacityMapTiling.set(1, length / SHAFT_TILE_LENGTH);
    const scroll = -((this.timeMs / 1000) * SCROLL_PER_SECOND) % 1;
    this.beamMaterial.emissiveMapOffset.set(0, scroll);
    this.beamMaterial.opacityMapOffset.set(0, scroll);
    this.beamMaterial.update();

    // Animated flares at both ends (looping frames), spherical billboards
    const frame = Math.floor((this.timeMs / 1000) * FLARE_FPS);
    this.setFlare(this.startFlare, this.startMaterial, START_FRAMES, frame, this._muzzle.x, this._muzzle.y, this._muzzle.z, camSimPos);
    const ex = this._muzzle.x + d.x * (length - 20);
    const ey = this._muzzle.y + d.y * (length - 20);
    const ez = this._muzzle.z + d.z * (length - 20);
    this.setFlare(this.endFlare, this.endMaterial, END_FRAMES, frame, ex, ey, ez, camSimPos);
  }

  private setFlare(
    entity: pc.Entity,
    material: pc.StandardMaterial,
    frames: number,
    frame: number,
    x: number, y: number, z: number,
    camSimPos: pc.Vec3,
  ): void {
    entity.setLocalPosition(x, y, z);
    const f = frame % frames;
    material.emissiveMapOffset.set(f / frames, 0);
    material.opacityMapOffset.set(f / frames, 0);
    material.update();
    const dx = camSimPos.x - x;
    const dy = camSimPos.y - y;
    const yaw = Math.atan2(-dx, dy);
    const pitch = Math.atan2(camSimPos.z - z, Math.sqrt(dx * dx + dy * dy));
    entity.setLocalEulerAngles(90 - (pitch * 180) / Math.PI, 0, (yaw * 180) / Math.PI);
  }
}

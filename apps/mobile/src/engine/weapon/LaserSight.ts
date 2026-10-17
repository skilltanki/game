// Shaft laser sight: a textured cross-ribbon beam from the muzzle along the
// barrel up to the first obstacle, with the original laser spot at the end.
// Uses the SWF-extracted Laser_EmbedLaserRay / LaserPointerEffect_EmbedLaserSpot.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { buildMesh } from '../render/buildMesh';
import { Vector3 } from '../math/Vector3';
import { RayHit } from '../physics/collision/types/RayHit';
import type { GameTank } from '../game/GameTank';
import type { TanksCollisionDetector } from '../tank/TanksCollisionDetector';
import type { IRayCollisionFilter } from '../physics/collision/filters';

const LASER_BASE = assetUrl('/embedded/battlefieldmodel/bitmaps');
const RAY_TEXTURE = `${LASER_BASE}/Laser_EmbedLaserRay.png`;
const SPOT_TEXTURE = `${LASER_BASE}/LaserPointerEffect_EmbedLaserSpot.png`;

const BEAM_WIDTH = 7; // units
const MAX_LENGTH = 100000;
const SPOT_SIZE = 24;

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

function beamMaterial(texture: pc.Texture): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissiveMap = texture;
  material.emissive = new pc.Color(1, 1, 1);
  material.useLighting = false;
  material.blendType = pc.BLEND_ADDITIVE;
  material.opacity = 0.85;
  material.cull = pc.CULLFACE_NONE;
  material.depthWrite = false;
  material.update();
  return material;
}

/**
 * Single ribbon quad along local +Y (0..1, scaled by beam length). The ribbon
 * is rolled around the beam axis toward the camera every frame, so it always
 * reads as ONE laser line (the old cross of two quads looked like two).
 */
function createBeamMesh(device: pc.GraphicsDevice): pc.Mesh {
  const w = BEAM_WIDTH / 2;
  const positions = [-w, 0, 0, w, 0, 0, w, 1, 0, -w, 1, 0];
  // Ray texture is 8x512: V runs along the beam
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  return buildMesh(device, { positions, indices, uvs });
}

export class LaserSight {
  private beam: pc.Entity;
  private spot: pc.Entity;
  private readonly _muzzle = new Vector3();
  private readonly _direction = new Vector3();
  private readonly _hit = new RayHit();
  private readonly filter: IRayCollisionFilter;

  private constructor(
    app: pc.AppBase,
    private gameTank: GameTank,
    private detector: TanksCollisionDetector,
    simRoot: pc.Entity,
    rayTexture: pc.Texture,
    spotTexture: pc.Texture,
  ) {
    const ownBody = gameTank.tank.getBody();
    this.filter = { considerBody: (body) => body !== ownBody };

    this.beam = new pc.Entity('laser');
    this.beam.addComponent('render', {
      meshInstances: [new pc.MeshInstance(createBeamMesh(app.graphicsDevice), beamMaterial(rayTexture))],
    });
    simRoot.addChild(this.beam);

    this.spot = new pc.Entity('laserSpot');
    this.spot.addComponent('render', { type: 'plane' });
    this.spot.render!.material = beamMaterial(spotTexture);
    this.spot.setLocalScale(SPOT_SIZE, 1, SPOT_SIZE);
    simRoot.addChild(this.spot);
  }

  getOwner(): GameTank {
    return this.gameTank;
  }

  static async create(app: pc.AppBase, simRoot: pc.Entity, gameTank: GameTank, detector: TanksCollisionDetector): Promise<LaserSight> {
    const [rayTexture, spotTexture] = await Promise.all([loadTexture(app, RAY_TEXTURE), loadTexture(app, SPOT_TEXTURE)]);
    return new LaserSight(app, gameTank, detector, simRoot, rayTexture, spotTexture);
  }

  private readonly _qYaw = new pc.Quat();
  private readonly _qPitch = new pc.Quat();
  private readonly _qRoll = new pc.Quat();
  private readonly _axisX = new pc.Vec3();
  private readonly _axisZ = new pc.Vec3();

  /**
   * Per-frame: trace the barrel line, stretch the beam, place the spot.
   * `visible=false` hides the laser (the original shows it only while the
   * Shaft is in targeting mode).
   */
  update(camSimPos: pc.Vec3, visible = true): void {
    const show = visible && !this.gameTank.tank.isDead();
    this.beam.enabled = show;
    this.spot.enabled = show;
    if (!show) {
      return;
    }
    this.gameTank.getMuzzleWorldPosition(this._muzzle);
    this.gameTank.getShotDirection(this._direction);
    const hasHit = this.detector.raycast(this._muzzle, this._direction, 0xffff, MAX_LENGTH, this.filter, this._hit);
    const length = hasHit ? this._hit.t : MAX_LENGTH;
    this._hit.clear();

    const d = this._direction;
    const horizontal = Math.sqrt(d.x * d.x + d.y * d.y);
    const pitch = Math.atan2(d.z, horizontal);
    const yaw = Math.atan2(-d.x, d.y);
    this.beam.setLocalPosition(this._muzzle.x, this._muzzle.y, this._muzzle.z);
    // Base orientation (local +Y along the beam), then roll the ribbon around
    // the beam axis so its face points at the camera (axial billboard)
    this._qYaw.setFromAxisAngle(pc.Vec3.BACK.clone().set(0, 0, 1), (yaw * 180) / Math.PI);
    this._qPitch.setFromAxisAngle(pc.Vec3.RIGHT, (pitch * 180) / Math.PI);
    this._qYaw.mul(this._qPitch); // beam frame without roll
    this._qYaw.transformVector(pc.Vec3.RIGHT, this._axisX);
    this._qYaw.transformVector(pc.Vec3.BACK.clone().set(0, 0, 1), this._axisZ);
    const cx = camSimPos.x - this._muzzle.x;
    const cy = camSimPos.y - this._muzzle.y;
    const cz = camSimPos.z - this._muzzle.z;
    const projX = cx * this._axisX.x + cy * this._axisX.y + cz * this._axisX.z;
    const projZ = cx * this._axisZ.x + cy * this._axisZ.y + cz * this._axisZ.z;
    const roll = Math.atan2(projX, projZ);
    this._qRoll.setFromAxisAngle(pc.Vec3.UP, (roll * 180) / Math.PI);
    this._qYaw.mul(this._qRoll);
    this.beam.setLocalRotation(this._qYaw);
    this.beam.setLocalScale(1, length, 1);

    if (hasHit || length < MAX_LENGTH) {
      this.spot.enabled = true;
      const endX = this._muzzle.x + d.x * (length - 2);
      const endY = this._muzzle.y + d.y * (length - 2);
      const endZ = this._muzzle.z + d.z * (length - 2);
      this.spot.setLocalPosition(endX, endY, endZ);
      // Spherical billboard toward the camera: unrotated, the plane stands
      // vertical facing sim +Y, so yaw about Z plus the elevation about X
      // (see HitEffects.faceCamera)
      const dx = camSimPos.x - endX;
      const dy = camSimPos.y - endY;
      const spotYaw = Math.atan2(-dx, dy);
      const spotPitch = Math.atan2(camSimPos.z - endZ, Math.sqrt(dx * dx + dy * dy));
      this.spot.setLocalEulerAngles((spotPitch * 180) / Math.PI, 0, (spotYaw * 180) / Math.PI);
    } else {
      this.spot.enabled = false;
    }
  }
}

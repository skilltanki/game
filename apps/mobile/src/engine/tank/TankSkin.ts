// Visual tank skin: hull + turret meshes from assets/Hulls|Turrets/<name>/<mod>/.
// Physics-free port of the TankSkin idea from the original client:
//  - the hull .3ds contains the visible "hull" mesh, a "mount" marker (turret
//    attachment point) and suspension markers spL0..4/spR0..4 (unused here);
//  - hull size for physics is the hull mesh bounds (Tank.calculateSizeForMesh);
//  - skinCenterOffset recenters the mesh so the hull bottom sits at nominal
//    suspension compression (Tank.calculateSkinCenterOffset):
//      offset = (-center.x, -center.y, -0.5*size.z - nominalRayLength + RAY_OFFSET)
import * as pc from 'playcanvas';
import { assetProgress } from '../game/AssetProgress';
import { buildMesh } from '../render/buildMesh';
import { Parser3DS, Parsed3DSObject } from '../map/Parser3DS';
import { TankConst } from './TankConst';
import { TrackSkin } from './TrackSkin';
import type { TankPartFiles } from './TankAssets';

export interface TankSkinOptions {
  /** Resolved hull files from hulls.json (TankAssets.resolvePart). */
  hull: TankPartFiles;
  /** Resolved turret files from turrets.json. */
  turret: TankPartFiles;
  nominalRayLength?: number; // SuspensionParams.nominalRayLength (default 25)
  /** CSS color for the garage paint layer under the lightmap (fallback when no paintImage). */
  paintColor?: string;
  /**
   * Garage paint texture (paints.json `image`). Sizes vary per paint — 1x1 for
   * a flat colour, 512x512 for a pattern — so it is TILED under the lightmap,
   * never stretched. Takes precedence over paintColor.
   */
  paintImage?: string;
}

export interface TankSkin {
  /** Full hull mesh size (world units) — feeds TankSpec.hullSize. */
  hullSize: { x: number; y: number; z: number };
  /** Turret mount point in body space (skinCenterOffset already applied). */
  turretMount: { x: number; y: number; z: number };
  /** First muzzle position in turret space (the "muzzle01" marker of the turret 3DS). */
  muzzle: { x: number; y: number; z: number };
  /** ALL muzzle markers sorted by name — multi-barrel turrets (Twins) alternate. */
  muzzles: { x: number; y: number; z: number }[];
  /** Turret extents in turret space for the weapon-ray hitbox (barrel length excluded). */
  turretHitbox: { halfXY: number; halfZ: number; centerZ: number };
  /**
   * CTF flag mount point in turret space (the "fmnt" marker of the turret
   * 3DS) — where a carried flag rides. Original: TurretSkinCacheItem
   * .parseFlagMountPoint, which throws when the marker is missing; here a
   * missing marker falls back to the turret centre so a non-CTF turret
   * still loads.
   */
  flagMount: { x: number; y: number; z: number };
  /** Builds the visual entity tree; attach it under the sim root and drive its transform. */
  buildEntity(): pc.Entity;
  /** True when the hull mesh carries a "track" submaterial (ufo/hovercraft: false). */
  readonly hasTracks: boolean;
  /**
   * TankSkin.updateTracks: scroll each belt by that many mesh units along its
   * unwrap. Call after buildEntity(); a no-op when the mesh has no track faces.
   */
  updateTracks(left: number, right: number): void;
}

interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
}

function getBounds(object: Parsed3DSObject): MeshBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < object.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = object.positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

async function fetch3ds(url: string): Promise<ArrayBuffer> {
  const buffer = await assetProgress.trackedFetch(url);
  // Vite's SPA fallback answers unknown paths with index.html at HTTP 200 —
  // verify the 3DS main chunk rather than letting the parser eat HTML.
  if (buffer.byteLength < 6 || new DataView(buffer).getUint16(0, true) !== 0x4d4d) {
    throw new Error(`${url} is not a 3DS file (bad magic)`);
  }
  return buffer;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  // Fetched rather than assigned to an Image src so the bytes are counted:
  // hull/turret textures are over a megabyte per tank and used to be
  // invisible to the loading bar.
  let objectUrl: string | null = null;
  try {
    const buffer = await assetProgress.trackedFetch(url);
    objectUrl = URL.createObjectURL(new Blob([buffer]));
  } catch {
    // Fall back to the plain path; losing progress beats losing the tank.
    objectUrl = null;
  }
  const src = objectUrl ?? url;
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    // Revoke only AFTER the bitmap is decoded: releasing the blob while the
    // decode is still in flight can abort it.
    const release = (): void => {
      if (objectUrl != null) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
    img.onload = () => {
      release();
      resolve(img);
    };
    img.onerror = () => {
      release();
      reject(new Error(`Failed to load image ${url}`));
    };
    img.src = src;
  });
}

/**
 * Original TextureConstructor composition: paint color under the greyscale
 * lightmap (multiply), then the details overlay (tracks/wheels) by alpha.
 */
function composeSkinTexture(
  app: pc.AppBase,
  paintColor: string,
  paint: HTMLImageElement | null,
  lightmap: HTMLImageElement,
  details: HTMLImageElement,
): pc.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = lightmap.width;
  canvas.height = lightmap.height;
  const ctx = canvas.getContext('2d')!;
  if (paint != null) {
    // Tiled, not stretched: a paint image is a swatch whose natural size says
    // how big the pattern is (1x1 flat colour .. 512x512 pattern).
    const pattern = ctx.createPattern(paint, 'repeat');
    ctx.fillStyle = pattern ?? paintColor;
  } else {
    ctx.fillStyle = paintColor;
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lightmap, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(details, 0, 0, canvas.width, canvas.height);
  const texture = new pc.Texture(app.graphicsDevice, {
    width: canvas.width,
    height: canvas.height,
    format: pc.PIXELFORMAT_SRGBA8,
    mipmaps: true,
    // The track belt scrolls its U past 1 — the original TrackMaterial was
    // created with repeat=true for exactly this.
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
  });
  texture.setSource(canvas);
  return texture;
}

function unlitMaterial(texture: pc.Texture): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissiveMap = texture;
  material.emissive = new pc.Color(1, 1, 1);
  material.useLighting = false;
  material.update();
  return material;
}

function parse3ds(buffer: ArrayBuffer): Parser3DS {
  const parser = new Parser3DS();
  parser.parse(buffer);
  return parser;
}

function pickMainMesh(parser: Parser3DS, preferredName: string): Parsed3DSObject {
  const named = parser.objects.find((o) => o.name.toLowerCase() === preferredName && o.positions.length > 0);
  if (named != null) {
    return named;
  }
  // Largest mesh by vertex count (markers are tiny 26-vertex boxes)
  const meshes = parser.objects.filter((o) => o.positions.length > 0);
  meshes.sort((a, b) => b.positions.length - a.positions.length);
  if (meshes.length === 0) {
    throw new Error('3DS contains no geometry');
  }
  return meshes[0];
}


/**
 * Port of TankSkin.createTrackSkins + addFaceToTrackSkin.
 *
 * The original walked the hull mesh faces and took every face whose material
 * was named "tracks", splitting left/right by the sign of vertices[0].x. Our
 * 3DS parser exposes the same information as a per-material face-index range
 * (Parsed3DSObject.surfaces), and the artist named the submaterial "track"
 * in this asset set — accept both spellings.
 */
function createTrackSkins(object: Parsed3DSObject): { left: TrackSkin; right: TrackSkin } | null {
  const left = new TrackSkin();
  const right = new TrackSkin();
  const surfaces = object.surfaces;
  if (surfaces == null || object.uvs == null) {
    return null;
  }
  for (const surface of surfaces) {
    const name = surface.materialName.toLowerCase();
    if (name !== 'track' && name !== 'tracks') {
      continue;
    }
    for (const faceIndex of surface.faceIndices) {
      const triangle = [
        object.faces[faceIndex * 3],
        object.faces[faceIndex * 3 + 1],
        object.faces[faceIndex * 3 + 2],
      ];
      // addFaceToTrackSkin: side by the first vertex's x
      if (object.positions[triangle[0] * 3] < 0) {
        left.addFace(triangle);
      } else {
        right.addFace(triangle);
      }
    }
  }
  if (left.faceCount === 0 && right.faceCount === 0) {
    return null;
  }
  left.init(object.positions, object.uvs);
  right.init(object.positions, object.uvs);
  return { left, right };
}

export async function loadTankSkin(app: pc.AppBase, options: TankSkinOptions): Promise<TankSkin> {
  const nominalRayLength = options.nominalRayLength ?? 25;
  const paintColor = options.paintColor ?? '#7a8a5a'; // khaki fallback for the garage paint
  const [hullBuffer, turretBuffer, hullLightmap, hullDetails, turretLightmap, turretDetails, paint] =
    await Promise.all([
      fetch3ds(options.hull.mesh),
      fetch3ds(options.turret.mesh),
      loadImage(options.hull.lightmap),
      loadImage(options.hull.details),
      loadImage(options.turret.lightmap),
      loadImage(options.turret.details),
      // A missing/broken paint must not take the whole tank down with it.
      options.paintImage != null
        ? loadImage(options.paintImage).catch(() => {
            console.warn(`TankSkin: paint ${options.paintImage} failed to load — using paintColor`);
            return null;
          })
        : Promise.resolve(null),
    ]);
  const hullTexture = composeSkinTexture(app, paintColor, paint, hullLightmap, hullDetails);
  const turretTexture = composeSkinTexture(app, paintColor, paint, turretLightmap, turretDetails);

  const hullParser = parse3ds(hullBuffer);
  const turretParser = parse3ds(turretBuffer);

  const hullObject = pickMainMesh(hullParser, 'hull');
  const turretObject = pickMainMesh(turretParser, 'turret');
  const mount = hullParser.objects.find((o) => o.name.toLowerCase() === 'mount');
  // Original TurretSkinCacheItem.parseMuzzles: ALL objects matching /muzzle.*/
  // sorted by name (multi-barrel turrets alternate between them). In this
  // asset dump the Twins markers are named Box02/Box03 instead — fall back to
  // the box-named helper nodes when no muzzle-named ones exist.
  let muzzleMarkers = turretParser.objects
    .filter((o) => o.name.toLowerCase().startsWith('muzzle'))
    .sort((a, b) => (a.name <= b.name ? -1 : 1));
  if (muzzleMarkers.length === 0) {
    // Barrel-tip helper boxes carry their own mesh — use the node position
    muzzleMarkers = turretParser.objects
      .filter((o) => /^box\d*$/i.test(o.name))
      .sort((a, b) => (a.name <= b.name ? -1 : 1));
  }
  // Original TurretSkinCacheItem.parseFlagMountPoint: getObjectsByName(/fmnt/i).
  const flagMountMarker = turretParser.objects.find((o) => /fmnt/i.test(o.name));

  // Tank.calculateSizeForMesh: full mesh bounds
  const hullBounds = getBounds(hullObject);
  const hullSize = {
    x: hullBounds.max[0] - hullBounds.min[0],
    y: hullBounds.max[1] - hullBounds.min[1],
    z: hullBounds.max[2] - hullBounds.min[2],
  };

  // Tank.calculateSkinCenterOffset
  const skinCenterOffset = {
    x: -0.5 * (hullBounds.min[0] + hullBounds.max[0]),
    y: -0.5 * (hullBounds.min[1] + hullBounds.max[1]),
    z: -0.5 * hullSize.z - nominalRayLength + TankConst.RAY_OFFSET,
  };

  // The mount marker's animation position is in hull mesh space (pivot at hull bottom)
  const turretMount =
    mount != null
      ? {
          x: mount.x + skinCenterOffset.x,
          y: mount.y + skinCenterOffset.y,
          z: mount.z + skinCenterOffset.z,
        }
      : { x: 0, y: 0, z: hullSize.z / 2 };

  // Muzzle markers in turret space; fallback: barrel tip from the mesh bounds
  const turretBounds = getBounds(turretObject);
  const muzzles: { x: number; y: number; z: number }[] =
    muzzleMarkers.length > 0
      ? muzzleMarkers.map((m) => ({ x: m.x, y: m.y, z: m.z }))
      : [{ x: 0, y: turretBounds.max[1], z: turretBounds.max[2] * 0.5 }];
  const muzzle = muzzles[0];

  // Turret body extents for the weapon-ray hitbox (square XY footprint from the
  // X width so the rotating barrel length doesn't inflate it)
  const turretHitbox = {
    halfXY: Math.max(Math.abs(turretBounds.min[0]), Math.abs(turretBounds.max[0])),
    halfZ: (turretBounds.max[2] - turretBounds.min[2]) / 2,
    centerZ: (turretBounds.min[2] + turretBounds.max[2]) / 2,
  };

  // Flag mount: marker position in turret space, or the turret top centre
  // when the 3DS has no fmnt marker.
  const flagMount =
    flagMountMarker != null
      ? { x: flagMountMarker.x, y: flagMountMarker.y, z: flagMountMarker.z }
      : { x: 0, y: 0, z: turretBounds.max[2] };

  const hullMaterial = unlitMaterial(hullTexture);
  const turretMaterial = unlitMaterial(turretTexture);

  // Track belts: the left/right face sets of the hull's "track" submaterial.
  const trackSkins = createTrackSkins(hullObject);
  // Live UV copy scrolled per frame and re-uploaded to the hull mesh.
  const hullUvs: Float32Array | null =
    trackSkins != null && hullObject.uvs != null ? new Float32Array(hullObject.uvs) : null;
  let hullMeshRef: pc.Mesh | null = null;

  const buildEntity = (): pc.Entity => {
    const pivot = new pc.Entity('tank');

    const hullEntity = new pc.Entity('hull');
    const hullMesh = buildMesh(app.graphicsDevice, {
      positions: hullObject.positions,
      indices: hullObject.faces,
      uvs: hullObject.uvs ?? undefined,
    });
    hullMeshRef = hullMesh;
    hullEntity.addComponent('render', { meshInstances: [new pc.MeshInstance(hullMesh, hullMaterial)] });
    hullEntity.setLocalPosition(skinCenterOffset.x, skinCenterOffset.y, skinCenterOffset.z);
    pivot.addChild(hullEntity);

    const turretEntity = new pc.Entity('turret');
    const turretMesh = buildMesh(app.graphicsDevice, {
      positions: turretObject.positions,
      indices: turretObject.faces,
      uvs: turretObject.uvs ?? undefined,
    });
    turretEntity.addComponent('render', { meshInstances: [new pc.MeshInstance(turretMesh, turretMaterial)] });
    turretEntity.setLocalPosition(turretMount.x, turretMount.y, turretMount.z);
    pivot.addChild(turretEntity);

    return pivot;
  };

  /** TankSkin.updateTracks: leftTrackSkin.move(left), rightTrackSkin.move(right). */
  const updateTracks = (left: number, right: number): void => {
    if (trackSkins == null || hullUvs == null || hullMeshRef == null) {
      return;
    }
    trackSkins.left.move(left, hullUvs);
    trackSkins.right.move(right, hullUvs);
    hullMeshRef.setUvs(0, hullUvs, 2);
    hullMeshRef.update(pc.PRIMITIVE_TRIANGLES);
  };

  return {
    hullSize,
    turretMount,
    muzzle,
    muzzles,
    turretHitbox,
    flagMount,
    buildEntity,
    hasTracks: trackSkins != null,
    updateTracks,
  };
}

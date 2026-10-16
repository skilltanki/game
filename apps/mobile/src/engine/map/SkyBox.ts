// Port of the original engine's SkyBox + the game's BattleSkyBox.
//
// Six textured quads around the camera, built in SIM space (Z-up), so the
// vertex coordinates below are copied straight from the decompile. Each face
// is its own mesh instance because each one carries a different texture.
//
// BattleSkyBox passes the sides in this order:
//   super(SKYBOX_SIZE, left, right, back, front, bottom, top, 0)
// but SkyBox's own signature is (size, left, right, BACK, FRONT, bottom, top),
// and BattleSkyBox hands it (..., param5 /*back*/, param4 /*front*/, ...) —
// i.e. back and front arrive SWAPPED relative to the SkyboxSides field order.
// That swap is reproduced here in FACE_ORDER.
//
// Differences from the original:
//  - `autoSize`/`reduceConst` (the engine shrank the box to fit the far plane)
//    are gone: PlayCanvas just needs the box inside farClip, so the size is
//    picked from the camera instead of the original's fixed 200000;
//  - Clipping.FACE_CLIPPING / Sorting.NONE / shadowMapAlphaThreshold are
//    engine features with no equivalent here;
//  - the original received its six images from the server as ImageResource;
//    this port names them by file (01..06) from assets/Resources/Battle/
//    skyboxes/<id>/, since the dump keeps no map->skybox mapping.

import * as pc from 'playcanvas';
import { buildMesh } from '../render/buildMesh';

/**
 * Which numbered file goes on which face.
 *
 * The dump's files are only named 01..06 with no manifest, so this mapping is
 * the one that makes the horizon line up continuously around the box and the
 * ground texture land underneath. Verified by eye on several skyboxes.
 */
const FACE_FILES = ['01', '02', '03', '04', '05', '06'] as const;

type FaceName = 'left' | 'right' | 'back' | 'front' | 'bottom' | 'top';

/**
 * Which numbered file goes on which cube face.
 *
 * The dump ships no manifest, so this was DERIVED from the images themselves
 * rather than guessed:
 *  - 05 is sky top to bottom and 06 is ground top to bottom, so they are the
 *    top and bottom faces (the previous order had these two swapped);
 *  - 01..04 are the sides, and matching their edge pixels gives the ring
 *    01 -> 02 -> 03 -> 04 -> 01 (edge difference 3..13 against 63..150 for
 *    every wrong pairing);
 *  - the cube's own winding runs back -> left -> front -> right -> back, so
 *    the two rings line up as below. Mismatched sides showed as hard seams
 *    cutting the mountains in half.
 */
const FACE_ORDER: FaceName[] = ['back', 'left', 'front', 'right', 'top', 'bottom'];

/**
 * Face geometry, verbatim from SkyBox's constructor with s = size * 0.5.
 * Each entry lists its four corners as (x, y, z) multipliers of s, in the
 * original's winding, plus the UVs the original assigned (border = 0).
 */
const FACES: Record<FaceName, number[][]> = {
  //                    x   y   z
  left: [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]],
  right: [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]],
  back: [[1, -1, 1], [1, -1, -1], [-1, -1, -1], [-1, -1, 1]],
  front: [[-1, 1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1]],
  bottom: [[-1, 1, -1], [-1, -1, -1], [1, -1, -1], [1, 1, -1]],
  top: [[-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1]],
};

/** UVs are the same for every face: (0,0) (0,1) (1,1) (1,0) with border 0. */
const FACE_UVS = [0, 0, 0, 1, 1, 1, 1, 0];
/** Two triangles over the quad's four corners. */
const FACE_INDICES = [0, 1, 2, 0, 2, 3];

async function loadTexture(app: pc.AppBase, url: string): Promise<pc.Texture> {
  return await new Promise((resolve, reject) => {
    app.assets.loadFromUrl(url, 'texture', (err, asset) => {
      if (err != null || asset == null) {
        reject(new Error(`SkyBox: failed to load ${url}: ${err ?? 'no asset'}`));
        return;
      }
      const texture = asset.resource as pc.Texture;
      // The sides must not bleed into each other at the seams.
      texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
      texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
      resolve(texture);
    });
  });
}

/**
 * Flat fog blend for the sky, as the original did it.
 *
 * TextureMaterial had a SEPARATE path for SkyBox faces (its `skyFogConst`):
 * instead of the distance-based fade it used on world geometry, the sky got a
 * CONSTANT blend toward the fog colour by fogAlpha —
 *
 *   skyFogConst.rgb = fogColor * fogAlpha;  skyFogConst.a = 1 - fogAlpha
 *   out = tex * skyFogConst.a + skyFogConst.rgb
 *
 * which is why the horizon still reads as hazy without the sky being eaten.
 * Distance fog cannot work here: the box sits ~1000 m out, far beyond the
 * fog's end, so every face would come out solid fog colour.
 *
 * That is a MIX, not a tint. An earlier version set the material's emissive
 * colour to (1 - a) + fog * a, but StandardMaterial MULTIPLIES the emissive
 * map by that colour, so with a bright fog it came out as ~0.97 — a sky with
 * no haze at all next to fogged terrain. The mix has no material knob, so it
 * is baked into the texture here: canvas source-over with globalAlpha = a
 * gives exactly tex * (1 - a) + fog * a per texel.
 */
function blendWithFog(
  device: pc.GraphicsDevice,
  source: pc.Texture,
  fogColor: pc.Color,
  fogAlpha: number,
): pc.Texture {
  const image = source.getSource() as CanvasImageSource;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (ctx == null) {
    return source;
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = fogAlpha;
  ctx.fillStyle = `rgb(${Math.round(fogColor.r * 255)},${Math.round(fogColor.g * 255)},${Math.round(fogColor.b * 255)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new pc.Texture(device, {
    name: `${source.name}_fog`,
    width: canvas.width,
    height: canvas.height,
    format: pc.PIXELFORMAT_RGBA8,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  texture.setSource(canvas);
  return texture;
}

function faceMaterial(texture: pc.Texture): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  // Unlit: the sky is its own light source, never shaded by the scene.
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveMap = texture;
  material.useLighting = false;
  // Distance fog must not touch the sky — see applySkyFog for what replaces it.
  material.useFog = false;
  material.depthWrite = false;
  // Seen from INSIDE the box. The decompiled winding already faces inward, so
  // the back faces are the ones to drop — CULLFACE_FRONT hid the sky entirely.
  material.cull = pc.CULLFACE_BACK;
  material.update();
  return material;
}

export class SkyBox {
  /** Fog-blended textures currently on the materials (null where the source is used as is). */
  private blended: (pc.Texture | null)[];

  private constructor(
    readonly entity: pc.Entity,
    private readonly materials: pc.StandardMaterial[],
    /** The six face textures as asked from the asset registry (a host app unloads them with the scene). */
    readonly textureUrls: string[],
    /** The untouched side images, kept so the fog can be re-blended. */
    private readonly sources: pc.Texture[],
    private readonly device: pc.GraphicsDevice,
  ) {
    this.blended = sources.map(() => null);
  }

  /**
   * Builds the skybox and parents it to `simRoot`, so it shares the sim's
   * Z-up space and the metres-per-unit scale the rest of the world uses.
   *
   * `size` is the cube edge in sim units; the original used a fixed 200000.
   */
  static async create(
    app: pc.AppBase,
    simRoot: pc.Entity,
    baseUrl: string,
    size: number,
    /** Map fog, blended flat into the sky (see applySkyFog). */
    fog: { color: pc.Color; alpha: number } | null = null,
  ): Promise<SkyBox> {
    // Always 01..06: sync-assets normalises the dump's inconsistent names at
    // build time, so nothing is guessed here. Guessing would be worse than
    // useless — Vite answers a missing path with index.html and HTTP 200, so
    // a wrong name comes back as an undecodable "image" rather than a 404.
    const textureUrls = FACE_FILES.map((file) => `${baseUrl}/${file}.jpg`);
    const textures = await Promise.all(textureUrls.map((url) => loadTexture(app, url)));
    const root = new pc.Entity('skybox');
    const materials: pc.StandardMaterial[] = [];
    const half = size * 0.5;
    const device = app.graphicsDevice;
    FACE_ORDER.forEach((face, index) => {
      const corners = FACES[face];
      const positions: number[] = [];
      for (const [x, y, z] of corners) {
        positions.push(x * half, y * half, z * half);
      }
      const mesh = buildMesh(app.graphicsDevice, {
        positions,
        indices: FACE_INDICES,
        uvs: FACE_UVS,
      });
      const material = faceMaterial(textures[index]);
      materials.push(material);
      const faceEntity = new pc.Entity(`sky_${face}`);
      faceEntity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(mesh, material)],
      });
      root.addChild(faceEntity);
    });
    simRoot.addChild(root);
    const skyBox = new SkyBox(root, materials, textureUrls, textures, device);
    skyBox.setFog(fog?.color ?? null, fog?.alpha ?? 0);
    return skyBox;
  }

  /**
   * Keeps the box centred on the camera so its walls stay unreachable — the
   * original did this by rebuilding the box around the camera every frame
   * (autoSize); re-centring is the cheap equivalent.
   */
  update(cameraSimPosition: pc.Vec3): void {
    this.entity.setLocalPosition(cameraSimPosition.x, cameraSimPosition.y, cameraSimPosition.z);
  }

  /** (Re)blends the flat fog into the side textures, e.g. if a map's visual changes at runtime. */
  setFog(color: pc.Color | null, alpha: number): void {
    this.materials.forEach((material, index) => {
      const previous = this.blended[index];
      const next = color != null && alpha > 0 ? blendWithFog(this.device, this.sources[index], color, alpha) : null;
      material.emissiveMap = next ?? this.sources[index];
      material.update();
      this.blended[index] = next;
      // The blended copies are private to this box, so dropping them is safe
      previous?.destroy();
    });
  }

  destroy(): void {
    this.entity.destroy();
    for (const material of this.materials) {
      material.destroy();
    }
    for (const texture of this.blended) {
      texture?.destroy();
    }
  }
}

// Loads the Capture the Flag art: the two cloth sprites and the two pedestals.
//
// The pedestal is a plain .3ds with one texture (the original builds it from
// Tanks3DSResource the same way props are built), so it reuses this port's
// 3DS parser and the unlit material convention of MapLoader: every map texture
// is pre-lit, so materials are emissive-only.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { Parser3DS } from '../map/Parser3DS';
import { buildMesh } from '../render/buildMesh';
import type { Vector3 } from '../math/Vector3';

const CTF_BASE = assetUrl('/battle/modes/ctf');

export interface CtfAssets {
  flagTextures: { red: pc.Texture; blue: pc.Texture };
}

function loadTexture(app: pc.AppBase, url: string): Promise<pc.Texture> {
  return new Promise((resolve, reject) => {
    app.assets.loadFromUrl(url, 'texture', (err, asset) => {
      if (err != null || asset == null) {
        reject(new Error(String(err ?? `texture load failed: ${url}`)));
      } else {
        resolve(asset.resource as pc.Texture);
      }
    });
  });
}

export async function loadCtfAssets(app: pc.AppBase): Promise<CtfAssets> {
  const [red, blue] = await Promise.all([
    loadTexture(app, `${CTF_BASE}/flag_red.png`),
    loadTexture(app, `${CTF_BASE}/flag_blue.png`),
  ]);
  return { flagTextures: { red, blue } };
}

/**
 * Builds one team's pedestal under `parent` at the flag's base position.
 * Failures are non-fatal: a missing pedestal mesh costs the stand, not the
 * flag, so CTF still plays.
 */
export async function buildPedestal(
  app: pc.AppBase,
  team: 'red' | 'blue',
  position: Vector3,
  parent: pc.Entity,
): Promise<pc.Entity | null> {
  const meshUrl = `${CTF_BASE}/pedestal/${team}_pedestal/flag_stand_${team}.3ds`;
  const textureUrl = `${CTF_BASE}/pedestal/${team}_pedestal/fs_${team}.jpg`;
  try {
    const response = await fetch(meshUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    // Vite's SPA fallback answers a missing path with index.html and HTTP 200,
    // so the format magic is the only reliable "did I get a mesh" check.
    const magic = new DataView(buffer).getUint16(0, true);
    if (magic !== 0x4d4d) {
      throw new Error(`not a 3DS (magic 0x${magic.toString(16)})`);
    }
    const parser = new Parser3DS();
    parser.parse(buffer);
    const object = parser.objects.find((o) => o.positions.length > 0);
    if (object == null) {
      throw new Error('no mesh in 3DS');
    }
    const texture = await loadTexture(app, textureUrl);
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0, 0, 0);
    material.emissiveMap = texture;
    material.emissive = new pc.Color(1, 1, 1);
    material.update();

    const entity = new pc.Entity(`ctf-pedestal-${team}`);
    const mesh = buildMesh(app.graphicsDevice, {
      positions: object.positions,
      indices: object.faces,
      uvs: object.uvs ?? undefined,
    });
    const instance = new pc.MeshInstance(mesh, material);
    entity.addComponent('render', { meshInstances: [instance] });
    entity.setLocalPosition(position.x, position.y, position.z);
    parent.addChild(entity);
    return entity;
  } catch (e) {
    console.warn(`CTF pedestal ${team} not built:`, e);
    return null;
  }
}

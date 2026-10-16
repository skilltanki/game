// Map loading pipeline (original: MapBuilder + MapGeometryParser, physics-free parts):
//   map XML -> collision shapes (CollisionGeometryParser) + spawn points
//           -> <static-geometry> prop instances -> library.xml -> .3ds + texture
//           -> PlayCanvas entities under the Z-up sim root.
// Textures are pre-lit, so materials are emissive-only (unlit), like the
// original's TextureMaterial.
// Alpha: TextureMaterial.transparent mirrors BitmapData.transparent, which the
// the original loader set for a PNG (every png under assets/Props is RGBA) and clears
// for a JPEG. Mesh faces with such a material and alphaTestThreshold == 0 went
// to Mesh.transparentList: alpha-blended, per-face sorted by average Z, no depth
// write. PlayCanvas sorts per mesh instance, not per face, so the port renders
// them as an alpha-tested cutout (threshold 0.5) in the opaque pass instead -
// the same technique MapBuilder itself used for the alpha BSP (christmas tree,
// alphaTestThreshold = 0.5). Culling stays single-sided like the original mesh.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { buildMesh } from '../render/buildMesh';
import { Parser3DS, Parsed3DSObject } from './Parser3DS';
import { CollisionGeometryParser } from './CollisionGeometryParser';
import { parseSpawnPoints, SpawnPoint } from './SpawnPoints';
import { parseBonusRegions, BonusRegion } from './BonusRegions';
import { parseCtfFlags, CtfFlagPositions } from './CtfFlags';
import { DEFAULT_TEXTURE, libraryNameToFolder, PropDef, PropLibRegistry, PropLibrary, PropMeshDef } from './PropLibrary';
import { childElements, firstChild, childNumber } from './xmlUtils';
import { resolveCoplanarOverlaps, OverlapSource } from './CoplanarOverlaps';
import type { CollisionShape } from '../physics/collision/CollisionShape';
import { assetProgress } from '../game/AssetProgress';

export interface PropInstance {
  libraryName: string;
  groupName: string;
  propName: string;
  textureName: string;
  x: number;
  y: number;
  z: number;
  rotationZ: number;
}

export interface LoadedMap {
  collisionShapes: CollisionShape[];
  spawnPoints: SpawnPoint[];
  bonusRegions: BonusRegion[];
  /** CTF pedestal positions, or null when the map has no <ctf-flags> block. */
  ctfFlags: CtfFlagPositions | null;
  /** Entities that must face the camera around sim Z (sprite props). */
  billboards: pc.Entity[];
  propCount: number;
  skippedProps: number;
  /** Exact repeats of an earlier <prop> (same prop, place, rotation, texture) that were not built. */
  duplicateProps: number;
  /** Pairs of mesh props sharing a plane with positive overlap area (see CoplanarOverlaps). */
  overlapPairs: number;
  /** Mesh props that received a depth-bias material to settle such an overlap. */
  biasedProps: number;
}

/** A built mesh prop, kept until every prop is in so overlaps can be resolved across all of them. */
interface MeshRecord {
  entity: pc.Entity;
  source: OverlapSource;
  textureUrl: string;
  hasAlpha: boolean;
}

/** Polygon offset per depth-bias level: gl.polygonOffset(slope, units). */
const DEPTH_BIAS_UNITS = 2;
const DEPTH_BIAS_SLOPE = 1;

export class MapLoader {
  private registry = new PropLibRegistry();
  // Caches the promise (not the result) so parallel requests for one file dedupe
  private parsed3dsCache = new Map<string, Promise<Parser3DS>>();
  private meshCache = new Map<string, pc.Mesh>();
  private materialCache = new Map<string, pc.Material>();
  private textureCache = new Map<string, Promise<pc.Texture>>();

  // Every file is resolved through assetUrl() individually (a host app may
  // serve some props from its bundle and the rest remotely). An explicit
  // assetsBase pins all of them under one root instead (the editor's use).
  constructor(private app: pc.AppBase, private assetsBase: string | null = null) {}

  /** URLs of every texture this loader asked the asset registry for (a host app unloads them with the scene). */
  get textureUrls(): string[] {
    return Array.from(this.textureCache.keys());
  }

  /** Site-absolute prop path -> URL. */
  private propUrl(path: string): string {
    return this.assetsBase != null ? `${this.assetsBase}${path}` : assetUrl(path);
  }

  async load(mapUrl: string, parent: pc.Entity): Promise<LoadedMap> {
    const mapXml = await this.fetchXml(mapUrl);
    const collisionShapes = CollisionGeometryParser.parse(mapXml);
    const spawnPoints = parseSpawnPoints(mapXml);
    const bonusRegions = parseBonusRegions(mapXml);
    const ctfFlags = parseCtfFlags(mapXml);
    const { instances, duplicateProps } = dedupeInstances(this.parsePropInstances(mapXml));

    // Load every referenced library.xml once
    const libraryNames = new Set(instances.map((p) => p.libraryName));
    await Promise.all(
      Array.from(libraryNames).map(async (name) => {
        if (this.registry.has(name)) return;
        const folder = libraryNameToFolder(name);
        try {
          const xml = await this.fetchXml(this.propUrl(`/props/${folder}/library.xml`));
          this.registry.add(PropLibrary.parse(xml, folder));
        } catch (e) {
          console.warn(`Prop library not found: ${name} (${folder})`, e);
        }
      }),
    );

    const billboards: pc.Entity[] = [];
    // Sparse, indexed like `instances` so overlap resolution keeps document order
    const meshRecords: (MeshRecord | undefined)[] = new Array(instances.length);
    let skippedProps = 0;
    await Promise.all(
      instances.map(async (instance, index) => {
        try {
          const entity = await this.buildPropEntity(instance, billboards, meshRecords, index);
          if (entity != null) {
            parent.addChild(entity);
          } else {
            skippedProps++;
            console.warn(`Prop skipped: ${instance.libraryName} | ${instance.groupName} | ${instance.propName} | tex=${instance.textureName}`);
          }
        } catch (e) {
          skippedProps++;
          console.warn(`Failed to build prop ${instance.libraryName}/${instance.propName}`, e);
        }
      }),
    );
    const { overlapPairs, biasedProps } = await this.settleOverlaps(meshRecords);
    if (duplicateProps > 0 || overlapPairs > 0) {
      console.info(`Static geometry: ${duplicateProps} duplicate props dropped, ${overlapPairs} coplanar overlaps -> ${biasedProps} props depth-biased`);
    }
    return {
      collisionShapes,
      spawnPoints,
      bonusRegions,
      ctfFlags,
      billboards,
      propCount: instances.length - skippedProps,
      skippedProps,
      duplicateProps,
      overlapPairs,
      biasedProps,
    };
  }

  /**
   * Gives every mesh prop that overlaps an earlier one in-plane a depth-biased
   * clone of its material, so the earlier prop owns the shared surface.
   */
  private async settleOverlaps(meshRecords: (MeshRecord | undefined)[]): Promise<{ overlapPairs: number; biasedProps: number }> {
    const sources = meshRecords.map((record) => record?.source ?? null);
    const { levels, pairs } = resolveCoplanarOverlaps(sources);
    let biasedProps = 0;
    for (const [index, level] of levels) {
      const record = meshRecords[index];
      if (record == null || record.entity.render == null) {
        continue;
      }
      const material = await this.getMaterial(record.textureUrl, record.hasAlpha, false, level);
      for (const meshInstance of record.entity.render.meshInstances) {
        meshInstance.material = material;
      }
      biasedProps++;
    }
    return { overlapPairs: pairs, biasedProps };
  }

  // MapGeometryParser.parseProps / getPropTextureName
  private parsePropInstances(mapXml: Document): PropInstance[] {
    const result: PropInstance[] = [];
    const staticGeometry = firstChild(mapXml.documentElement, 'static-geometry');
    if (staticGeometry == null) {
      return result;
    }
    for (const node of childElements(staticGeometry, 'prop')) {
      const positionNode = firstChild(node, 'position');
      const rotationNode = firstChild(node, 'rotation');
      const textureName = (firstChild(node, 'texture-name')?.textContent ?? '') || DEFAULT_TEXTURE;
      result.push({
        libraryName: node.getAttribute('library-name') ?? '',
        groupName: node.getAttribute('group-name') ?? '',
        propName: node.getAttribute('name') ?? '',
        textureName,
        x: positionNode != null ? childNumber(positionNode, 'x') : 0,
        y: positionNode != null ? childNumber(positionNode, 'y') : 0,
        z: positionNode != null ? childNumber(positionNode, 'z') : 0,
        rotationZ: rotationNode != null ? childNumber(rotationNode, 'z') : 0,
      });
    }
    return result;
  }

  private async buildPropEntity(
    instance: PropInstance,
    billboards: pc.Entity[],
    meshRecords: (MeshRecord | undefined)[],
    index: number,
  ): Promise<pc.Entity | null> {
    const library = this.registry.getLibrary(instance.libraryName);
    if (library == null) {
      return null;
    }
    const def = library.getProp(instance.groupName, instance.propName);
    if (def == null) {
      return null;
    }
    const entity =
      def.kind === 'mesh'
        ? await this.buildMeshProp(def, instance, meshRecords, index)
        : await this.buildSpriteProp(def, billboards);
    if (entity != null) {
      entity.setLocalPosition(instance.x, instance.y, instance.z);
      if (def.kind === 'mesh') {
        entity.setLocalEulerAngles(0, 0, (instance.rotationZ * 180) / Math.PI);
      }
    }
    return entity;
  }

  private async buildMeshProp(
    def: PropMeshDef,
    instance: PropInstance,
    meshRecords: (MeshRecord | undefined)[],
    index: number,
  ): Promise<pc.Entity | null> {
    // library.xml is normalised to lowercase file names at build time
    // (sync-assets), so the references are used verbatim here.
    const folder = `/props/${def.libraryFolder}`;
    const meshUrl = this.propUrl(`${folder}/${def.meshFile}`);
    const parser = await this.parse3ds(meshUrl);
    // PropMesh.processObjects: first object whose name doesn't start with "occl"
    // (and that actually carries geometry — animation files may lead with empty nodes)
    const object =
      parser.objects.find((o) => !o.name.toLowerCase().startsWith('occl') && o.positions.length > 0) ??
      parser.objects.find((o) => o.positions.length > 0);
    if (object == null) {
      return null;
    }
    // Texture: library variant by name, else the 3ds material's own diffuse file
    let textureFile = def.textures.get(instance.textureName) ?? null;
    if (textureFile == null) {
      textureFile = def.textures.values().next().value ?? null;
    }
    if (textureFile == null) {
      textureFile = parser.materials.find((m) => m.diffuseFilename != null)?.diffuseFilename ?? null;
    }
    if (textureFile == null) {
      return null;
    }
    // BitmapData.transparent: png carries an alpha channel, jpg never does.
    // Without this the fully transparent texels (white RGB under alpha 0 in
    // tower.png) render as solid white.
    const hasAlpha = /\.png$/i.test(textureFile);
    const textureUrl = this.propUrl(`${folder}/${textureFile}`);
    const material = await this.getMaterial(textureUrl, hasAlpha);
    const mesh = this.getMesh(meshUrl, object);
    const entity = new pc.Entity(instance.propName);
    entity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(mesh, material)],
    });
    meshRecords[index] = {
      entity,
      textureUrl,
      hasAlpha,
      source: {
        positions: object.positions,
        faces: object.faces,
        x: instance.x,
        y: instance.y,
        z: instance.z,
        rotationZ: instance.rotationZ,
      },
    };
    return entity;
  }

  private async buildSpriteProp(def: PropDef & { kind: 'sprite' }, billboards: pc.Entity[]): Promise<pc.Entity | null> {
    const url = this.propUrl(`/props/${def.libraryFolder}/${def.file}`);
    const texture = await this.getTexture(url);
    const material = (await this.getMaterial(url, true, true)) as pc.StandardMaterial;
    const width = texture.width * def.scale;
    const height = texture.height * def.scale;
    // Quad in sim space: X - width, Z - height, pivot at origin-y fraction from the top
    const pivotZ = height * def.originY;
    const positions = [
      -width / 2, 0, pivotZ,
      width / 2, 0, pivotZ,
      width / 2, 0, pivotZ - height,
      -width / 2, 0, pivotZ - height,
    ];
    const uvs = [0, 1, 1, 1, 1, 0, 0, 0];
    const indices = [0, 1, 2, 0, 2, 3];
    const mesh = buildMesh(this.app.graphicsDevice, { positions, indices, uvs });
    const entity = new pc.Entity('sprite');
    entity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(mesh, material)],
    });
    billboards.push(entity);
    return entity;
  }

  private getMesh(meshUrl: string, object: Parsed3DSObject): pc.Mesh {
    const key = `${meshUrl}#${object.name}`;
    let mesh = this.meshCache.get(key);
    if (mesh == null) {
      mesh = buildMesh(this.app.graphicsDevice, {
        positions: object.positions,
        indices: object.faces,
        uvs: object.uvs ?? undefined,
      });
      this.meshCache.set(key, mesh);
    }
    return mesh;
  }

  private parse3ds(url: string): Promise<Parser3DS> {
    let promise = this.parsed3dsCache.get(url);
    if (promise == null) {
      promise = (async () => {
        const buffer = await assetProgress.trackedFetch(url);
        // Guard against SPA fallback: a real 3DS starts with the 0x4D4D main chunk
        if (buffer.byteLength < 6 || new DataView(buffer).getUint16(0, true) !== 0x4d4d) {
          throw new Error(`Not a 3DS file: ${url}`);
        }
        const parser = new Parser3DS();
        parser.parse(buffer);
        return parser;
      })();
      this.parsed3dsCache.set(url, promise);
    }
    return promise;
  }

  private async getMaterial(textureUrl: string, transparent: boolean, doubleSided = false, biasLevel = 0): Promise<pc.Material> {
    const key = `${textureUrl}|${transparent}|${doubleSided}|${biasLevel}`;
    let material = this.materialCache.get(key);
    if (material == null) {
      const texture = await this.getTexture(textureUrl);
      const standard = new pc.StandardMaterial();
      // Pre-lit textures: render unlit via emissive, like the original TextureMaterial
      standard.diffuse = new pc.Color(0, 0, 0);
      standard.emissiveMap = texture;
      standard.emissive = new pc.Color(1, 1, 1);
      standard.useLighting = false;
      if (transparent) {
        standard.opacityMap = texture;
        standard.opacityMapChannel = 'a';
        standard.alphaTest = 0.5;
      }
      if (doubleSided) {
        standard.cull = pc.CULLFACE_NONE;
      }
      if (biasLevel > 0) {
        // Pushes the prop behind whatever earlier prop shares its plane (CoplanarOverlaps)
        standard.depthBias = biasLevel * DEPTH_BIAS_UNITS;
        standard.slopeDepthBias = biasLevel * DEPTH_BIAS_SLOPE;
      }
      standard.update();
      material = standard;
      this.materialCache.set(key, material);
    }
    return material;
  }

  private getTexture(url: string): Promise<pc.Texture> {
    let promise = this.textureCache.get(url);
    if (promise == null) {
      promise = new Promise<pc.Texture>((resolve, reject) => {
        this.app.assets.loadFromUrl(url, 'texture', (err, asset) => {
          if (err != null || asset == null) {
            reject(new Error(String(err ?? 'texture load failed')));
          } else {
            resolve(asset.resource as pc.Texture);
          }
        });
      });
      this.textureCache.set(url, promise);
    }
    return promise;
  }

  async fetchXml(url: string): Promise<Document> {
    // Through the tracker: map XML is the single largest file a battle pulls
    // (4 MB for babylon) and the loading bar would ignore it otherwise.
    const buffer = await assetProgress.trackedFetch(url);
    const text = new TextDecoder().decode(buffer);
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.querySelector('parsererror') != null) {
      throw new Error(`XML parse error in ${url}`);
    }
    return xml;
  }
}

/**
 * Drops exact repeats of a <prop> (madness has 16, abyss 25). The original drew
 * them all; identical geometry at identical depth is invisible either way, so
 * this only saves draw calls and keeps them out of the overlap resolver.
 */
function dedupeInstances(all: PropInstance[]): { instances: PropInstance[]; duplicateProps: number } {
  const seen = new Set<string>();
  const instances: PropInstance[] = [];
  for (const instance of all) {
    const key = [
      instance.libraryName,
      instance.groupName,
      instance.propName,
      instance.textureName,
      instance.x.toFixed(1),
      instance.y.toFixed(1),
      instance.z.toFixed(1),
      Math.cos(instance.rotationZ).toFixed(3),
      Math.sin(instance.rotationZ).toFixed(3),
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    instances.push(instance);
  }
  return { instances, duplicateProps: all.length - instances.length };
}

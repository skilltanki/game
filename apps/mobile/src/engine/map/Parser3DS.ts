// Port of the original Parser3DS (the 3DS loader of the original 3D engine).
// Output is neutral mesh data (positions/uvs/faces/surfaces) instead of
// the original engine's Mesh/Face/Vertex linked lists; the original's 2D Matrix UV
// transform is replicated with the same component semantics.
// Byte order: little-endian throughout (original set Endian.LITTLE_ENDIAN).

interface ChunkInfo {
  id: number;
  size: number;
  dataSize: number;
  dataPosition: number;
  nextChunkPosition: number;
}

class MapData {
  filename: string | null = null;
  scaleU = 1;
  scaleV = 1;
  offsetU = 0;
  offsetV = 0;
  rotation = 0;
}

class MaterialData {
  name = '';
  color = 0;
  glossiness = 0;
  specular = 0;
  transparency = 0;
  diffuseMap: MapData | null = null;
  opacityMap: MapData | null = null;
  matrix: Matrix2D | null = null;
}

class ObjectData {
  name = '';
  vertices: number[] | null = null;
  uvs: number[] | null = null;
  faces: number[] | null = null;
  smoothingGroups: number[] | null = null;
  surfaces: Map<string, number[]> | null = null;
  a = 0; b = 0; c = 0; d = 0;
  e = 0; f = 0; g = 0; h = 0;
  i = 0; j = 0; k = 0; l = 0;
}

class AnimationData {
  objectName = '';
  object: Parsed3DSObject | null = null;
  parentIndex = 0;
  pivot: [number, number, number] | null = null;
  position: [number, number, number] | null = null;
  rotation: [number, number, number] | null = null;
  scale: [number, number, number] | null = null;
  isInstance = false;
}

/** The original's 2D Matrix with the exact concat semantics it relies on. */
class Matrix2D {
  a = 1; b = 0; c = 0; d = 1; tx = 0; ty = 0;

  translate(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
  }

  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const { a, b, c, d, tx, ty } = this;
    this.a = a * cos - b * sin;
    this.b = a * sin + b * cos;
    this.c = c * cos - d * sin;
    this.d = c * sin + d * cos;
    this.tx = tx * cos - ty * sin;
    this.ty = tx * sin + ty * cos;
  }

  scale(sx: number, sy: number): void {
    this.a *= sx; this.b *= sy;
    this.c *= sx; this.d *= sy;
    this.tx *= sx; this.ty *= sy;
  }
}

export interface Parsed3DSMaterial {
  name: string;
  color: number;
  diffuseFilename: string | null;
  opacityFilename: string | null;
}

export interface Parsed3DSSurface {
  materialName: string;
  faceIndices: number[];
}

export interface Parsed3DSObject {
  name: string;
  /** World-ready vertex positions (animation transform + scale applied), xyz triplets. */
  positions: number[];
  /** UVs after per-material transform, uv pairs; null if the mesh has no mapping. */
  uvs: number[] | null;
  /** Vertex indices, 3 per face. */
  faces: number[];
  /** Face ranges per material; null when the mesh has no material assignment. */
  surfaces: Parsed3DSSurface[] | null;
  x: number; y: number; z: number;
  rotationX: number; rotationY: number; rotationZ: number;
  scaleX: number; scaleY: number; scaleZ: number;
}

const CHUNK_MAIN = 0x4d4d;
const CHUNK_VERSION = 0x0002;
const CHUNK_SCENE = 0x3d3d;
const CHUNK_ANIMATION = 0xb000;
const CHUNK_OBJECT = 0x4000;
const CHUNK_TRIMESH = 0x4100;
const CHUNK_VERTICES = 0x4110;
const CHUNK_FACES = 0x4120;
const CHUNK_FACESMATERIAL = 0x4130;
const CHUNK_FACESSMOOTH = 0x4150;
const CHUNK_MAPPINGCOORDS = 0x4140;
const CHUNK_TRANSFORMATION = 0x4160;
const CHUNK_MATERIAL = 0xafff;

export class Parser3DS {
  objects: Parsed3DSObject[] = [];
  parents: (Parsed3DSObject | null)[] = [];
  materials: Parsed3DSMaterial[] = [];

  private data!: DataView;
  private position = 0;
  private objectDatas: Map<string, ObjectData> | null = null;
  private animationDatas: AnimationData[] | null = null;
  private materialDatas: Map<string, MaterialData> | null = null;

  getObjectByName(name: string): Parsed3DSObject | null {
    for (const object of this.objects) {
      if (object.name === name) {
        return object;
      }
    }
    return null;
  }

  parse(buffer: ArrayBuffer, scale = 1): void {
    if (buffer.byteLength < 6) {
      return;
    }
    this.data = new DataView(buffer);
    this.position = 0;
    this.parse3DSChunk(0, buffer.byteLength);
    this.objects = [];
    this.parents = [];
    this.materials = [];
    this.buildContent(scale);
    this.objectDatas = null;
    this.animationDatas = null;
    this.materialDatas = null;
  }

  // --- byte readers (little-endian, tracking this.position like ByteArray) ---

  private readUnsignedShort(): number {
    const value = this.data.getUint16(this.position, true);
    this.position += 2;
    return value;
  }

  private readUnsignedInt(): number {
    const value = this.data.getUint32(this.position, true);
    this.position += 4;
    return value;
  }

  private readUnsignedByte(): number {
    return this.data.getUint8(this.position++);
  }

  private readFloat(): number {
    const value = this.data.getFloat32(this.position, true);
    this.position += 4;
    return value;
  }

  private getString(position: number): string {
    this.position = position;
    let result = '';
    for (;;) {
      const code = this.data.getUint8(this.position++);
      if (code === 0) {
        break;
      }
      result += String.fromCharCode(code);
    }
    return result;
  }

  private readChunkInfo(position: number): ChunkInfo {
    this.position = position;
    const id = this.readUnsignedShort();
    const size = this.readUnsignedInt();
    return {
      id,
      size,
      dataSize: size - 6,
      dataPosition: this.position,
      nextChunkPosition: position + size,
    };
  }

  // --- chunk tree (1:1 with the original) ---

  private parse3DSChunk(position: number, bytesAvailable: number): void {
    if (bytesAvailable < 6) {
      return;
    }
    const chunk = this.readChunkInfo(position);
    if (chunk.id === CHUNK_MAIN) {
      this.parseMainChunk(chunk.dataPosition, chunk.dataSize);
    }
    this.parse3DSChunk(chunk.nextChunkPosition, bytesAvailable - chunk.size);
  }

  private parseMainChunk(position: number, bytesAvailable: number): void {
    if (bytesAvailable < 6) {
      return;
    }
    const chunk = this.readChunkInfo(position);
    switch (chunk.id) {
      case CHUNK_VERSION:
        break;
      case CHUNK_SCENE:
        this.parse3DChunk(chunk.dataPosition, chunk.dataSize);
        break;
      case CHUNK_ANIMATION:
        this.parseAnimationChunk(chunk.dataPosition, chunk.dataSize);
    }
    this.parseMainChunk(chunk.nextChunkPosition, bytesAvailable - chunk.size);
  }

  private parse3DChunk(position: number, bytesAvailable: number): void {
    while (bytesAvailable >= 6) {
      const chunk = this.readChunkInfo(position);
      switch (chunk.id) {
        case CHUNK_MATERIAL: {
          const material = new MaterialData();
          this.parseMaterialChunk(material, chunk.dataPosition, chunk.dataSize);
          break;
        }
        case CHUNK_OBJECT:
          this.parseObject(chunk);
      }
      position = chunk.nextChunkPosition;
      bytesAvailable -= chunk.size;
    }
  }

  private parseObject(chunk: ChunkInfo): void {
    if (this.objectDatas == null) {
      this.objectDatas = new Map();
    }
    const object = new ObjectData();
    object.name = this.getString(chunk.dataPosition);
    this.objectDatas.set(object.name, object);
    const nameLength = object.name.length + 1;
    this.parseObjectChunk(object, chunk.dataPosition + nameLength, chunk.dataSize - nameLength);
  }

  private parseObjectChunk(object: ObjectData, position: number, bytesAvailable: number): void {
    if (bytesAvailable < 6) {
      return;
    }
    const chunk = this.readChunkInfo(position);
    if (chunk.id === CHUNK_TRIMESH) {
      this.parseMeshChunk(object, chunk.dataPosition, chunk.dataSize);
    }
    this.parseObjectChunk(object, chunk.nextChunkPosition, bytesAvailable - chunk.size);
  }

  private parseMeshChunk(object: ObjectData, position: number, bytesAvailable: number): void {
    if (bytesAvailable < 6) {
      return;
    }
    const chunk = this.readChunkInfo(position);
    switch (chunk.id) {
      case CHUNK_VERTICES:
        this.parseVertices(object);
        break;
      case CHUNK_MAPPINGCOORDS:
        this.parseUVs(object);
        break;
      case CHUNK_TRANSFORMATION:
        this.parseMatrix(object);
        break;
      case CHUNK_FACES:
        this.parseFaces(object, chunk);
    }
    this.parseMeshChunk(object, chunk.nextChunkPosition, bytesAvailable - chunk.size);
  }

  private parseVertices(object: ObjectData): void {
    const count = this.readUnsignedShort();
    object.vertices = [];
    for (let i = 0, n = 0; i < count; i++) {
      object.vertices[n++] = this.readFloat();
      object.vertices[n++] = this.readFloat();
      object.vertices[n++] = this.readFloat();
    }
  }

  private parseUVs(object: ObjectData): void {
    const count = this.readUnsignedShort();
    object.uvs = [];
    for (let i = 0, n = 0; i < count; i++) {
      object.uvs[n++] = this.readFloat();
      object.uvs[n++] = this.readFloat();
    }
  }

  private parseMatrix(object: ObjectData): void {
    object.a = this.readFloat();
    object.e = this.readFloat();
    object.i = this.readFloat();
    object.b = this.readFloat();
    object.f = this.readFloat();
    object.j = this.readFloat();
    object.c = this.readFloat();
    object.g = this.readFloat();
    object.k = this.readFloat();
    object.d = this.readFloat();
    object.h = this.readFloat();
    object.l = this.readFloat();
  }

  private parseFaces(object: ObjectData, chunk: ChunkInfo): void {
    const count = this.readUnsignedShort();
    object.faces = new Array(count * 3);
    object.smoothingGroups = new Array(count);
    for (let i = 0, n = 0; i < count; i++) {
      object.faces[n++] = this.readUnsignedShort();
      object.faces[n++] = this.readUnsignedShort();
      object.faces[n++] = this.readUnsignedShort();
      this.position += 2; // face flags
    }
    const offset = 2 + 8 * count;
    this.parseFacesChunk(object, chunk.dataPosition + offset, chunk.dataSize - offset);
  }

  private parseFacesChunk(object: ObjectData, position: number, bytesAvailable: number): void {
    if (bytesAvailable < 6) {
      return;
    }
    const chunk = this.readChunkInfo(position);
    switch (chunk.id) {
      case CHUNK_FACESMATERIAL:
        this.parseSurface(object);
        break;
      case CHUNK_FACESSMOOTH:
        this.parseSmoothingGroups(object);
    }
    this.parseFacesChunk(object, chunk.nextChunkPosition, bytesAvailable - chunk.size);
  }

  private parseSurface(object: ObjectData): void {
    if (object.surfaces == null) {
      object.surfaces = new Map();
    }
    const faceIndices: number[] = [];
    object.surfaces.set(this.getString(this.position), faceIndices);
    const count = this.readUnsignedShort();
    for (let i = 0; i < count; i++) {
      faceIndices[i] = this.readUnsignedShort();
    }
  }

  private parseSmoothingGroups(object: ObjectData): void {
    const count = object.faces!.length / 3;
    for (let i = 0; i < count; i++) {
      object.smoothingGroups![i] = this.readUnsignedInt();
    }
  }

  private parseAnimationChunk(position: number, bytesAvailable: number): void {
    while (bytesAvailable >= 6) {
      const chunk = this.readChunkInfo(position);
      switch (chunk.id) {
        case 0xb001:
        case 0xb002:
        case 0xb003:
        case 0xb004:
        case 0xb005:
        case 0xb006:
        case 0xb007: {
          if (this.animationDatas == null) {
            this.animationDatas = [];
          }
          const animation = new AnimationData();
          this.animationDatas.push(animation);
          this.parseObjectAnimationChunk(animation, chunk.dataPosition, chunk.dataSize);
          break;
        }
      }
      position = chunk.nextChunkPosition;
      bytesAvailable -= chunk.size;
    }
  }

  private parseObjectAnimationChunk(animation: AnimationData, position: number, bytesAvailable: number): void {
    if (bytesAvailable < 6) {
      return;
    }
    const chunk = this.readChunkInfo(position);
    switch (chunk.id) {
      case 0xb010:
        animation.objectName = this.getString(this.position);
        this.position += 4;
        animation.parentIndex = this.readUnsignedShort();
        break;
      case 0xb011:
        animation.objectName = this.getString(this.position);
        break;
      case 0xb013:
        animation.pivot = [this.readFloat(), this.readFloat(), this.readFloat()];
        break;
      case 0xb020:
        this.position += 20;
        animation.position = [this.readFloat(), this.readFloat(), this.readFloat()];
        break;
      case 0xb021: {
        this.position += 20;
        animation.rotation = this.getRotationFrom3DSAngleAxis(this.readFloat(), this.readFloat(), this.readFloat(), this.readFloat());
        break;
      }
      case 0xb022:
        this.position += 20;
        animation.scale = [this.readFloat(), this.readFloat(), this.readFloat()];
    }
    this.parseObjectAnimationChunk(animation, chunk.nextChunkPosition, bytesAvailable - chunk.size);
  }

  private parseMaterialChunk(material: MaterialData, position: number, bytesAvailable: number): void {
    if (bytesAvailable < 6) {
      return;
    }
    const chunk = this.readChunkInfo(position);
    switch (chunk.id) {
      case 0xa000:
        this.parseMaterialName(material);
        break;
      case 0xa020:
        this.position = chunk.dataPosition + 6;
        material.color = (this.readUnsignedByte() << 16) + (this.readUnsignedByte() << 8) + this.readUnsignedByte();
        break;
      case 0xa040:
        this.position = chunk.dataPosition + 6;
        material.glossiness = this.readUnsignedShort();
        break;
      case 0xa041:
        this.position = chunk.dataPosition + 6;
        material.specular = this.readUnsignedShort();
        break;
      case 0xa050:
        this.position = chunk.dataPosition + 6;
        material.transparency = this.readUnsignedShort();
        break;
      case 0xa200:
        material.diffuseMap = new MapData();
        this.parseMapChunk(material.diffuseMap, chunk.dataPosition, chunk.dataSize);
        break;
      case 0xa210:
        material.opacityMap = new MapData();
        this.parseMapChunk(material.opacityMap, chunk.dataPosition, chunk.dataSize);
        break;
    }
    this.parseMaterialChunk(material, chunk.nextChunkPosition, bytesAvailable - chunk.size);
  }

  private parseMaterialName(material: MaterialData): void {
    if (this.materialDatas == null) {
      this.materialDatas = new Map();
    }
    material.name = this.getString(this.position);
    this.materialDatas.set(material.name, material);
  }

  private parseMapChunk(map: MapData, position: number, bytesAvailable: number): void {
    if (bytesAvailable < 6) {
      return;
    }
    const chunk = this.readChunkInfo(position);
    switch (chunk.id) {
      case 0xa300:
        map.filename = this.getString(chunk.dataPosition).toLowerCase();
        break;
      case 0xa354:
        map.scaleU = this.readFloat();
        break;
      case 0xa356:
        map.scaleV = this.readFloat();
        break;
      case 0xa358:
        map.offsetU = this.readFloat();
        break;
      case 0xa35a:
        map.offsetV = this.readFloat();
        break;
      case 0xa35c:
        map.rotation = this.readFloat();
    }
    this.parseMapChunk(map, chunk.nextChunkPosition, bytesAvailable - chunk.size);
  }

  // --- building neutral mesh data ---

  private buildContent(scale: number): void {
    if (this.materialDatas != null) {
      for (const [name, material] of this.materialDatas) {
        const map = material.diffuseMap;
        if (map != null) {
          const matrix = new Matrix2D();
          const angle = (map.rotation * Math.PI) / 180;
          matrix.translate(-map.offsetU, map.offsetV);
          matrix.translate(-0.5, -0.5);
          matrix.rotate(-angle);
          matrix.scale(map.scaleU, map.scaleV);
          matrix.translate(0.5, 0.5);
          material.matrix = matrix;
        }
        this.materials.push({
          name,
          color: material.color,
          diffuseFilename: map != null ? map.filename : null,
          opacityFilename: material.opacityMap != null ? material.opacityMap.filename : null,
        });
      }
    }
    if (this.animationDatas != null) {
      if (this.objectDatas != null) {
        const count = this.animationDatas.length;
        for (let i = 0; i < count; i++) {
          const animation = this.animationDatas[i];
          const name = animation.objectName;
          const objectData = this.objectDatas.get(name);
          if (objectData != null) {
            // Duplicate object data for keyframe instances sharing one mesh
            let instance = 1;
            for (let j = i + 1; j < count; j++) {
              const other = this.animationDatas[j];
              if (!other.isInstance && name === other.objectName) {
                const copy = new ObjectData();
                const copyName = name + instance++;
                copy.name = copyName;
                this.objectDatas.set(copyName, copy);
                other.objectName = copyName;
                copy.vertices = objectData.vertices;
                copy.uvs = objectData.uvs;
                copy.faces = objectData.faces;
                copy.smoothingGroups = objectData.smoothingGroups;
                copy.surfaces = objectData.surfaces;
                copy.a = objectData.a; copy.b = objectData.b; copy.c = objectData.c; copy.d = objectData.d;
                copy.e = objectData.e; copy.f = objectData.f; copy.g = objectData.g; copy.h = objectData.h;
                copy.i = objectData.i; copy.j = objectData.j; copy.k = objectData.k; copy.l = objectData.l;
              }
            }
          }
          let object: Parsed3DSObject;
          if (objectData != null && objectData.vertices != null) {
            object = this.buildMesh(objectData, animation, scale);
          } else {
            object = this.emptyObject(name);
          }
          object.name = name;
          animation.object = object;
          if (animation.position != null) {
            object.x = animation.position[0] * scale;
            object.y = animation.position[1] * scale;
            object.z = animation.position[2] * scale;
          }
          if (animation.rotation != null) {
            object.rotationX = animation.rotation[0];
            object.rotationY = animation.rotation[1];
            object.rotationZ = animation.rotation[2];
          }
          if (animation.scale != null) {
            object.scaleX = animation.scale[0];
            object.scaleY = animation.scale[1];
            object.scaleZ = animation.scale[2];
          }
        }
        for (const animation of this.animationDatas) {
          this.objects.push(animation.object!);
          this.parents.push(animation.parentIndex === 65535 ? null : this.animationDatas[animation.parentIndex].object);
        }
      }
    } else if (this.objectDatas != null) {
      for (const [name, objectData] of this.objectDatas) {
        if (objectData.vertices != null) {
          const object = this.buildMesh(objectData, null, scale);
          object.name = name;
          this.objects.push(object);
          this.parents.push(null);
        }
      }
    }
  }

  private emptyObject(name: string): Parsed3DSObject {
    return {
      name,
      positions: [],
      uvs: null,
      faces: [],
      surfaces: null,
      x: 0, y: 0, z: 0,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    };
  }

  private buildMesh(objectData: ObjectData, animation: AnimationData | null, scale: number): Parsed3DSObject {
    const result = this.emptyObject(objectData.name);
    let useMatrix = false;
    if (animation != null) {
      // Invert the mesh's local transform (vertices are stored in world space)
      const { a, b, c, d, e, f, g, h, i, j, k, l } = objectData;
      const det = 1 / (-c * f * i + b * g * i + c * e * j - a * g * j - b * e * k + a * f * k);
      objectData.a = (-g * j + f * k) * det;
      objectData.b = (c * j - b * k) * det;
      objectData.c = (-c * f + b * g) * det;
      objectData.d = (d * g * j - c * h * j - d * f * k + b * h * k + c * f * l - b * g * l) * det;
      objectData.e = (g * i - e * k) * det;
      objectData.f = (-c * i + a * k) * det;
      objectData.g = (c * e - a * g) * det;
      objectData.h = (c * h * i - d * g * i + d * e * k - a * h * k - c * e * l + a * g * l) * det;
      objectData.i = (-f * i + e * j) * det;
      objectData.j = (b * i - a * j) * det;
      objectData.k = (-b * e + a * f) * det;
      objectData.l = (d * f * i - b * h * i - d * e * j + a * h * j + b * e * l - a * f * l) * det;
      if (animation.pivot != null) {
        objectData.d -= animation.pivot[0];
        objectData.h -= animation.pivot[1];
        objectData.l -= animation.pivot[2];
      }
      useMatrix = true;
    }
    const numValues = objectData.vertices != null ? objectData.vertices.length : 0;
    const numVertices = numValues / 3;
    const hasUVs = objectData.uvs != null && objectData.uvs.length > 0;
    const positions: number[] = new Array(numValues);
    const uvs: number[] | null = hasUVs ? new Array(numVertices * 2) : null;
    if (objectData.vertices != null) {
      for (let v = 0, n = 0; n < numValues; v++) {
        const x = objectData.vertices[n];
        const y = objectData.vertices[n + 1];
        const z = objectData.vertices[n + 2];
        if (useMatrix) {
          positions[n] = (objectData.a * x + objectData.b * y + objectData.c * z + objectData.d) * scale;
          positions[n + 1] = (objectData.e * x + objectData.f * y + objectData.g * z + objectData.h) * scale;
          positions[n + 2] = (objectData.i * x + objectData.j * y + objectData.k * z + objectData.l) * scale;
        } else {
          positions[n] = x * scale;
          positions[n + 1] = y * scale;
          positions[n + 2] = z * scale;
        }
        if (hasUVs) {
          uvs![v * 2] = objectData.uvs![v * 2];
          uvs![v * 2 + 1] = 1 - objectData.uvs![v * 2 + 1];
        }
        n += 3;
      }
    }
    result.positions = positions;
    result.uvs = uvs;
    result.faces = objectData.faces != null ? objectData.faces.slice() : [];
    if (objectData.surfaces != null) {
      result.surfaces = [];
      // Per-material UV transform, applied once per vertex (original transformId guard)
      const transformed: boolean[] = new Array(numVertices).fill(false);
      for (const [materialName, faceIndices] of objectData.surfaces) {
        result.surfaces.push({ materialName, faceIndices: faceIndices.slice() });
        const material = this.materialDatas != null ? this.materialDatas.get(materialName) : null;
        if (material != null && material.matrix != null && uvs != null) {
          const m = material.matrix;
          for (const faceIndex of faceIndices) {
            for (let corner = 0; corner < 3; corner++) {
              const vertexIndex = result.faces[faceIndex * 3 + corner];
              if (!transformed[vertexIndex]) {
                const u = uvs[vertexIndex * 2];
                const v = uvs[vertexIndex * 2 + 1];
                uvs[vertexIndex * 2] = m.a * u + m.b * v + m.tx;
                uvs[vertexIndex * 2 + 1] = m.c * u + m.d * v + m.ty;
                transformed[vertexIndex] = true;
              }
            }
          }
        }
      }
    }
    return result;
  }

  private getRotationFrom3DSAngleAxis(angle: number, x: number, z: number, y: number): [number, number, number] {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const t = 1 - cos;
    const test = x * y * t + z * sin;
    if (test >= 1) {
      const half = angle / 2;
      return [0, -Math.PI / 2, -2 * Math.atan2(x * Math.sin(half), Math.cos(half))];
    }
    if (test <= -1) {
      const half = angle / 2;
      return [0, Math.PI / 2, 2 * Math.atan2(x * Math.sin(half), Math.cos(half))];
    }
    return [
      -Math.atan2(x * sin - y * z * t, 1 - (x * x + z * z) * t),
      -Math.asin(x * y * t + z * sin),
      -Math.atan2(y * sin - x * z * t, 1 - (y * y + z * z) * t),
    ];
  }
}

// Mesh construction helper.
//
// pc.createMesh() is deprecated in PlayCanvas 2.x in favour of
// Mesh.fromGeometry(device, new Geometry()). Every mesh the game builds at
// runtime (tank hull/turret, props, beams, sprites) goes through here, so the
// call shape lives in exactly one place.

import * as pc from 'playcanvas';

export interface MeshData {
  /** xyz triplets. */
  positions: number[];
  /** Vertex indices, 3 per face. */
  indices: number[];
  /** uv pairs; omitted when the mesh has no mapping. */
  uvs?: number[];
  /** Precomputed normals; calculated from positions/indices when omitted. */
  normals?: number[];
}

export function buildMesh(device: pc.GraphicsDevice, data: MeshData): pc.Mesh {
  const geometry = new pc.Geometry();
  geometry.positions = data.positions;
  geometry.indices = data.indices;
  geometry.normals = data.normals ?? pc.calculateNormals(data.positions, data.indices);
  if (data.uvs != null) {
    geometry.uvs = data.uvs;
  }
  return pc.Mesh.fromGeometry(device, geometry);
}

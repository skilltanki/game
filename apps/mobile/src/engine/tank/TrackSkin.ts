// Port of the original TrackSkin
//
// One scrolling track belt (one side of the hull). The original held references
// to the engine's shared Vertex objects and bumped `vertex.u` in place; here the
// equivalent is a list of indices into the hull mesh's UV buffer, which we
// rewrite and re-upload per frame.
//
// Differences from the original:
//  - the original engine's Face/Vertex objects → face indices + a flat UV array, since
//    PlayCanvas meshes keep UVs in a typed vertex buffer.
//  - setMaterial() dropped: the dead-tank skin is done by tinting the shared
//    material (GameTank.applyDestroyedVisual), not by swapping per-face materials.
//
// The scroll is seamless because the artist unwrapped every belt face with a
// constant UV-per-unit-length ratio (verified: 0.000899 on every Hunter track
// face), exactly what getRatio() averages, and the belt strip tiles along U.

/** Vertex indices of the belt faces (duplicates removed), and the UV/length ratio. */
export class TrackSkin {
  /** Unique vertex indices touched by this belt's faces. */
  private readonly vertices: number[] = [];
  /** Average UV-distance per unit of mesh length over the belt faces. */
  private ratio = 0;

  private readonly faces: number[][] = [];

  /** TrackSkin.addFace */
  addFace(triangle: number[]): void {
    this.faces.push(triangle);
  }

  get faceCount(): number {
    return this.faces.length;
  }

  /**
   * TrackSkin.init: collect the unique vertices and average the per-face
   * UV/length ratio. `positions` is xyz triplets, `uvs` is uv pairs.
   */
  init(positions: number[], uvs: number[]): void {
    let ratioSum = 0;
    const seen = new Set<number>();
    for (const triangle of this.faces) {
      for (const index of triangle) {
        seen.add(index);
      }
      ratioSum += getRatio(triangle, positions, uvs);
    }
    this.ratio = this.faces.length > 0 ? ratioSum / this.faces.length : 0;
    this.vertices.length = 0;
    for (const index of seen) {
      this.vertices.push(index);
    }
  }

  /** TrackSkin.move: shift every belt vertex along U by distance * ratio. */
  move(distance: number, uvs: Float32Array): void {
    const shift = distance * this.ratio;
    if (shift === 0) {
      return;
    }
    for (const index of this.vertices) {
      uvs[index * 2] += shift;
    }
  }
}

/** TrackSkin.getRatio → getRatioForVertices(face.vertices[0], face.vertices[1]) */
function getRatio(triangle: number[], positions: number[], uvs: number[]): number {
  const a = triangle[0];
  const b = triangle[1];
  const dx = positions[a * 3] - positions[b * 3];
  const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
  const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const du = uvs[a * 2] - uvs[b * 2];
  const dv = uvs[a * 2 + 1] - uvs[b * 2 + 1];
  const uvLength = Math.sqrt(du * du + dv * dv);
  return length === 0 ? 0 : uvLength / length;
}

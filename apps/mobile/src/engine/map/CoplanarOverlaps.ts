// Resolver for z-fighting between coplanar static props.
//
// No counterpart in the original client. There every mesh prop became its own
// BSP (MapGeometryParser.makeBSPs) and was drawn through the z-buffer with
// Context3DCompareMode.LESS (Camera3D.render), so two props sharing a plane
// fought over the depth buffer exactly as they do here — and the map data does
// contain such overlaps: on highways three "Bridge Str" decks are stacked on
// the middle of the central overpass, two of them covering the same 1400x1000
// slab through different pivot/rotation pairs (so no XML-level dedupe can see
// it). The original hid part of it only because props were drawn in document order
// every frame; PlayCanvas re-sorts draw calls, so the flicker is constant.
//
// The port resolves this once at load time:
//   1. every mesh prop's triangles are transformed to world space and bucketed
//      by their plane (normal to 1/100, distance to PLANE_D_STEP);
//   2. inside a bucket, triangles of DIFFERENT props whose 2D projections
//      intersect with positive area mark the pair of props as overlapping
//      (touching tiles share an edge — zero area — and are not flagged);
//   3. the later prop in document order gets a depth-bias level one above
//      every earlier prop it overlaps (greedy, so chains A<B<C get 0,1,2).
// MapLoader turns a level into a polygon offset on a cloned material, so the
// FIRST prop in the XML owns the surface deterministically instead of per
// frame. Only levels > 0 cost anything (one extra material per level/texture).

export interface OverlapSource {
  /** Mesh-local vertex positions, xyz triplets (Parsed3DSObject.positions). */
  positions: number[];
  /** Vertex indices, 3 per face. */
  faces: number[];
  x: number;
  y: number;
  z: number;
  rotationZ: number;
}

export interface OverlapResolution {
  /** source index -> depth-bias level (only entries > 0 are present) */
  levels: Map<number, number>;
  /** number of overlapping prop pairs found */
  pairs: number;
}

interface PlaneTriangle {
  source: number;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  /** u0,v0,u1,v1,u2,v2 — counter-clockwise */
  poly: number[];
}

/** Plane-distance bucket width, sim units (cm). Map tiles sit on a 250 grid. */
const PLANE_D_STEP = 2;
/** Bounding boxes must overlap by more than this to be tested (touching ≠ overlap). */
const AABB_EPS = 0.5;
/** Minimum shared area, cm², below which an intersection is float noise. */
const MIN_OVERLAP_AREA = 1;

export function resolveCoplanarOverlaps(sources: (OverlapSource | null)[]): OverlapResolution {
  const count = sources.length;
  const buckets = new Map<string, PlaneTriangle[]>();
  for (let index = 0; index < count; index++) {
    const source = sources[index];
    if (source != null) {
      bucketTriangles(source, index, buckets);
    }
  }

  // pair key = lo * count + hi (lo < hi); counts stay far below 2^53
  const pairKeys = new Set<number>();
  for (const triangles of buckets.values()) {
    if (triangles.length < 2) {
      continue;
    }
    const firstSource = triangles[0].source;
    let mixed = false;
    for (const triangle of triangles) {
      if (triangle.source !== firstSource) {
        mixed = true;
        break;
      }
    }
    if (!mixed) {
      continue;
    }
    // Sweep along U: a ground plane shared by thousands of tiles would
    // otherwise be an all-pairs test.
    triangles.sort((a, b) => a.minU - b.minU);
    for (let i = 0; i < triangles.length; i++) {
      const a = triangles[i];
      for (let j = i + 1; j < triangles.length; j++) {
        const b = triangles[j];
        if (b.minU > a.maxU - AABB_EPS) {
          break;
        }
        if (a.source === b.source) {
          continue;
        }
        if (b.minV > a.maxV - AABB_EPS || a.minV > b.maxV - AABB_EPS) {
          continue;
        }
        const lo = a.source < b.source ? a.source : b.source;
        const hi = a.source < b.source ? b.source : a.source;
        const key = lo * count + hi;
        if (pairKeys.has(key)) {
          continue;
        }
        if (intersectionArea(a.poly, b.poly) > MIN_OVERLAP_AREA) {
          pairKeys.add(key);
        }
      }
    }
  }

  // Greedy levels in document order: by the time `hi` is visited every `lo`
  // it overlaps already has its final level.
  const earlierPartners = new Map<number, number[]>();
  for (const key of pairKeys) {
    const lo = Math.floor(key / count);
    const hi = key - lo * count;
    let list = earlierPartners.get(hi);
    if (list == null) {
      list = [];
      earlierPartners.set(hi, list);
    }
    list.push(lo);
  }
  const levels = new Map<number, number>();
  for (let index = 0; index < count; index++) {
    const partners = earlierPartners.get(index);
    if (partners == null) {
      continue;
    }
    let level = 0;
    for (const partner of partners) {
      const partnerLevel = levels.get(partner) ?? 0;
      if (partnerLevel + 1 > level) {
        level = partnerLevel + 1;
      }
    }
    levels.set(index, level);
  }
  return { levels, pairs: pairKeys.size };
}

function bucketTriangles(source: OverlapSource, index: number, buckets: Map<string, PlaneTriangle[]>): void {
  const { positions, faces } = source;
  const cos = Math.cos(source.rotationZ);
  const sin = Math.sin(source.rotationZ);
  const vertexCount = positions.length / 3;
  const world = new Float64Array(positions.length);
  for (let v = 0, n = 0; v < vertexCount; v++, n += 3) {
    const lx = positions[n];
    const ly = positions[n + 1];
    world[n] = cos * lx - sin * ly + source.x;
    world[n + 1] = sin * lx + cos * ly + source.y;
    world[n + 2] = positions[n + 2] + source.z;
  }
  for (let f = 0; f + 2 < faces.length; f += 3) {
    const i0 = faces[f] * 3;
    const i1 = faces[f + 1] * 3;
    const i2 = faces[f + 2] * 3;
    const ux = world[i1] - world[i0];
    const uy = world[i1 + 1] - world[i0 + 1];
    const uz = world[i1 + 2] - world[i0 + 2];
    const vx = world[i2] - world[i0];
    const vy = world[i2 + 1] - world[i0 + 1];
    const vz = world[i2 + 2] - world[i0 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length < 1e-6) {
      continue; // degenerate
    }
    nx /= length;
    ny /= length;
    nz /= length;
    const d = nx * world[i0] + ny * world[i0 + 1] + nz * world[i0 + 2];
    const key = `${quantize(nx)},${quantize(ny)},${quantize(nz)},${Math.round(d / PLANE_D_STEP)}`;
    // Project onto the plane by dropping the dominant normal axis
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const dropped = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const uAxis = dropped === 0 ? 1 : 0;
    const vAxis = dropped === 2 ? 1 : 2;
    const poly = [
      world[i0 + uAxis], world[i0 + vAxis],
      world[i1 + uAxis], world[i1 + vAxis],
      world[i2 + uAxis], world[i2 + vAxis],
    ];
    const signedArea =
      (poly[2] - poly[0]) * (poly[5] - poly[1]) - (poly[4] - poly[0]) * (poly[3] - poly[1]);
    if (signedArea < 0) {
      const tu = poly[2];
      const tv = poly[3];
      poly[2] = poly[4];
      poly[3] = poly[5];
      poly[4] = tu;
      poly[5] = tv;
    }
    const triangle: PlaneTriangle = {
      source: index,
      minU: Math.min(poly[0], poly[2], poly[4]),
      maxU: Math.max(poly[0], poly[2], poly[4]),
      minV: Math.min(poly[1], poly[3], poly[5]),
      maxV: Math.max(poly[1], poly[3], poly[5]),
      poly,
    };
    let bucket = buckets.get(key);
    if (bucket == null) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(triangle);
  }
}

function quantize(component: number): number {
  // + 0 folds -0 into 0 so the key string is stable
  return Math.round(component * 100) / 100 + 0;
}

/** Area of the intersection of two counter-clockwise convex polygons (Sutherland–Hodgman). */
function intersectionArea(subject: number[], clipper: number[]): number {
  let output = subject;
  const edgeCount = clipper.length / 2;
  for (let e = 0; e < edgeCount && output.length >= 6; e++) {
    const axp = clipper[e * 2];
    const ayp = clipper[e * 2 + 1];
    const bxp = clipper[((e + 1) % edgeCount) * 2];
    const byp = clipper[((e + 1) % edgeCount) * 2 + 1];
    const ex = bxp - axp;
    const ey = byp - ayp;
    const input = output;
    output = [];
    const pointCount = input.length / 2;
    let sx = input[input.length - 2];
    let sy = input[input.length - 1];
    let sInside = ex * (sy - ayp) - ey * (sx - axp) >= -1e-9;
    for (let p = 0; p < pointCount; p++) {
      const px = input[p * 2];
      const py = input[p * 2 + 1];
      const pInside = ex * (py - ayp) - ey * (px - axp) >= -1e-9;
      if (pInside !== sInside) {
        // segment s->p crosses the clip edge line
        const denominator = (sx - px) * ey - (sy - py) * ex;
        if (Math.abs(denominator) > 1e-12) {
          const t = ((sx - axp) * ey - (sy - ayp) * ex) / denominator;
          output.push(sx + t * (px - sx), sy + t * (py - sy));
        }
      }
      if (pInside) {
        output.push(px, py);
      }
      sx = px;
      sy = py;
      sInside = pInside;
    }
  }
  if (output.length < 6) {
    return 0;
  }
  let twiceArea = 0;
  const n = output.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twiceArea += output[i * 2] * output[j * 2 + 1] - output[j * 2] * output[i * 2 + 1];
  }
  return Math.abs(twiceArea) / 2;
}

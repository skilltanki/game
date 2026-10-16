// Port of the original AABB
export class AABB {
  minX = 1e308;
  minY = 1e308;
  minZ = 1e308;
  maxX = -1e308;
  maxY = -1e308;
  maxZ = -1e308;

  setSize(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
  }

  addBoundBox(b: AABB): void {
    this.minX = b.minX < this.minX ? b.minX : this.minX;
    this.minY = b.minY < this.minY ? b.minY : this.minY;
    this.minZ = b.minZ < this.minZ ? b.minZ : this.minZ;
    this.maxX = b.maxX > this.maxX ? b.maxX : this.maxX;
    this.maxY = b.maxY > this.maxY ? b.maxY : this.maxY;
    this.maxZ = b.maxZ > this.maxZ ? b.maxZ : this.maxZ;
  }

  addPoint(x: number, y: number, z: number): void {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    if (z < this.minZ) this.minZ = z;
    if (z > this.maxZ) this.maxZ = z;
  }

  infinity(): void {
    this.minX = 1e308;
    this.minY = 1e308;
    this.minZ = 1e308;
    this.maxX = -1e308;
    this.maxY = -1e308;
    this.maxZ = -1e308;
  }

  intersects(b: AABB, eps: number): boolean {
    return !(
      this.minX > b.maxX + eps || this.maxX < b.minX - eps ||
      this.minY > b.maxY + eps || this.maxY < b.minY - eps ||
      this.minZ > b.maxZ + eps || this.maxZ < b.minZ - eps
    );
  }

  copyFrom(b: AABB): void {
    this.minX = b.minX;
    this.minY = b.minY;
    this.minZ = b.minZ;
    this.maxX = b.maxX;
    this.maxY = b.maxY;
    this.maxZ = b.maxZ;
  }

  clone(): AABB {
    const result = new AABB();
    result.copyFrom(this);
    return result;
  }

  getSizeX(): number {
    return this.maxX - this.minX;
  }

  getSizeY(): number {
    return this.maxY - this.minY;
  }

  getSizeZ(): number {
    return this.maxZ - this.minZ;
  }

  toString(): string {
    return `AABB(${this.minX.toFixed(3)}, ${this.minY.toFixed(3)}, ${this.minZ.toFixed(3)}: ${this.maxX.toFixed(3)}, ${this.maxY.toFixed(3)}, ${this.maxZ.toFixed(3)})`;
  }
}

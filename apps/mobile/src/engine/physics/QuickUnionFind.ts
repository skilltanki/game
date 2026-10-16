// Port of the original QuickUnionFind
export class QuickUnionFind {
  private items: number[] = [0];
  private size: number[] = [1];

  init(n: number): void {
    this.items.length = n;
    this.size.length = n;
    for (let i = 0; i < n; i++) {
      this.items[i] = i;
      this.size[i] = 1;
    }
  }

  union(a: number, b: number): void {
    if (!this.connected(a, b)) {
      const rootA = this.root(a);
      const rootB = this.root(b);
      const sizeA = this.size[rootA];
      const sizeB = this.size[rootB];
      if (sizeA > sizeB) {
        this.items[rootB] = rootA;
        this.size[rootA] += sizeB;
      } else {
        this.items[rootA] = rootB;
        this.size[rootB] += sizeA;
      }
    }
  }

  connected(a: number, b: number): boolean {
    return this.root(a) === this.root(b);
  }

  root(i: number): number {
    let r = i;
    while (this.items[r] !== r) {
      r = this.items[r];
    }
    return r;
  }
}

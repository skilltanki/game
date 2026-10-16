// Min-heap of (node, priority) pairs over typed arrays: the open list of
// A*/Dijkstra. Duplicates are allowed (lazy deletion by the caller).
export class BinaryHeap {
  private nodes: Int32Array;
  private priorities: Float64Array;
  private count = 0;

  constructor(capacity = 1024) {
    this.nodes = new Int32Array(capacity);
    this.priorities = new Float64Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  push(node: number, priority: number): void {
    if (this.count === this.nodes.length) {
      this.grow();
    }
    let i = this.count++;
    this.nodes[i] = node;
    this.priorities[i] = priority;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** The node with the smallest priority (caller must check size first). */
  pop(): number {
    const top = this.nodes[0];
    this.count--;
    if (this.count > 0) {
      this.nodes[0] = this.nodes[this.count];
      this.priorities[0] = this.priorities[this.count];
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.count && this.priorities[left] < this.priorities[smallest]) smallest = left;
        if (right < this.count && this.priorities[right] < this.priorities[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const n = this.nodes[a];
    this.nodes[a] = this.nodes[b];
    this.nodes[b] = n;
    const p = this.priorities[a];
    this.priorities[a] = this.priorities[b];
    this.priorities[b] = p;
  }

  private grow(): void {
    const nodes = new Int32Array(this.nodes.length * 2);
    nodes.set(this.nodes);
    this.nodes = nodes;
    const priorities = new Float64Array(this.priorities.length * 2);
    priorities.set(this.priorities);
    this.priorities = priorities;
  }
}

// Minimal typed event emitter. Listeners are called synchronously in
// subscription order; a throwing listener does not stop the others.

export type Listener<T> = (payload: T) => void;

export class TypedEmitter<Map extends object> {
  private readonly listeners = new Map<keyof Map, Set<Listener<never>>>();

  on<K extends keyof Map>(name: K, listener: Listener<Map[K]>): () => void {
    let set = this.listeners.get(name);
    if (set == null) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set!.delete(listener as Listener<never>);
    };
  }

  once<K extends keyof Map>(name: K, listener: Listener<Map[K]>): () => void {
    const off = this.on(name, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof Map>(name: K, payload: Map[K]): void {
    const set = this.listeners.get(name);
    if (set == null) {
      return;
    }
    for (const listener of [...set]) {
      try {
        (listener as Listener<Map[K]>)(payload);
      } catch (error) {
        console.error(`listener for "${String(name)}" failed`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

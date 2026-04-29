type EventMap = Record<string, unknown[]>;

/**
 * Minimal typed event emitter (no Node `events` polyfill needed for browser).
 * Returns unsubscribe fn from on(). Errors in listeners are isolated.
 */
export class TypedEventEmitter<E extends EventMap> {
  private listeners: { [K in keyof E]?: Set<(...args: E[K]) => void> } = {};

  on<K extends keyof E>(event: K, listener: (...args: E[K]) => void): () => void {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event]!.add(listener);
    return () => {
      this.listeners[event]?.delete(listener);
    };
  }

  off<K extends keyof E>(event: K, listener: (...args: E[K]) => void): void {
    this.listeners[event]?.delete(listener);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const listener of set) {
      try {
        listener(...args);
      } catch (e) {
        // Isolate listener errors — one bad listener shouldn't break others
        console.error('[TypedEventEmitter] listener threw for event', event, e);
      }
    }
  }

  removeAll(): void {
    this.listeners = {};
  }
}

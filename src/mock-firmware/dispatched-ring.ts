/**
 * Fixed-cap ringbuffer för dispatched descriptors.
 *
 * Bakgrund: tidigare impl klonade hela arrayen (slice + push + splice) i
 * varje synth-engine emit. Vid PACE_MIN (5ms = 200Hz) på en 5000-element
 * buffer = ~1M array-ops/s bara för buffer-maintenance. AppState push-path
 * går nu via en ring som är O(1)/push.
 *
 * snapshot() returnerar items i kronologisk ordning (äldsta först), vilket
 * är vad Oscilloscope timing-bars och CSV-export förväntar sig. Snapshot är
 * O(cap) men tas bara vid läsning (Svelte $derived re-evaluation), inte
 * per write — kombinerat med throttlad count-trigger ger det praktisk
 * read-kostnad ~30Hz × cap istället för 200Hz × cap.
 */

export class DispatchedRing<T> {
  private buf: (T | undefined)[];
  /** Position där NÄSTA push kommer skriva (= position av äldsta item när full). */
  private head = 0;
  private _size = 0;

  constructor(private readonly cap: number) {
    if (cap <= 0) throw new Error('DispatchedRing: cap must be > 0');
    this.buf = new Array<T | undefined>(cap);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.cap;
    if (this._size < this.cap) this._size++;
  }

  /** Antal items currently i ringen (≤ cap). */
  get size(): number {
    return this._size;
  }

  get capacity(): number {
    return this.cap;
  }

  /**
   * Snapshot i kronologisk ordning (äldsta först).
   * O(cap) — kalla bara vid faktisk read (UI-derived eller export).
   */
  snapshot(): T[] {
    if (this._size < this.cap) {
      // Buffer ej full än — slots [0..size) är i ordning
      return this.buf.slice(0, this._size) as T[];
    }
    // Full: head pekar på äldsta. Wrap-around plocka [head..cap) + [0..head)
    return [
      ...(this.buf.slice(this.head) as T[]),
      ...(this.buf.slice(0, this.head) as T[]),
    ];
  }

  clear(): void {
    this.head = 0;
    this._size = 0;
    this.buf.fill(undefined);
  }
}

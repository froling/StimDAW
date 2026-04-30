/**
 * Clock-interface för synth-engine — event-driven scheduling per eng-review 1.1A.
 *
 * Två implementationer:
 *   - RealtimeClock: setTimeout-baserad, för production
 *   - TestClock: deterministic, för bun-test (advance() fires events)
 *
 * Synth-engine schemalägger nästa per-channel-emit via clock.scheduleAt(t, fn).
 * Återanvänder mock-firmware:s event-driven SimClock-paradigm men i µs-domänen
 * (synth-engine arbetar i µs eftersom descriptor.startTimeMicros är µs).
 *
 * Per eng-review 2.5A: ingen explicit cancel-API. Synth-engine använder
 * generation-counter pattern istället — schedule-callbacks captures generation,
 * no-op vid mismatch. Detta matchar firmware.ts ptQueueGeneration-mönstret.
 */

export interface Clock {
  /** Current time i mikrosekunder. Monotont stigande. */
  nowMicros(): number;
  /**
   * Schemalägg fn att fire vid absolut tid (µs). Past-due events fire vid
   * nästa tick (RealtimeClock: setTimeout(fn, 0); TestClock: nästa advance()).
   */
  scheduleAt(timeMicros: number, fn: () => void): void;
}

/**
 * RealtimeClock — production. Använder `performance.now()` som tidsbas
 * och `setTimeout` för scheduling. Anchored till constructor-tid så
 * `nowMicros()` startar från 0.
 *
 * Caveat: setTimeout har ~4ms minimum-delay i flesta browsers under load.
 * För synth-engine OK eftersom typisk pace är 5-62.5ms (≥ minimum).
 * Per-emit jitter ~1-4ms acceptabelt — descriptors landar i mock-firmware
 * eller hardware-queue och dispatchas exakt vid descriptor.startTimeMicros.
 */
export class RealtimeClock implements Clock {
  private startWallMs: number;

  constructor() {
    this.startWallMs = performance.now();
  }

  nowMicros(): number {
    return (performance.now() - this.startWallMs) * 1000;
  }

  scheduleAt(timeMicros: number, fn: () => void): void {
    const delayMs = Math.max(
      0,
      timeMicros / 1000 - (performance.now() - this.startWallMs),
    );
    setTimeout(fn, delayMs);
  }
}

/**
 * TestClock — deterministic, för bun-test. Time advances ENBART via advance().
 * Ingen wall-clock-koppling. scheduleAt:ade events fire i tid-ordning under
 * advance().
 *
 * Past-due events (timeMicros < nowMicros) clampas till nuvarande tid och
 * fire:ar vid nästa advance() — matchar synth-engine semantik (ingen
 * "missade" events).
 */
export class TestClock implements Clock {
  private now = 0;
  private events: Array<{ time: number; fn: () => void }> = [];

  nowMicros(): number {
    return this.now;
  }

  scheduleAt(timeMicros: number, fn: () => void): void {
    const time = Math.max(this.now, timeMicros);
    // Insert sorted by time så advance() fires i ordning
    let i = 0;
    while (i < this.events.length && this.events[i]!.time <= time) i++;
    this.events.splice(i, 0, { time, fn });
  }

  /**
   * Avancera tiden med deltaMicros. Fires alla events där time ≤ nowMicros.
   * Events som schemaläggs UNDER fire (callback gör scheduleAt) fångas också
   * om de hamnar inom intervallet.
   */
  advance(deltaMicros: number): void {
    const target = this.now + deltaMicros;
    while (this.events.length > 0 && this.events[0]!.time <= target) {
      const evt = this.events.shift()!;
      this.now = evt.time;
      try {
        evt.fn();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('TestClock event threw:', e);
      }
    }
    this.now = target;
  }

  /** Reset to zero, drop all pending events. */
  reset(): void {
    this.now = 0;
    this.events = [];
  }

  /** Test-helper — antal pending events. */
  pendingCount(): number {
    return this.events.length;
  }
}

/**
 * Monotonic simulated-time scheduler — single source of "time" for the mock.
 *
 * Per architectural decision A2 + R1 (eng-review): we test logic, not realtime.
 * If real JS event loop falls behind, simulated time advances by actual elapsed
 * real time — events fire in scheduled order, never lose causality.
 *
 * One clock, one priority queue. Render reads snapshot, scheduler drives mutations.
 */

interface ScheduledEvent {
  time: number;
  fn: () => void;
}

export class SimClock {
  private now = 0;
  private events: ScheduledEvent[] = [];
  private lastReal = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /** Current simulated time in ms. */
  getTime(): number {
    return this.now;
  }

  /** Schedule a callback at a future simulated time. */
  scheduleAt(time: number, fn: () => void): void {
    if (time < this.now) {
      throw new Error(`Cannot schedule in the past: ${time} < ${this.now}`);
    }
    let i = 0;
    while (i < this.events.length && this.events[i]!.time <= time) i++;
    this.events.splice(i, 0, { time, fn });
  }

  /** Schedule a callback `delay` simulated ms from now. */
  scheduleIn(delay: number, fn: () => void): void {
    this.scheduleAt(this.now + delay, fn);
  }

  /** Advance simulated time and fire any due events. */
  advance(deltaMs: number): void {
    const target = this.now + deltaMs;
    while (this.events.length > 0 && this.events[0]!.time <= target) {
      const evt = this.events.shift()!;
      this.now = evt.time;
      try {
        evt.fn();
      } catch (e) {
        console.error('SimClock event threw:', e);
      }
    }
    this.now = target;
  }

  /** Drive the clock from real-time intervals. Stop with stopRealtime(). */
  startRealtime(intervalMs = 16): void {
    if (this.intervalHandle !== null) return;
    this.lastReal = performance.now();
    this.intervalHandle = setInterval(() => {
      const realNow = performance.now();
      const delta = realNow - this.lastReal;
      this.lastReal = realNow;
      this.advance(delta);
    }, intervalMs);
  }

  stopRealtime(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Reset to zero, drop all events. For tests. */
  reset(): void {
    this.now = 0;
    this.events = [];
    this.stopRealtime();
  }
}

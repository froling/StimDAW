/**
 * Hard absolute-amplitude ceiling. Ramp-controller controls *rate of change*;
 * this controls *absolute max*. Both are needed (per outside-voice finding #2).
 *
 * Default is 50% of full scale — conservative. User can raise in settings.
 * The UI slider's max should be tied to this ceiling, AND the safety layer
 * enforces it on every output (defense in depth).
 */

const DEFAULT_MAX = 100;

export class MaxCeiling {
  private value: number;
  private readonly max: number;

  constructor(initial = 50, max = DEFAULT_MAX) {
    this.max = clamp(max, 1, 1000);
    this.value = clamp(initial, 0, this.max);
  }

  get(): number {
    return this.value;
  }

  /** Returns clamped value actually stored (may differ from input). */
  set(value: number): number {
    this.value = clamp(value, 0, this.max);
    return this.value;
  }

  /** Enforce ceiling on a candidate output value. NaN/negative → 0; Infinity → ceiling. */
  enforce(candidate: number): number {
    if (Number.isNaN(candidate) || candidate < 0) return 0;
    return Math.min(candidate, this.value);
  }

  getMax(): number {
    return this.max;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

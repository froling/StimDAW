/**
 * Ramp controller — säkerhetslager som driver intensity-kommandon.
 *
 * Beteende:
 * - Användaren sätter desired via setDesired() (UI-slider, debug-cmd, etc).
 * - När transport disconnectar → effective amplitude = 0.
 * - När transport reconnectar inom samma session → ramp linjärt från 0 till
 *   lastKnown över rampUpDurationMs (default 5s).
 * - STOP cancelar ramp omedelbart, sätter desired och lastKnown till 0.
 *
 * lastKnown PERSISTERAS BARA INOM SESSION. App-restart = lastKnown återställs
 * till 0 (klassen är fresh-instantierad). Detta är medveten security: igår 80%
 * != idag 80% — annan dag, kanske annan placering, annan kropp.
 *
 * Alla värden i 0..100 (IntensityPercent-skala). MaxCeiling appliceras separat.
 */

export interface RampControllerOptions {
  /** Default 5000ms (per CEO plan A5=A). Configurable, persisted in fileformat. */
  rampUpDurationMs?: number;
}

export interface RampControllerSnapshot {
  desired: number;
  lastKnown: number;
  ramping: boolean;
  connected: boolean;
  effective: number;
}

export class RampController {
  private opts: Required<RampControllerOptions>;
  private desired = 0;
  private lastKnown = 0;
  private rampStart: number | null = null;
  private connected = false;

  constructor(opts: RampControllerOptions = {}) {
    this.opts = {
      rampUpDurationMs: Math.max(0, opts.rampUpDurationMs ?? 5000),
    };
  }

  /** Update ramp-up duration (e.g. when user changes setting). */
  setRampUpDuration(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.opts.rampUpDurationMs = ms;
  }

  getRampUpDuration(): number {
    return this.opts.rampUpDurationMs;
  }

  /**
   * User adjusts intensity (UI slider, debug cmd, etc).
   * Updates desired + lastKnown. Cancels in-progress ramp (active intent overrides).
   */
  setDesired(value: number): void {
    const v = clamp(value, 0, 100);
    this.desired = v;
    if (this.connected) {
      this.lastKnown = v;
      this.rampStart = null;
    }
  }

  /** Transport opened. lastKnown > 0 → reconnect → start ramp. */
  onConnect(now: number): void {
    this.connected = true;
    this.rampStart = this.lastKnown > 0 ? now : null;
  }

  /** Transport closed. lastKnown preserved for potential reconnect this session. */
  onDisconnect(): void {
    this.connected = false;
    this.rampStart = null;
  }

  /** STOP button: cancel ramp, zero everything. */
  onStop(): void {
    this.rampStart = null;
    this.desired = 0;
    this.lastKnown = 0;
  }

  /**
   * Compute effective amplitude at given sim time. Side-effect: mutates internal
   * ramp-state if ramp completed during this call.
   */
  getEffective(now: number): number {
    if (!this.connected) return 0;
    if (this.rampStart === null) return this.desired;
    const elapsed = now - this.rampStart;
    if (elapsed < 0) return 0;
    if (elapsed >= this.opts.rampUpDurationMs) {
      this.rampStart = null;
      this.desired = this.lastKnown;
      return this.lastKnown;
    }
    return Math.round((elapsed / this.opts.rampUpDurationMs) * this.lastKnown);
  }

  /** For tests/observability. */
  snapshot(now: number): RampControllerSnapshot {
    return {
      desired: this.desired,
      lastKnown: this.lastKnown,
      ramping: this.rampStart !== null,
      connected: this.connected,
      effective: this.getEffective(now),
    };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Voltage simulator — RC-charge model for Vcap, steady-state Vbat with light noise.
 *
 * Vcap: charges toward (intensity/100)·V_CAP_MAX_MV when playing, decays toward 0
 * when paused/stopped. Single-pole RC tau ≈ 200ms.
 * Vbat: ~9V battery, light noise.
 * Iprim: roughly proportional to intensity when playing, ~0 otherwise.
 *
 * Boundary clamps prevent NaN/Inf reaching the wire (per outside-voice finding).
 */

const V_BAT_NOMINAL_MV = 8800;
const V_CAP_MAX_MV = 80000;
const RC_TAU_MS = 200;
const NOISE_MV = 50;
const NOISE_MA = 20;

export interface VoltageReading {
  Vbat_mV: number;
  Vcap_mV: number;
  Iprim_mA: number;
}

export class VoltageSim {
  private vcapMv = 0;
  private intensityPercent = 0;
  private playing = false;

  setIntensity(percent: number): void {
    this.intensityPercent = clamp(percent, 0, 100);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  /** Advance the model by `dtMs` simulated milliseconds. */
  advance(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) return;
    const target = this.playing ? (this.intensityPercent / 100) * V_CAP_MAX_MV : 0;
    const alpha = 1 - Math.exp(-dtMs / RC_TAU_MS);
    this.vcapMv += (target - this.vcapMv) * alpha;
    if (!Number.isFinite(this.vcapMv) || this.vcapMv < 0) this.vcapMv = 0;
    if (this.vcapMv > V_CAP_MAX_MV) this.vcapMv = V_CAP_MAX_MV;
  }

  /** Read with light gaussian-ish jitter. */
  read(): VoltageReading {
    const iprim = this.playing ? Math.round((this.intensityPercent / 100) * 800) : 0;
    return {
      Vbat_mV: clampInt(V_BAT_NOMINAL_MV + jitter(NOISE_MV), 0, 65535),
      Vcap_mV: clampInt(this.vcapMv + jitter(NOISE_MV), 0, 65535),
      Iprim_mA: clampInt(iprim + jitter(NOISE_MA), 0, 65535),
    };
  }

  reset(): void {
    this.vcapMv = 0;
    this.intensityPercent = 0;
    this.playing = false;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.round(clamp(n, lo, hi));
}

function jitter(amplitude: number): number {
  return (Math.random() - 0.5) * 2 * amplitude;
}

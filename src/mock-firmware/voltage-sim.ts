/**
 * Voltage simulator — RC-charge model for Vcap, steady-state Vbat with light noise.
 *
 * Vcap: charges toward (intensity/100)·V_CAP_MAX_MV when playing, decays toward 0
 * when paused/stopped. Single-pole RC tau ≈ 200ms.
 * Vbat: ~9V battery, light noise.
 * Iprim: roughly proportional to intensity when playing, ~0 otherwise.
 *
 * Per-puls Vcap-dipp (β post-rewrite, eng-review T2): onPulseFired() drar
 * ner Vcap proportionellt mot pulse-energi (amp × pw). RC-recovery via
 * existing advance() fyller på mellan pulser. Detta gör Vcap-trace
 * descriptor-driven (verklig hardware-behavior), inte enbart intensity-
 * baseline.
 *
 * Boundary clamps prevent NaN/Inf reaching the wire (per outside-voice finding).
 */
import type { PtDescriptor } from '../protocol/descriptor';

const V_BAT_NOMINAL_MV = 8800;
const V_CAP_MAX_MV = 80000;
const RC_TAU_MS = 200;
const NOISE_MV = 50;
const NOISE_MA = 20;

/**
 * Per-puls dipp-modell. amp×pw är proxy för "hur mycket laddning denna
 * puls drog från caps". Vid full puls (amp=255, pw=200µs) får vi en dipp
 * på ~PULSE_DIP_FACTOR_MV mV. Realistic-ish värde — baserat på intuitiv
 * skala, inte rigorös fysik. Real hardware kommer kalibrera detta.
 */
const PULSE_DIP_FACTOR_MV = 800;
const FULL_DIP_AMP_X_PW = 255 * 200;

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

  /**
   * Notifiera om en avfyrad puls. Drar ner Vcap proportionellt mot
   * (amp × pulse_width). RC-recovery sker i advance() mellan ticks.
   * amp=0 i descriptor betyder "behåll föregående voltage" per spec,
   * så vi använder INTE descriptor.amplitude direkt utan en proxy
   * för pulse-energi (amp byte × pw µs).
   */
  onPulseFired(desc: PtDescriptor): void {
    const amp = clamp(desc.amplitude, 0, 255);
    const pw = clamp(desc.pulseWidthMicros, 0, 200);
    if (amp === 0 || pw === 0) return; // amp=0 = inherit, ingen energi-dipp
    const energyProxy = amp * pw;
    const dipMv = (energyProxy / FULL_DIP_AMP_X_PW) * PULSE_DIP_FACTOR_MV;
    this.vcapMv -= dipMv;
    if (this.vcapMv < 0) this.vcapMv = 0;
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

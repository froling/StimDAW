/**
 * Pure module. No Svelte imports, no $state, no I/O.
 *
 * Type-skelett för β Oscilloscope-pipeline. Designen följer
 * `docs/designs/BETA_OSCILLOSCOPE.md` (locked 2026-05-02).
 *
 * Pipeline:
 *   dispatched-buffer → expand → electrode-mapping → frame
 *
 * Time-base är stream-time (relativt första descriptors `startTimeMicros`),
 * INTE wall-clock. Mock + live-mixer ankrar vid första emit; batch-mode
 * (framtid) ankrar vid lägsta startTime av pre-queued descriptors.
 */
import type { Elcon } from '../patterns/types';

/**
 * En FIRED puls — single-pulse-event efter expansion av en descriptor med
 * `nr_of_pulses > 1` och deltas applicerade.
 *
 * Skapas av `expand.ts` från en `PtDescriptor`. Varje descriptor producerar
 * `nr_of_pulses` FiredPulse-events (mixer = 1 per descriptor, patterns
 * varierar).
 */
export interface FiredPulse {
  /** Stream-time µs (när pulsen fyrar) */
  readonly streamTimeMicros: number;
  /** Vilka electrodes går till T+ resp T- vid denna puls */
  readonly elcon: Elcon;
  /** 0 = forward (CCR1 i firmware), 1 = reverse (CCR2) */
  readonly phase: 0 | 1;
  /** Pulse-width µs efter delta-application och clamp till MIN/MAX */
  readonly pulseWidthMicros: number;
  /** Pace till NÄSTA puls inom samma burst (µs efter delta + clamp) */
  readonly paceMicros: number;
  /**
   * Wire-truth amplitude byte 0..255 (post-ramp/ceiling clamp i synth-engine).
   * Detta är vad som FAKTISKT går på protokollet — det som firmware tolkar och
   * matar ut via primary voltage. Vid intensity=0 → 0 (hardware delivers 0V).
   * Vid intensity > 0 → real value scaled by ramp/ceiling.
   *
   * Ersatte tidigare `effectivePrimaryVoltageMV` (Vcap-telemetri) per eng-review
   * 2026-05-02: viz visar wire-truth, inte composition-intent. Hardware-reality
   * via protokoll-byte är tillräckligt; voltage-band-trace (Vcap) ligger separat.
   */
  readonly descriptorAmplitude: number;
  /** Källa-descriptor sequence number (för debug/cross-ref) */
  readonly sourceDescriptorSeq: number;
  /** 0..nr_of_pulses-1 — vilken puls i sin burst */
  readonly pulseIdxInBurst: number;
}

/**
 * Step-event för primary-voltage-trace. Ritas som step-line ovanpå
 * electrode-bandet.
 *
 * I v1 läses voltage-trace direkt från `app.voltageHistory` (real telemetri
 * från `voltages`-event). Denna typ används för render-time overlays —
 * inte för wire-truth-anchoring.
 */
export interface PrimaryVoltageStep {
  readonly streamTimeMicros: number;
  readonly voltageMV: number;
  readonly source: 'intensity-percent' | 'descriptor-amp' | 'telemetry';
}

/**
 * Frame som rendrad komponent konsumerar. Plain data — canvas-redo om
 * SVG perf bits. Producerad var 33ms av frame-builder vid 30Hz.
 */
export interface OscilloscopeFrame {
  /** Aktuell stream-time vid denna frame ("now" cursor på höger kant) */
  readonly streamNowMicros: number;
  /** Synligt fönster µs (default 6_000_000 = 6s) */
  readonly windowMicros: number;
  /** En entry per electrode (alltid exakt 4: A, B, C, D) */
  readonly electrodeRows: readonly ElectrodeRowFrame[];
  /** Global voltage-trace (mV över tid, ritas separat lager) */
  readonly primaryVoltageSteps: readonly PrimaryVoltageStep[];
}

/**
 * Per-electrode rad i framen. Listar alla pulser där elektroden var
 * aktiv (på antingen T+ eller T-) inom det synliga fönstret.
 */
export interface ElectrodeRowFrame {
  readonly electrode: 'A' | 'B' | 'C' | 'D';
  /** Bitmask för matchning mot elcon-bits */
  readonly bit: 1 | 2 | 4 | 8;
  /** Pulser där electrode är aktiv. Sorted by streamTimeMicros ascending. */
  readonly pulses: readonly ElectrodeRowPulse[];
}

/**
 * En puls projicerad till en specifik electrode-rad. En FiredPulse med
 * elcon=[A,C → B,D] genererar 4 ElectrodeRowPulse (en per A, B, C, D).
 */
export interface ElectrodeRowPulse {
  readonly streamTimeMicros: number;
  readonly pulseWidthMicros: number;
  /**
   * Polaritet på DENNA elektrod-rad vid DENNA puls.
   * - 'pos' = T+ side (varm färg)
   * - 'neg' = T- side (kall färg)
   *
   * Bestäms av kombination (elcon-pos/neg, phase). Phase=0: pos_mask = T+,
   * neg_mask = T-. Phase=1: pos_mask = T-, neg_mask = T+.
   *
   * UX-encoding (per eng-review): warm/cold är användarfriendly approximation
   * av biphasic-pair-första-halvan, INTE strict hardware-truth.
   */
  readonly polarity: 'pos' | 'neg';
  /** 0..1 normaliserad amplitude för opacity-rendering */
  readonly amplitudeNorm: number;
  /** Källa-descriptor sequence number */
  readonly sourceDescriptorSeq: number;
}

// ─── Stream-time helper (single source-of-truth) ────────────────────────

/**
 * Konvertera descriptor.startTimeMicros → stream-time.
 * Origin är `null` innan första dispatch under en run; alla pulses
 * mappas då till streamTime=0 (visas vid window-vänster-kant).
 *
 * Använd ALLTID denna helper för wall→stream-konvertering. Eng-review
 * lock: en plats, ingen drift mellan moduler.
 */
export function streamTime(
  descriptorStartTimeMicros: number,
  originMicros: number | null,
): number {
  if (originMicros === null) return 0;
  return descriptorStartTimeMicros - originMicros;
}

// ─── Electrode mapping consts ────────────────────────────────────────────

/** Stable electrode definitions för UI-rader. Ordering: A, B, C, D. */
export const ELECTRODE_DEFS = [
  { electrode: 'A' as const, bit: 1 as const },
  { electrode: 'B' as const, bit: 2 as const },
  { electrode: 'C' as const, bit: 4 as const },
  { electrode: 'D' as const, bit: 8 as const },
] as const;

/** Default rendering window. Per α2 design lock + brief §11. */
export const DEFAULT_WINDOW_MICROS = 6_000_000;

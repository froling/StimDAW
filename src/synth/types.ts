/**
 * Modular synth datamodell — pure types, ingen logik.
 *
 * Per BETA_MIXER_MODULAR_SYNTH.md eng-review locks (2026-05-01):
 *   - State är pure TS (ingen Svelte runtime-binding) → bun-test:bart
 *   - Hardware-bounds importeras från src/protocol/hardware-bounds.ts (DRY)
 *   - Reason-style: knob.base är user-set, LFO oscillerar runt det via cable
 *
 * Modul-boundary: types.ts är platform-fri. State-mutators bor i state.ts.
 * Synth-engine konsumerar denna modell men muterar den inte direkt — UI-actions
 * går via state.ts som returnerar nya immutable snapshots.
 */
import type { Elcon } from '../patterns/types';

export type WaveShape = 'sine' | 'saw' | 'saw-down' | 'square' | 'triangle';

/**
 * Polaritets-mode för LFO output. Applicerat efter waveform-evaluering,
 * före amount-skalning. Ger asymmetrisk kontroll över hur LFO påverkar
 * channel-knob.
 *
 * - 'bipolar' (default): output ∈ [-1, +1]. Symmetrisk swing kring knob.base.
 *   LFO kan både öka och minska channel-värdet.
 * - 'negative-boost': negativ halva multipliceras med 2 → output ∈ [-2, +1].
 *   Med depth=1 + amount=1 räcker swing för att bottnar channel även när
 *   knob.base är högt (t.ex. amp=200/255 → kan nå 0). Positiv halva oförändrad.
 * - 'negative-only': output mappas till [-1, 0] via (signal-1)/2.
 *   LFO minskar bara channel, ökar aldrig. Vågformsskepnad bevarad.
 */
export type WaveMode = 'bipolar' | 'negative-boost' | 'negative-only';

/**
 * Knob-state: user-set base + optional cable-modulering.
 * Reason-konvention: knob-position rör sig inte visuellt under modulation;
 * effective_value = base + signal × depth × hardware-range (clampad).
 */
export interface KnobState {
  /** User-set baseline i hardware-units (µs/¼ms/0..255). */
  readonly base: number;
  /** Cable-id som modulerar denna knob; null = static. */
  readonly modCableId: string | null;
}

/**
 * Low-frequency oscillator. Independent generator, can patch into multiple
 * knobs via cables. Phase är intern radians 0..2π, free-running.
 */
export interface LFO {
  readonly id: string;
  /** Frekvens i Hz, 0.01..50. rate=0 ger DC-output (ingen oscillation). */
  readonly rate: number;
  /** Master output gain 0..1. amount=0 silences LFOn helt. */
  readonly amount: number;
  readonly shape: WaveShape;
  /** Internal phase i radians, ackumulerar via dt × 2π × rate från phaseAnchorMicros. */
  readonly phase: number;
  /**
   * Tid (sim-µs) då phase var sant. computeLfoSignal beräknar effektiv phase som
   * `phase + 2π × rate × (now - phaseAnchorMicros) / 1M`. setLfoRate re-ankrar
   * vid rate-byte så signalen är continuous över bytet (annars phase-glitch).
   */
  readonly phaseAnchorMicros: number;
  /**
   * Polaritets-mode (default 'bipolar'). Asymmetrisk transform applicerad
   * efter waveform → ger boost-negative eller negative-only-modulering.
   * Optional för back-compat med pre-existing LFO-snapshots.
   */
  readonly mode?: WaveMode;
}

/** Hardware/UX bounds för LFO rate. Synkat med LFOModule.svelte RATE_BOUNDS. */
export const LFO_RATE_MIN_HZ = 0.01;
export const LFO_RATE_MAX_HZ = 50;

/**
 * Mixer channel — en per elcon-par. Tre knobs (pulse_width, pace, amplitude),
 * each kan ha en cable som modulerar.
 */
export interface MixerChannel {
  readonly id: string;
  /** [pos, neg] från patterns/types.ts. Disjunktums-rule applies (pos & neg === 0). */
  readonly elcon: Elcon;
  readonly knobs: {
    readonly pulseWidth: KnobState; // base 2..200µs (hardware bounds)
    readonly pace: KnobState; // base 5000..62500µs
    readonly amplitude: KnobState; // base 0..255
  };
  readonly enabled: boolean;
}

/**
 * Per-channel runtime-state som SynthEngine äger internt. Inte i MixerState
 * eftersom det inte är user-facing. SynthEngine map:ar channelId → runtime.
 */
export interface ChannelRuntime {
  /** Sim-time (µs) när nästa puls ska emit:as. */
  nextEmitMicros: number;
  /**
   * Senast emit:ade phase: 0 eller 1. Per eng-review 2.1A: alternates per emit
   * för att undvika DC-stim (säkerhetskritisk).
   */
  lastPhase: 0 | 1;
}

/**
 * Cable: directed edge från LFO output till mixer-channel knob.
 * Per eng-review 1.5A: en cable per knob i β.0; drop på upptaget = replace.
 */
export interface Cable {
  readonly id: string;
  readonly sourceLfoId: string;
  readonly destChannelId: string;
  readonly destKnobName: 'pulseWidth' | 'pace' | 'amplitude';
  /**
   * Per-cable depth 0..1 (Reason-style modulation amount knob på cable).
   * Multiplicerar med lfo.amount → två gain-stages. Per eng-review E6.
   */
  readonly depth: number;
}

/**
 * Top-level synth-state. UI-actions returnerar nya snapshots av denna.
 * Cascade-delete invariant (eng-review 2.4A): cables.every(c =>
 *   lfos.some(l => l.id === c.sourceLfoId) &&
 *   channels.some(ch => ch.id === c.destChannelId)
 * )
 */
export interface MixerState {
  readonly channels: readonly MixerChannel[];
  readonly lfos: readonly LFO[];
  readonly cables: readonly Cable[];
}

/**
 * Default knob-base-värden för reset (knob double-click per eng-review 1.4A).
 * Matchar α2 runner.ts default.
 */
export const KNOB_DEFAULTS = {
  pulseWidthMicros: 144,
  paceMicros: 25_000, // 25ms = Toggle pace
  amplitude: 128,
} as const;

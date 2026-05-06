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
 * Smooth phase-glide-state efter rate-change. När user vrider på rate
 * (LFO eller master) skapas en glide som decayar till 0 över glideDur.
 *
 * Modell: effectivePhase = freePhase(t, currentRate) + glideOffset(t).
 * Vid t = glideStart är glideOffset = offset (continuous med gamla raten).
 * Vid t = glideStart + glideDur är glideOffset = 0 (synkad med fri-fasen).
 *
 * Mellan dessa punkter linjär interpolation: glide = offset × (1 - progress).
 * När glide expirerar är LFO i deterministisk fri-fas — alla LFOs med samma
 * effective Hz är då i fas, oberoende av tidigare rate-byten.
 */
export interface PhaseGlide {
  /** Offset från fri-fas i radianer. Wrappad till kortaste väg ∈ [-π, π]. */
  readonly offset: number;
  /** Sim-tid (µs) då glide startade. */
  readonly glideStartMicros: number;
  /** Total glide-tid i µs. Default 1 sekund. */
  readonly glideDurMicros: number;
}

/**
 * Low-frequency oscillator. Independent generator, can patch into multiple
 * knobs via cables.
 *
 * Rate är **multiplier** mot synth.masterRate (Hz). Effektiv frekvens =
 * lfo.rate × master.masterRate. Default 1.0 = samma som master. Master
 * fungerar som DAW-style "tempo-knob" som drar alla LFOs synkront.
 *
 * Phase-modell: fri-fas (deterministisk vid t=0) + konstant user-offset
 * (lfo.phase) + decaying glide-offset från rate-change. Vid t=0 startar
 * alla LFOs på phase 0 (sine korsar uppåt) — predictable timing.
 */
export interface LFO {
  readonly id: string;
  /** Multiplier mot masterRate. Effective Hz = rate × masterRate. */
  readonly rate: number;
  /**
   * Vågformens swing-amplitud (0..1). amount=0 silences swing helt
   * (LFO blir ren DC vid volume). amount=1 = full swing inom headroom.
   */
  readonly amount: number;
  /**
   * Bias-position inom AMP-cap (0..1, default 0.5). Bestämmer vågformens
   * mittenlinje och därmed tillgängligt headroom mot AMP-fader-kanten.
   * volume=0.5 ger maximalt symmetric headroom (±cap/2 swing möjlig).
   * volume→0 eller →1 krymper headroom → swing-amplitud minskar
   * proportionellt så hela vågformen ALLTID ryms inom [0, AMP-cap]
   * (inget AMP-orsakat klipping av vågformen).
   *
   * Påverkar bara AMP-cables. PW/PACE-cables ignorerar volume (Reason-
   * style additive runt knob.base).
   */
  readonly volume: number;
  readonly shape: WaveShape;
  /** User-set konstant fas-offset (rad). Default 0. */
  readonly phase: number;
  /**
   * Optional smooth-glide efter rate-change. Konvergerar mot fri-fas så
   * signal är continuous initialt men deterministisk efter glideDur.
   */
  readonly phaseGlide?: PhaseGlide;
  /**
   * Polaritets-mode (default 'bipolar'). Asymmetrisk transform applicerad
   * efter waveform → ger boost-negative eller negative-only-modulering.
   */
  readonly mode?: WaveMode;
}

/** Bounds för LFO rate-multiplier. UI använder logaritmisk scale. */
export const LFO_RATE_MIN = 0.1;
export const LFO_RATE_MAX = 10;

/** Bounds för master-clock i Hz. Master * LFO-multiplier = effective Hz. */
export const MASTER_RATE_MIN_HZ = 0.05;
export const MASTER_RATE_MAX_HZ = 10;

/** Default glide-tid efter rate-change (µs). 1 sekund — smooth men inte trögt. */
export const PHASE_GLIDE_DURATION_MICROS = 1_000_000;

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
 * Trigger-mode för LfoChain — bestämmer hur chain förhåller sig till sin
 * source temporalt:
 *
 * - 'sync': chain spelar i fas med source, samma rate. Använd för layered
 *   modulation — kombinera source-rate med en annan vågform-shape på chain.
 * - 'offset': chain spelar samma rate men med 180° fas-skift. För symmetriska
 *   shapes (sine/triangle/square) ger detta matematisk invers av source.
 *   För saw ger det en time-shifted saw (fortfarande shape-bevarad).
 *   Båda källor spelar SAMTIDIGT, ingen tid-delning.
 * - 'alternate': chain GATED till source-negativa halvan — chain spelar
 *   bara när source.signal < 0, är tyst när source.signal ≥ 0. Ger äkta
 *   tid-delning ("alternerande känsla, ena vågen är klar → nästa startar").
 *   Chain effective rate = 2× source så chain hinner spela en hel cykel
 *   under source-negativa halvan. Funkar uniformt för alla shapes.
 */
export type ChainTrigger = 'sync' | 'offset' | 'alternate';

/**
 * LfoChain — slav-modulator vars phase följer en source-modulator
 * (LFO eller annan LfoChain). Har samma val som LFO (shape, mode,
 * amount) men ingen egen rate.
 *
 * Phase-modell: chain.phase = f(source.phase, trigger):
 *   - 'sync': chain.phase = source.phase
 *   - 'offset': chain.phase = source.phase + π (mod 2π)
 *   - 'alternate': chain.phase = 2 × source.phase (mod 2π), gated till
 *     källans negativa halva (computeChainSignal returnerar 0 när
 *     källans signal-värde ≥ 0).
 *
 * Eftersom chain läser källans `effectivePhase` (inkl glide) så ärvs
 * smooth-glide automatiskt vid rate-change.
 *
 * sourceId pekar på id för en LFO ('lfo-N') eller LfoChain ('chain-N').
 * Cycle detection vid addChain/setChainSource förhindrar self-ref + loops.
 */
export interface LfoChain {
  readonly id: string;
  /** Modulator-id (LFO eller annan LfoChain) som styr trigger-tempo. */
  readonly sourceId: string;
  /** När waveform-cykeln triggas relativt source-cykel. */
  readonly trigger: ChainTrigger;
  /** Vågformens swing-amplitud (0..1), samma semantik som LFO.amount. */
  readonly amount: number;
  /** Bias-position inom AMP-cap (0..1, default 0.5). Se LFO.volume. */
  readonly volume: number;
  readonly shape: WaveShape;
  /** Polaritets-mode (default 'bipolar'). */
  readonly mode?: WaveMode;
}

/** Modulator-union: LFO (har egen rate) eller LfoChain (rate från source). */
export type Modulator = LFO | LfoChain;

/** Type-guard för att skilja LfoChain från LFO. ID-prefix-baserat. */
export function isLfoChain(m: Modulator): m is LfoChain {
  return m.id.startsWith('chain-');
}

/**
 * Cable: directed edge från modulator (LFO eller LfoChain) output till
 * mixer-channel knob. Per eng-review 1.5A: en cable per knob i β.0;
 * drop på upptaget = replace.
 *
 * Fältnamnet sourceLfoId är historiskt — accepterar både 'lfo-N' och
 * 'chain-N' som modulator-id. Lookup via prefix eller array-search.
 */
export interface Cable {
  readonly id: string;
  /** ID för source-modulator (LFO eller LfoChain). */
  readonly sourceLfoId: string;
  readonly destChannelId: string;
  readonly destKnobName: 'pulseWidth' | 'pace' | 'amplitude';
  /**
   * Per-cable depth 0..1 (Reason-style modulation amount knob på cable).
   * Multiplicerar med modulator.amount → två gain-stages. Per eng-review E6.
   */
  readonly depth: number;
}

/**
 * Top-level synth-state. UI-actions returnerar nya snapshots av denna.
 * Cascade-delete invariant (eng-review 2.4A): cables.every(c =>
 *   (lfos.some(l => l.id === c.sourceLfoId) ||
 *    chains.some(ch => ch.id === c.sourceLfoId)) &&
 *   channels.some(ch => ch.id === c.destChannelId)
 * )
 * Plus: chains.every(c => c.sourceId resolves till existing LFO eller chain
 * utan loop).
 */
export interface MixerState {
  readonly channels: readonly MixerChannel[];
  readonly lfos: readonly LFO[];
  readonly chains: readonly LfoChain[];
  readonly cables: readonly Cable[];
  /**
   * Master-clock i Hz. Alla LFO-rates är multipliers av denna — fungerar
   * som DAW-style tempo-knob. Default 1.0 Hz. Range: 0.05..10.
   *
   * Phase-modell: vid t=0 är alla LFOs på phase 0. Vid rate-change (master
   * eller LFO) seedar mutators en PhaseGlide så signalen är continuous men
   * konvergerar mot fri-fas inom glideDur (default 1s).
   */
  readonly masterRate: number;
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

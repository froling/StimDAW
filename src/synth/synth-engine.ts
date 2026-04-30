/**
 * SynthEngine — event-driven per-channel scheduling som genererar PtDescriptors.
 *
 * Per eng-review 1.1A: använder Clock-interface för scheduling. Varje channel
 * schemalägger sin nästa emit via clock.scheduleAt(nextTime, () => emit()).
 * Ingen tick-loop, ingen idle-CPU, sample-perfekt timing.
 *
 * Per eng-review 2.1A (CRITICAL safety): per-channel polarity-flip per emit
 * undviker DC-stim. Channel håller `lastPhase` i ChannelRuntime, alternates
 * 0→1→0→1.
 *
 * Per eng-review 2.5A: generation-pattern för cancel utan event-cancel-API.
 * stop() bumpar generation. Schedule-callbacks captures generation vid
 * scheduling och no-op:ar vid mismatch — pending events från före stop läker
 * inte över i nästa session.
 *
 * Per eng-review 2.3A: amp-clamp via src/safety/clamp.ts (single chokepoint).
 *
 * Modul-boundary: SynthEngine läser MixerState via getState-funktion (passing
 * by reference inte snapshot — engine ser senaste user-edits live). Skickar
 * descriptors via sink-callback. State-mutationer går genom state.ts mutators
 * av callers; SynthEngine muterar bara sin egen ChannelRuntime-map.
 */
import type { Clock } from './clock';
import type { ChannelRuntime, KnobState, MixerState } from './types';
import { computeLfoSignal } from './lfo';
import { clampAmp } from '../safety/clamp';
import {
  PULSE_WIDTH_MIN_MICROS,
  PULSE_WIDTH_MAX_MICROS,
  PACE_MIN_MICROS,
  PACE_MAX_MICROS,
  AMPLITUDE_MAX,
} from '../protocol/hardware-bounds';
import type { PtDescriptor } from '../protocol/descriptor';

export interface SynthEngineOptions {
  /** Clock-impl: RealtimeClock i prod, TestClock i tester. */
  readonly clock: Clock;
  /** Returnerar senaste MixerState. Engine ser live edits utan stale-snapshot. */
  readonly getState: () => MixerState;
  /** Where descriptors go (e.g. NeoDKClient.writePtDescriptor). */
  readonly sink: (descriptor: PtDescriptor) => void;
  /** Ramp-controller-värde 0..100. */
  readonly getRampPercent: () => number;
  /** Max-ceiling-värde 0..100. */
  readonly getCeilingPercent: () => number;
}

export class SynthEngine {
  private running = false;
  /** Bumpas vid stop(). Schedule-callbacks captures vid scheduling; mismatch → no-op. */
  private generation = 0;
  private seqNr = 0;
  /** Per-channel runtime-state (lastPhase, nextEmitMicros). Inte i MixerState. */
  private runtime = new Map<string, ChannelRuntime>();

  constructor(private opts: SynthEngineOptions) {}

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Starta engine. Schemalägger initial emit för varje aktiv channel.
   * Idempotent — ingen effekt om redan running.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    const now = this.opts.clock.nowMicros();
    for (const ch of this.opts.getState().channels) {
      if (!ch.enabled) continue;
      this.runtime.set(ch.id, { nextEmitMicros: now, lastPhase: 1 });
      this.scheduleEmit(ch.id, now);
    }
  }

  /**
   * Stoppa engine. Pending scheduled events fire fortfarande men generation-
   * mismatch gör dem no-op. Idempotent.
   */
  stop(): void {
    this.running = false;
    this.generation++;
    this.runtime.clear();
  }

  /** Test-helper: kolla pending runtime-state per channel. */
  getChannelRuntime(channelId: string): ChannelRuntime | undefined {
    return this.runtime.get(channelId);
  }

  // ── Scheduling ──────────────────────────────────────────────────

  private scheduleEmit(channelId: string, atMicros: number): void {
    const generation = this.generation;
    this.opts.clock.scheduleAt(atMicros, () => {
      // Generation-pattern: detta event schemalades under en tidigare run-session,
      // skippa om stop() bumpat sedan dess.
      if (!this.running) return;
      if (generation !== this.generation) return;
      this.emit(channelId);
    });
  }

  private emit(channelId: string): void {
    const state = this.opts.getState();
    const ch = state.channels.find((c) => c.id === channelId);
    if (!ch || !ch.enabled) {
      // Channel borttagen eller disabled — sluta scheduling
      this.runtime.delete(channelId);
      return;
    }
    const runtime = this.runtime.get(channelId);
    if (!runtime) return;

    const tMicros = this.opts.clock.nowMicros();

    // Evaluate knob-värden (med ev. cable-modulation)
    const pwEffective = evaluateKnob(
      ch.knobs.pulseWidth,
      { min: PULSE_WIDTH_MIN_MICROS, max: PULSE_WIDTH_MAX_MICROS },
      tMicros,
      state,
    );
    const paceEffective = evaluateKnob(
      ch.knobs.pace,
      { min: PACE_MIN_MICROS, max: PACE_MAX_MICROS },
      tMicros,
      state,
    );
    const ampEffectiveRaw = evaluateKnob(
      ch.knobs.amplitude,
      { min: 0, max: AMPLITUDE_MAX },
      tMicros,
      state,
    );

    // Single chokepoint amp clamp via safety/clamp.ts
    const amp = clampAmp(
      ampEffectiveRaw,
      this.opts.getRampPercent(),
      this.opts.getCeilingPercent(),
    );

    // Per-channel polarity-flip (eng-review 2.1A — undviker DC-stim)
    const newPhase = (runtime.lastPhase ^ 1) as 0 | 1;
    runtime.lastPhase = newPhase;

    // Emit descriptor med nrOfPulses=1 (mixer-streaming-mode)
    const descriptor: PtDescriptor = {
      meta: 0,
      sequenceNumber: this.nextSeqNr(),
      phase: newPhase,
      pulseWidthMicros: Math.round(pwEffective),
      startTimeMicros: Math.floor(tMicros),
      electrodeSet: ch.elcon,
      nrOfPulses: 1,
      paceQuarterMs: Math.max(1, Math.round(paceEffective / 250)),
      amplitude: amp,
      deltaPulseWidthQuarters: 0,
      deltaPaceMicros: 0,
    };
    this.opts.sink(descriptor);

    // Schedule next emit at currentTime + effective_pace
    const nextEmit = tMicros + paceEffective;
    runtime.nextEmitMicros = nextEmit;
    this.scheduleEmit(channelId, nextEmit);
  }

  private nextSeqNr(): number {
    const s = this.seqNr;
    this.seqNr = (this.seqNr + 1) & 0xff;
    return s;
  }
}

/**
 * Evaluera knob-värde: base + signal × depth × range, sedan clamp.
 *
 * Reason-style modulation: knob.base är user-set (visuellt fixerad), LFO
 * oscillerar runt det. signal ∈ [-1, +1] mappat via depth × range / 2 →
 * effective ∈ [base - range/2 × depth, base + range/2 × depth], clampad.
 *
 * Pure function — testbar isolerat.
 */
export function evaluateKnob(
  knob: KnobState,
  bounds: { min: number; max: number },
  tMicros: number,
  state: MixerState,
): number {
  if (knob.modCableId === null) {
    return clamp(knob.base, bounds.min, bounds.max);
  }
  const cable = state.cables.find((c) => c.id === knob.modCableId);
  if (!cable) return clamp(knob.base, bounds.min, bounds.max);
  const lfo = state.lfos.find((l) => l.id === cable.sourceLfoId);
  if (!lfo) return clamp(knob.base, bounds.min, bounds.max);

  const signal = computeLfoSignal(lfo, tMicros); // -1..+1 × lfo.amount
  const range = bounds.max - bounds.min;
  const swing = signal * cable.depth * (range / 2);
  return clamp(knob.base + swing, bounds.min, bounds.max);
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

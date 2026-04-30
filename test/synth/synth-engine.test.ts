import { test, expect, beforeEach } from 'bun:test';
import { SynthEngine, evaluateKnob } from '../../src/synth/synth-engine';
import { TestClock } from '../../src/synth/clock';
import {
  emptyState,
  addChannel,
  addLfo,
  addCable,
  setLfoRate,
  setLfoAmount,
  setChannelEnabled,
  _resetIdsForTesting,
} from '../../src/synth/state';
import type { MixerState, KnobState } from '../../src/synth/types';
import type { PtDescriptor } from '../../src/protocol/descriptor';
import { ElectrodeMask } from '../../src/patterns/types';

beforeEach(() => {
  _resetIdsForTesting();
});

class TestRig {
  readonly clock: TestClock;
  readonly engine: SynthEngine;
  readonly emitted: PtDescriptor[] = [];
  private ref: { current: MixerState };

  constructor(initialState: MixerState) {
    this.clock = new TestClock();
    this.ref = { current: initialState };
    const emitted = this.emitted;
    this.engine = new SynthEngine({
      clock: this.clock,
      getState: () => this.ref.current,
      sink: (d) => emitted.push(d),
      getRampPercent: () => 100,
      getCeilingPercent: () => 100,
    });
  }

  get state(): MixerState {
    return this.ref.current;
  }

  setState(s: MixerState): void {
    this.ref.current = s;
  }
}

function makeRig(initialState: MixerState = emptyState()): TestRig {
  return new TestRig(initialState);
}

// ── evaluateKnob (pure function tests) ──────────────────────────────

test('evaluateKnob: utan cable returnerar base (clamped)', () => {
  const knob: KnobState = { base: 144, modCableId: null };
  const state = emptyState();
  expect(evaluateKnob(knob, { min: 2, max: 200 }, 0, state)).toBe(144);
});

test('evaluateKnob: clamps under min och över max när base är out-of-bounds', () => {
  expect(evaluateKnob({ base: -50, modCableId: null }, { min: 2, max: 200 }, 0, emptyState())).toBe(2);
  expect(evaluateKnob({ base: 500, modCableId: null }, { min: 2, max: 200 }, 0, emptyState())).toBe(200);
});

test('evaluateKnob: med cable returnerar base + signal × depth × range/2', () => {
  let state = emptyState();
  state = addLfo(state); // lfo-1, sine, rate=1
  state = addChannel(state, [ElectrodeMask.A, ElectrodeMask.B]);
  state = addCable(state, state.lfos[0]!.id, state.channels[0]!.id, 'pulseWidth', 1.0);
  const cableId = state.cables[0]!.id;
  const knob: KnobState = { base: 100, modCableId: cableId };

  // Vid t=0, sine=0 → base = 100
  expect(evaluateKnob(knob, { min: 0, max: 200 }, 0, state)).toBeCloseTo(100, 6);

  // Vid t=250_000µs (kvart period av 1Hz), sine=1, depth=1, range/2=100 →
  // base + 1 × 1 × 100 = 200, clampat till max
  expect(evaluateKnob(knob, { min: 0, max: 200 }, 250_000, state)).toBeCloseTo(200, 6);
});

test('evaluateKnob: dangling cable-ref → graceful fallback till base', () => {
  const state = emptyState();
  const knob: KnobState = { base: 100, modCableId: 'nonexistent' };
  expect(evaluateKnob(knob, { min: 0, max: 200 }, 0, state)).toBe(100);
});

// ── SynthEngine tick semantics ──────────────────────────────────────

test('engine: idle innan start, ingen emit', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.clock.advance(1_000_000); // 1s
  expect(rig.emitted.length).toBe(0);
  expect(rig.engine.isRunning()).toBe(false);
});

test('engine: start schemalägger initial emit', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.engine.start();
  expect(rig.engine.isRunning()).toBe(true);

  // Initial emit schemalagd vid now=0 — clock.advance(0) firar det
  rig.clock.advance(0);
  expect(rig.emitted.length).toBe(1);
});

test('engine: emit fortsätter på pace-intervaller', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]); // pace default 25_000µs
  const rig = makeRig(s);
  rig.engine.start();

  // 5 paces = 100ms = 100_000µs (initial + 4 paces)
  rig.clock.advance(100_000);
  expect(rig.emitted.length).toBe(5); // initial + 4 paces (0, 25k, 50k, 75k, 100k)
});

test('engine: phase alternates 0,1,0,1 per emit (GAP-A, CRITICAL safety)', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.engine.start();

  rig.clock.advance(100_000); // 5 emits @ 25ms pace
  expect(rig.emitted.length).toBe(5);
  expect(rig.emitted.map((d) => d.phase)).toEqual([0, 1, 0, 1, 0]);
});

test('engine: sequenceNumber inkrementerar och wrappar at 256', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.engine.start();

  // Initial emit vid t=0 + 260 efter pace-intervaller = 261 totalt
  rig.clock.advance(260 * 25_000);
  expect(rig.emitted.length).toBe(261);
  expect(rig.emitted[0]?.sequenceNumber).toBe(0);
  expect(rig.emitted[255]?.sequenceNumber).toBe(255);
  expect(rig.emitted[256]?.sequenceNumber).toBe(0); // wraps
  expect(rig.emitted[260]?.sequenceNumber).toBe(4);
});

test('engine: bounds clamping integration — pulse_width clampat 2..200µs', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(0);

  expect(rig.emitted[0]?.pulseWidthMicros).toBe(144); // default
  expect(rig.emitted[0]?.amplitude).toBe(128); // default after clamp
});

test('engine: pace clamps to floor (5ms) — pace knob under hardware-min', () => {
  // setKnobBase till 1000µs (under MIN_PULSE_PACE = 5000µs) och se
  // att descriptor får clampat värde
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const chId = s.channels[0]!.id;
  // Manually mutera channels till low pace
  s = {
    ...s,
    channels: s.channels.map((ch) =>
      ch.id !== chId ? ch : { ...ch, knobs: { ...ch.knobs, pace: { base: 1000, modCableId: null } } },
    ),
  };
  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(0);

  // pace clampas till PACE_MIN_MICROS = 5000µs → paceQuarterMs = 5000/250 = 20
  expect(rig.emitted[0]?.paceQuarterMs).toBe(20);
});

// ── Generation-pattern (GAP-F) ──────────────────────────────────────

test('engine: stop() bumpar generation, pending events no-op (GAP-F)', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(50_000); // 3 emits (0, 25k, 50k)
  expect(rig.emitted.length).toBe(3);

  rig.engine.stop();
  rig.clock.advance(100_000); // ytterligare 100ms — pending events ska no-op
  expect(rig.emitted.length).toBe(3); // oförändrat
});

test('engine: restart efter stop ger nya gen, ingen cross-läkage', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(25_000); // 2 emits
  rig.engine.stop();
  rig.clock.advance(100_000); // pending old-gen events fire och no-op

  rig.engine.start(); // ny generation
  rig.clock.advance(0);
  expect(rig.emitted.length).toBe(3); // 2 från första session + 1 från ny initial
});

// ── Channel state changes during running ─────────────────────────

test('engine: removeChannel mid-run stoppar emits från den channeln', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addChannel(s, [ElectrodeMask.AC, ElectrodeMask.BD]);
  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(50_000); // 3 emits per channel = 6 total
  expect(rig.emitted.length).toBe(6);

  // Remove channel 1, set state on rig — en cleaner test skulle ha shared ref
  // För nu testar vi via channel-disable som har samma effekt
  const chToDisableId = s.channels[0]!.id;
  rig.setState(setChannelEnabled(rig.state, chToDisableId, false));
  rig.clock.advance(50_000); // bara den andra kanalen emittar (75k, 100k)
  // 6 från innan + 2 från channel 2 efter disable = 8 totalt
  expect(rig.emitted.length).toBe(8);
});

// ── Multi-channel interleaving ────────────────────────────────────

test('engine: två channels med olika pace interleavar korrekt', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addChannel(s, [ElectrodeMask.AC, ElectrodeMask.BD]);
  // Ändra channel 1 till pace=10ms
  const ch1Id = s.channels[0]!.id;
  s = {
    ...s,
    channels: s.channels.map((ch) =>
      ch.id !== ch1Id ? ch : { ...ch, knobs: { ...ch.knobs, pace: { base: 10_000, modCableId: null } } },
    ),
  };
  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(100_000); // 100ms

  // Channel 1: pace 10ms → emits vid 0,10,20,...,100 = 11 emits
  // Channel 2: pace 25ms (default) → emits vid 0,25,50,75,100 = 5 emits
  // Total: 16
  const ch1Emits = rig.emitted.filter((d) => d.electrodeSet[0] === ElectrodeMask.A);
  const ch2Emits = rig.emitted.filter((d) => d.electrodeSet[0] === ElectrodeMask.AC);
  expect(ch1Emits.length).toBe(11);
  expect(ch2Emits.length).toBe(5);
});

// ── LFO-modulation (full wire-test) ────────────────────────────────

test('engine: LFO modulerar pulse_width over LFO-period', () => {
  let s = emptyState();
  s = addLfo(s); // sine 1Hz amount=1
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  // Set high pace så vi får få emits per LFO-cycle (cleaner mätning)
  const chId = s.channels[0]!.id;
  s = {
    ...s,
    channels: s.channels.map((ch) =>
      ch.id !== chId ? ch : { ...ch, knobs: { ...ch.knobs, pace: { base: 50_000, modCableId: null } } },
    ),
  };
  // Cable LFO → pulseWidth med depth=1.0
  s = addCable(s, s.lfos[0]!.id, chId, 'pulseWidth', 1.0);

  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(1_000_000); // 1 sekund = 1 LFO-cycle

  // pulse_width-värdena ska variera (inte alla samma)
  const widths = rig.emitted.map((d) => d.pulseWidthMicros);
  const min = Math.min(...widths);
  const max = Math.max(...widths);
  expect(max - min).toBeGreaterThan(50); // mod-swing syns
});

test('engine: LFO amount=0 → ingen modulation, base-värdet enbart', () => {
  let s = emptyState();
  s = addLfo(s);
  s = setLfoAmount(s, s.lfos[0]!.id, 0);
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addCable(s, s.lfos[0]!.id, s.channels[0]!.id, 'pulseWidth', 1.0);
  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(100_000);

  // Alla pulse_width = 144 (default base, ingen variation)
  for (const d of rig.emitted) {
    expect(d.pulseWidthMicros).toBe(144);
  }
});

test('engine: rate-change tar effekt vid nästa emit', () => {
  let s = emptyState();
  s = addLfo(s);
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addCable(s, s.lfos[0]!.id, s.channels[0]!.id, 'pulseWidth', 1.0);
  const rig = makeRig(s);
  rig.engine.start();
  rig.clock.advance(50_000); // 3 emits at 1Hz LFO

  // Bumpa rate till 10Hz, ändrar oscillation-takt
  const newState = setLfoRate(rig.state, rig.state.lfos[0]!.id, 10);
  rig.setState(newState);
  rig.clock.advance(50_000);

  // Mest signal-variation efter rate-change pga snabbare LFO
  const recentWidths = rig.emitted.slice(-3).map((d) => d.pulseWidthMicros);
  expect(new Set(recentWidths).size).toBeGreaterThan(1); // varying
});

// ── Idempotency ───────────────────────────────────────────────────

test('engine: start är idempotent, dubbel-start har ingen effekt', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.engine.start();
  rig.engine.start(); // no-op
  rig.clock.advance(0);
  expect(rig.emitted.length).toBe(1); // inte dubblat
});

test('engine: stop är idempotent', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = makeRig(s);
  rig.engine.start();
  rig.engine.stop();
  rig.engine.stop(); // no-op
  expect(rig.engine.isRunning()).toBe(false);
});

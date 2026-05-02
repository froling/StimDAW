/**
 * Mixer-flow integration test — end-to-end synth-engine + state + dispatch.
 *
 * Covers per BETA_MIXER eng-review:
 *   - GAP-B (CRITICAL safety): STOP-mid-flight drainar pending events,
 *     ingen late dispatch
 *   - Multi-channel olika pace interleavar korrekt
 *   - LFO modulerar pulse_width visibly över LFO-period
 *   - Cable-removal: knob reverts till base
 *   - Multi-LFO independence: rate-change på A påverkar inte cable B→C
 *
 * Test-rig: TestClock + pure-state + sink-spy. Inte wire-test (encode/decode
 * via NeoDKClient) — vi har redan mock-firmware-wire-test för det. Här
 * fokuserar vi på synth-stack-integration: state-mutators → engine.tick →
 * descriptors with correct values.
 */
import { test, expect, beforeEach } from 'bun:test';
import { SynthEngine } from '../../src/synth/synth-engine';
import { TestClock } from '../../src/synth/clock';
import {
  emptyState,
  addChannel,
  addLfo,
  addCable,
  removeCable,
  setLfoRate,
  setChannelEnabled,
  _resetIdsForTesting,
} from '../../src/synth/state';
import { computeLfoSignal } from '../../src/synth/lfo';
import type { MixerState } from '../../src/synth/types';
import type { PtDescriptor } from '../../src/protocol/descriptor';
import { ElectrodeMask } from '../../src/patterns/types';

beforeEach(() => {
  _resetIdsForTesting();
});

class MixerRig {
  readonly clock: TestClock;
  readonly engine: SynthEngine;
  readonly emitted: PtDescriptor[] = [];
  private ref: { current: MixerState };

  constructor(initial: MixerState) {
    this.clock = new TestClock();
    this.ref = { current: initial };
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

// ── GAP-B CRITICAL: STOP-mid-flight ────────────────────────────────

test('GAP-B CRITICAL: stopMixer drainar pending events, ingen late dispatch (safety)', () => {
  // Build state: 1 channel, default pace 25ms
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.C]);
  const rig = new MixerRig(s);

  // Start engine, kör 100ms (5 emits at 25ms pace incl initial vid 0)
  rig.engine.start();
  rig.clock.advance(100_000);
  expect(rig.emitted.length).toBe(5);

  // STOP mid-flight
  rig.engine.stop();
  expect(rig.engine.isRunning()).toBe(false);

  // Avancera klockan rejält förbi alla pending startTimes
  // Per 2.5A: pending events fire men generation-mismatch → no-op
  rig.clock.advance(1_000_000); // 1 sekund
  expect(rig.emitted.length).toBe(5); // INGEN late dispatch
});

test('GAP-B follow-up: restart efter stop ger ny generation, ingen cross-leak', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = new MixerRig(s);

  rig.engine.start();
  rig.clock.advance(50_000); // 3 emits
  rig.engine.stop();
  rig.clock.advance(500_000); // pending old-gen events fire, no-op

  expect(rig.emitted.length).toBe(3);

  // Restart — ny generation
  rig.engine.start();
  rig.clock.advance(0); // initial emit
  expect(rig.emitted.length).toBe(4);
});

// ── Multi-channel interleaving ─────────────────────────────────────

test('Multi-channel: olika pace ger interleaved emit-pattern', () => {
  let s = emptyState();
  // Channel 1: snabb 10ms pace
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const ch1Id = s.channels[0]!.id;
  s = {
    ...s,
    channels: s.channels.map((ch) =>
      ch.id !== ch1Id
        ? ch
        : { ...ch, knobs: { ...ch.knobs, pace: { base: 10_000, modCableId: null } } },
    ),
  };
  // Channel 2: long pace 50ms
  s = addChannel(s, [ElectrodeMask.C, ElectrodeMask.D]);
  const ch2Id = s.channels[1]!.id;
  s = {
    ...s,
    channels: s.channels.map((ch) =>
      ch.id !== ch2Id
        ? ch
        : { ...ch, knobs: { ...ch.knobs, pace: { base: 50_000, modCableId: null } } },
    ),
  };

  const rig = new MixerRig(s);
  rig.engine.start();
  rig.clock.advance(100_000); // 100ms

  // Channel 1: 0,10,20,30,...,100 = 11 emits
  // Channel 2: 0,50,100 = 3 emits
  // Total 14 (men race-conditions vid samma tid kan ge order-variation)
  const ch1Emits = rig.emitted.filter(
    (d) => d.electrodeSet[0] === ElectrodeMask.A && d.electrodeSet[1] === ElectrodeMask.B,
  );
  const ch2Emits = rig.emitted.filter(
    (d) => d.electrodeSet[0] === ElectrodeMask.C && d.electrodeSet[1] === ElectrodeMask.D,
  );
  expect(ch1Emits.length).toBe(11);
  expect(ch2Emits.length).toBe(3);
});

// ── LFO modulation full wire-test ──────────────────────────────────

test('LFO modulerar pulse_width över hela period', () => {
  let s = emptyState();
  s = addLfo(s); // sine 1Hz
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.C]);
  // High pace så vi får få samples per LFO-cycle (cleaner test-data)
  const chId = s.channels[0]!.id;
  s = {
    ...s,
    channels: s.channels.map((ch) =>
      ch.id !== chId
        ? ch
        : { ...ch, knobs: { ...ch.knobs, pace: { base: 50_000, modCableId: null } } },
    ),
  };
  s = addCable(s, s.lfos[0]!.id, chId, 'pulseWidth', 1.0);

  const rig = new MixerRig(s);
  rig.engine.start();
  rig.clock.advance(1_000_000); // 1 sek = 1 LFO-cycle

  const widths = rig.emitted.map((d) => d.pulseWidthMicros);
  const min = Math.min(...widths);
  const max = Math.max(...widths);
  // Med depth=1.0 och range 198µs (200-2), ska vi se signifikant swing
  expect(max - min).toBeGreaterThan(80);
});

// ── Cable removal reverts till base ────────────────────────────────

test('Cable removal: knob reverts till base-värde', () => {
  let s = emptyState();
  s = addLfo(s);
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.C]);
  s = addCable(s, s.lfos[0]!.id, s.channels[0]!.id, 'pulseWidth', 1.0);
  const cableId = s.cables[0]!.id;
  const rig = new MixerRig(s);

  rig.engine.start();
  rig.clock.advance(1_000_000); // 1 sek modulation
  const beforeRemoval = rig.emitted.length;

  // Ta bort cable mid-run
  rig.setState(removeCable(rig.state, cableId));
  rig.clock.advance(100_000); // additional emits

  // Senaste emits bör ha pulse_width === default (144µs)
  const afterRemoval = rig.emitted.slice(beforeRemoval);
  expect(afterRemoval.length).toBeGreaterThan(0);
  for (const d of afterRemoval) {
    expect(d.pulseWidthMicros).toBe(144);
  }
});

// ── Multi-LFO independence ─────────────────────────────────────────

test('Multi-LFO: rate-change på LFO A påverkar inte cable LFO B → channel C', () => {
  let s = emptyState();
  s = addLfo(s); // LFO A, 1Hz
  s = addLfo(s); // LFO B, 1Hz
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.C]); // ch C — only modulated by B
  const chId = s.channels[0]!.id;
  // High pace för cleaner data
  s = {
    ...s,
    channels: s.channels.map((ch) =>
      ch.id !== chId
        ? ch
        : { ...ch, knobs: { ...ch.knobs, pace: { base: 50_000, modCableId: null } } },
    ),
  };
  // Cable från LFO B (ej A) till channelns pulseWidth
  s = addCable(s, s.lfos[1]!.id, chId, 'pulseWidth', 1.0);

  const rig = new MixerRig(s);
  rig.engine.start();
  rig.clock.advance(500_000); // 500ms
  const beforeRateChange = rig.emitted.length;

  // Bumpa rate på LFO A (ENJ kabel) — ska inte påverka channel C
  rig.setState(setLfoRate(rig.state, rig.state.lfos[0]!.id, 50));
  rig.clock.advance(500_000); // ytterligare 500ms

  // Channel C-emits efter rate-change ska ha kontinuerlig sine-modulation
  // från LFO B (ej från LFO A som ändrade rate)
  const after = rig.emitted.slice(beforeRateChange);
  expect(after.length).toBeGreaterThan(5);
  // Verify pulse_width varierar (LFO B modulerar fortfarande)
  const widths = after.map((d) => d.pulseWidthMicros);
  const min = Math.min(...widths);
  const max = Math.max(...widths);
  expect(max - min).toBeGreaterThan(20);
});

// ── Per-channel phase-flip safety (GAP-A regression-skydd) ────────

test('GAP-A regression: per-channel phase-flip kvarstår vid multi-channel', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.C]);
  s = addChannel(s, [ElectrodeMask.B, ElectrodeMask.D]);
  const rig = new MixerRig(s);
  rig.engine.start();
  rig.clock.advance(100_000); // 4 emits per channel

  const ch1Phases = rig.emitted
    .filter((d) => d.electrodeSet[0] === ElectrodeMask.A)
    .map((d) => d.phase);
  const ch2Phases = rig.emitted
    .filter((d) => d.electrodeSet[0] === ElectrodeMask.B)
    .map((d) => d.phase);

  // Båda channels alternates 0,1,0,1 (per-channel state, inte global)
  expect(ch1Phases.slice(0, 4)).toEqual([0, 1, 0, 1]);
  expect(ch2Phases.slice(0, 4)).toEqual([0, 1, 0, 1]);
});

// ── Engine ticks utan channels (idle-safe) ─────────────────────────

test('Engine: start utan channels är no-op (no errors)', () => {
  const rig = new MixerRig(emptyState());
  rig.engine.start();
  rig.clock.advance(100_000);
  expect(rig.emitted.length).toBe(0);
  expect(rig.engine.isRunning()).toBe(true);
});

// ── Rate-change phase-continuity (regression for setLfoRate glitch) ──

test('setLfoRate re-ankrar phase: signal continuous över rate-bytet (no glitch)', () => {
  // Pure unit-test för bug-fixen: utan re-anchor skulle signal hoppa när
  // rate ändras eftersom dt-multiplikatorn bara byts. Med re-anchor förblir
  // sample-värdet vid rate-change-tidpunkten samma, sen oscillerar med ny rate.
  let s = emptyState();
  s = addLfo(s); // 1Hz, sine, phase=0, anchor=0
  const id = s.lfos[0]!.id;

  // Vid t=250_000µs (kvart-cykel @ 1Hz) ska sine vara +1
  const tChange = 250_000;
  const sigBefore = computeLfoSignal(s.lfos[0]!, tChange, s.lfos[0]!.phaseAnchorMicros);
  expect(sigBefore).toBeCloseTo(1, 6);

  // Re-anchor till t=tChange med ny rate 5Hz
  s = setLfoRate(s, id, 5, tChange);

  // Signalen vid EXAKT tChange (omedelbart efter rate-byte) ska vara samma som före
  // (continuity-krav: ingen diskontinuitet).
  const sigAfter = computeLfoSignal(s.lfos[0]!, tChange, s.lfos[0]!.phaseAnchorMicros);
  expect(sigAfter).toBeCloseTo(sigBefore, 6);

  // Och från och med tChange oscillerar den med 5Hz (ny rate). Vid en kvart
  // av 5Hz-period efter tChange (= 50_000µs senare = tChange + 50_000) ska
  // signalen vara nästan -1 (sin(π/2 + 2π·5·0.05) = sin(π/2 + π/2) = sin(π) ≈ 0).
  // Nej — sin(π/2 + π/2) = sin(π) = 0. OK testa det.
  const sigQuarterLater = computeLfoSignal(s.lfos[0]!, tChange + 50_000, s.lfos[0]!.phaseAnchorMicros);
  expect(sigQuarterLater).toBeCloseTo(0, 5);
});

test('setLfoRate UTAN simNow → phase NOT re-ankrad (legacy/test path)', () => {
  let s = emptyState();
  s = addLfo(s);
  const id = s.lfos[0]!.id;
  // Ingen simNow → bara rate-update, anchor förblir 0
  s = setLfoRate(s, id, 5);
  expect(s.lfos[0]?.phaseAnchorMicros).toBe(0);
});

// ── Re-enable channel mid-run (regression for runtime-leak fix) ─────

test('setChannelEnabled OFF→ON under run: ensureChannelScheduled re-startar emission', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const chId = s.channels[0]!.id;
  const rig = new MixerRig(s);

  rig.engine.start();
  rig.clock.advance(50_000); // 3 emits
  expect(rig.emitted.length).toBe(3);

  // Disable channel → emit() rensar runtime, inga fler emits
  rig.setState(setChannelEnabled(rig.state, chId, false));
  rig.clock.advance(50_000);
  expect(rig.emitted.length).toBe(3); // tystnad

  // Re-enable + ensureChannelScheduled (vad synth-store wrapper gör)
  rig.setState(setChannelEnabled(rig.state, chId, true));
  rig.engine.ensureChannelScheduled(chId);
  rig.clock.advance(50_000);
  // Emit:ar igen — minst 1 ny emit (initial schedule vid current time, sen pace)
  expect(rig.emitted.length).toBeGreaterThan(3);
});

test('ensureChannelScheduled: no-op om engine inte kör', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = new MixerRig(s);
  // Engine ej startad
  rig.engine.ensureChannelScheduled(s.channels[0]!.id);
  rig.clock.advance(100_000);
  expect(rig.emitted.length).toBe(0);
});

test('ensureChannelScheduled: idempotent — anropas på existing runtime gör inget', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const chId = s.channels[0]!.id;
  const rig = new MixerRig(s);
  rig.engine.start();
  rig.clock.advance(0); // initial emit
  expect(rig.emitted.length).toBe(1);

  // Re-call ska inte schedulera dubblet
  rig.engine.ensureChannelScheduled(chId);
  rig.clock.advance(25_000); // 1 pace
  expect(rig.emitted.length).toBe(2); // bara 1 nytt, inte 2
});

test('addChannel mid-run: ensureChannelScheduled startar emission för ny channel', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const rig = new MixerRig(s);
  rig.engine.start();
  rig.clock.advance(50_000);
  const beforeAdd = rig.emitted.length;

  // Lägg till ny channel mid-run
  s = addChannel(rig.state, [ElectrodeMask.C, ElectrodeMask.D]);
  rig.setState(s);
  const newCh = s.channels[s.channels.length - 1]!;
  rig.engine.ensureChannelScheduled(newCh.id);

  rig.clock.advance(50_000);
  const ch2Emits = rig.emitted
    .slice(beforeAdd)
    .filter((d) => d.electrodeSet[0] === ElectrodeMask.C);
  expect(ch2Emits.length).toBeGreaterThan(0);
});

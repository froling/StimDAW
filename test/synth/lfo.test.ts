import { test, expect } from 'bun:test';
import { applyLfoMode, computeLfoSignal, reAnchorPhase } from '../../src/synth/lfo';
import type { LFO } from '../../src/synth/types';

function makeLfo(overrides: Partial<LFO> = {}): LFO {
  return {
    id: 'lfo-1',
    rate: 1, // 1Hz
    amount: 1,
    shape: 'sine',
    phase: 0,
    phaseAnchorMicros: 0,
    ...overrides,
  };
}

test('computeLfoSignal: t=0, phase=0, sine → 0', () => {
  expect(computeLfoSignal(makeLfo(), 0)).toBeCloseTo(0, 10);
});

test('computeLfoSignal: 1Hz sine, kvart period (0.25s) → +1', () => {
  const lfo = makeLfo({ rate: 1, shape: 'sine' });
  // 0.25s = 250_000µs, period 1s → kvart cycle → π/2 → sin = +1
  expect(computeLfoSignal(lfo, 250_000)).toBeCloseTo(1, 6);
});

test('computeLfoSignal: 1Hz sine, halv period (0.5s) → 0', () => {
  const lfo = makeLfo({ rate: 1, shape: 'sine' });
  expect(computeLfoSignal(lfo, 500_000)).toBeCloseTo(0, 6);
});

test('computeLfoSignal: rate=2 dubblerar frekvens (period 0.5s)', () => {
  const lfo = makeLfo({ rate: 2 });
  // Vid 2Hz, kvart period = 0.125s = 125_000µs
  expect(computeLfoSignal(lfo, 125_000)).toBeCloseTo(1, 6);
});

test('computeLfoSignal: amount=0 silences helt', () => {
  expect(computeLfoSignal(makeLfo({ amount: 0 }), 250_000)).toBe(0);
});

test('computeLfoSignal: amount=0.5 dämpar med hälften', () => {
  const lfo = makeLfo({ amount: 0.5 });
  // sine vid t=0.25s = 1, × 0.5 = 0.5
  expect(computeLfoSignal(lfo, 250_000)).toBeCloseTo(0.5, 6);
});

test('computeLfoSignal: rate=0 (DC mode) — outputs bara phase-samplet, ingen progression', () => {
  // rate=0 betyder ingen phase-accumulation över tid
  const lfo = makeLfo({ rate: 0, phase: Math.PI / 2 });
  // sine(π/2) = 1, sample-konstant över tid
  expect(computeLfoSignal(lfo, 0)).toBeCloseTo(1, 6);
  expect(computeLfoSignal(lfo, 1_000_000)).toBeCloseTo(1, 6);
  expect(computeLfoSignal(lfo, 5_000_000)).toBeCloseTo(1, 6);
});

test('computeLfoSignal: rate=0 + phase=0 → 0 över tid (no NaN)', () => {
  const lfo = makeLfo({ rate: 0, phase: 0 });
  expect(computeLfoSignal(lfo, 0)).toBe(0);
  expect(computeLfoSignal(lfo, 1_000_000)).toBe(0);
});

test('computeLfoSignal: shape switching ger olika output', () => {
  // Sine vid t=0.125s med rate=1 → π/4 → sin = √2/2 ≈ 0.707
  const sine = computeLfoSignal(makeLfo({ shape: 'sine' }), 125_000);
  expect(sine).toBeCloseTo(Math.sin(Math.PI / 4), 6);

  // Square vid samma t → +1 (under första halvan)
  const square = computeLfoSignal(makeLfo({ shape: 'square' }), 125_000);
  expect(square).toBe(1);

  // Triangle vid t=0.125s → t-fraction = 0.125, < 0.25 → 4 × 0.125 = 0.5
  const tri = computeLfoSignal(makeLfo({ shape: 'triangle' }), 125_000);
  expect(tri).toBeCloseTo(0.5, 6);
});

test('computeLfoSignal: phaseAnchor justerar baseline', () => {
  const lfo = makeLfo({ rate: 1 });
  // utan anchor: t=250_000 → +1
  expect(computeLfoSignal(lfo, 250_000)).toBeCloseTo(1, 6);
  // med anchor=250_000 → effektiv dt=0 → 0
  expect(computeLfoSignal(lfo, 250_000, 250_000)).toBeCloseTo(0, 6);
});

test('computeLfoSignal: amount clamp till [0, 1]', () => {
  // amount > 1 ska clampas
  const overSat = computeLfoSignal(makeLfo({ amount: 5 }), 250_000);
  expect(overSat).toBeCloseTo(1, 6); // sine=1 × clamped(5)=1
  // amount < 0 ska behandlas som 0 (early return)
  const negative = computeLfoSignal(makeLfo({ amount: -0.5 }), 250_000);
  expect(negative).toBe(0);
});

test('reAnchorPhase: bevarar continuous phase vid rate-change', () => {
  const lfo = makeLfo({ rate: 1, phase: 0 });
  // Vid t=250_000 med rate=1, phase = 0 + 2π × 1 × 0.25 = π/2
  const reAnchored = reAnchorPhase(lfo, 250_000, 0);
  expect(reAnchored.phase).toBeCloseTo(Math.PI / 2, 6);

  // Sample vid samma t med phase=π/2 + dt=0 ska ge samma signal
  expect(computeLfoSignal(reAnchored, 250_000, 250_000)).toBeCloseTo(1, 6);
});

test('reAnchorPhase: wrappar phase till [0, 2π)', () => {
  const lfo = makeLfo({ rate: 1, phase: 0 });
  // 5 sekunder = 5 cycles vid 1Hz = 10π totalt phase
  const reAnchored = reAnchorPhase(lfo, 5_000_000, 0);
  expect(reAnchored.phase).toBeGreaterThanOrEqual(0);
  expect(reAnchored.phase).toBeLessThan(Math.PI * 2);
});

// ── applyLfoMode ────────────────────────────────────────────────────

test('applyLfoMode: bipolar (default) är identity', () => {
  expect(applyLfoMode(0.5, 'bipolar')).toBe(0.5);
  expect(applyLfoMode(-0.5, 'bipolar')).toBe(-0.5);
  expect(applyLfoMode(1, 'bipolar')).toBe(1);
  expect(applyLfoMode(-1, 'bipolar')).toBe(-1);
  expect(applyLfoMode(0, 'bipolar')).toBe(0);
});

test('applyLfoMode: undefined behandlas som bipolar (back-compat)', () => {
  expect(applyLfoMode(0.5, undefined)).toBe(0.5);
  expect(applyLfoMode(-0.7, undefined)).toBe(-0.7);
});

test('applyLfoMode: negative-boost dubblerar negativ halva, positiv oförändrad', () => {
  // Positiv halva: identity
  expect(applyLfoMode(0.5, 'negative-boost')).toBe(0.5);
  expect(applyLfoMode(1, 'negative-boost')).toBe(1);
  expect(applyLfoMode(0, 'negative-boost')).toBe(0);
  // Negativ halva: × 2
  expect(applyLfoMode(-0.5, 'negative-boost')).toBe(-1);
  expect(applyLfoMode(-1, 'negative-boost')).toBe(-2);
  expect(applyLfoMode(-0.001, 'negative-boost')).toBeCloseTo(-0.002, 6);
});

test('applyLfoMode: negative-only mappar [-1, +1] till [-1, 0] via (s-1)/2', () => {
  expect(applyLfoMode(1, 'negative-only')).toBe(0); // (1-1)/2 = 0
  expect(applyLfoMode(0, 'negative-only')).toBe(-0.5); // (0-1)/2 = -0.5
  expect(applyLfoMode(-1, 'negative-only')).toBe(-1); // (-1-1)/2 = -1
  expect(applyLfoMode(0.5, 'negative-only')).toBe(-0.25); // (0.5-1)/2 = -0.25
  expect(applyLfoMode(-0.5, 'negative-only')).toBe(-0.75); // (-0.5-1)/2 = -0.75
});

test('applyLfoMode: negative-only output alltid ≤ 0 oavsett input', () => {
  for (let i = -10; i <= 10; i++) {
    const input = i / 10;
    const output = applyLfoMode(input, 'negative-only');
    expect(output).toBeLessThanOrEqual(0);
  }
});

// ── computeLfoSignal med modes ──────────────────────────────────────

test('computeLfoSignal: bipolar (default) — sine kan nå ±1', () => {
  // sine vid t=0.25s @ 1Hz = π/2 → +1
  expect(computeLfoSignal(makeLfo(), 250_000)).toBeCloseTo(1, 6);
  // sine vid t=0.75s = 3π/2 → -1
  expect(computeLfoSignal(makeLfo(), 750_000)).toBeCloseTo(-1, 6);
});

test('computeLfoSignal: negative-boost — negativ halva räcker till -2', () => {
  const lfo = makeLfo({ mode: 'negative-boost' });
  // Positiv halva oförändrad
  expect(computeLfoSignal(lfo, 250_000)).toBeCloseTo(1, 6);
  // Negativ halva × 2
  expect(computeLfoSignal(lfo, 750_000)).toBeCloseTo(-2, 6);
});

test('computeLfoSignal: negative-only — output alltid ≤ 0', () => {
  const lfo = makeLfo({ mode: 'negative-only' });
  // Sine vid peak (skulle vara +1 i bipolar) → 0 i negative-only
  expect(computeLfoSignal(lfo, 250_000)).toBeCloseTo(0, 6);
  // Sine vid valley (skulle vara -1 i bipolar) → -1 i negative-only
  expect(computeLfoSignal(lfo, 750_000)).toBeCloseTo(-1, 6);
  // Sine vid noll (skulle vara 0 i bipolar) → -0.5 i negative-only
  expect(computeLfoSignal(lfo, 0)).toBeCloseTo(-0.5, 6);
});

test('computeLfoSignal: amount skalar EFTER mode-transform', () => {
  // negative-boost vid valley = -2, × amount=0.5 = -1
  const lfo = makeLfo({ mode: 'negative-boost', amount: 0.5 });
  expect(computeLfoSignal(lfo, 750_000)).toBeCloseTo(-1, 6);
});

import { test, expect } from 'bun:test';
import {
  applyLfoMode,
  computeLfoSignal,
  effectiveLfoPhase,
} from '../../src/synth/lfo';
import type { LFO } from '../../src/synth/types';

function makeLfo(overrides: Partial<LFO> = {}): LFO {
  return {
    id: 'lfo-1',
    rate: 1, // 1× multiplier — med masterRate=1 ger 1Hz
    amount: 1,
    volume: 0.5,
    shape: 'sine',
    phase: 0,
    ...overrides,
  };
}

// ── Fri-fas determinism (master = 1.0 default) ────────────────────────

test('computeLfoSignal: t=0, fri-fas → sine starts at 0 (uppåt-korsning)', () => {
  expect(computeLfoSignal(makeLfo(), 0)).toBeCloseTo(0, 10);
});

test('computeLfoSignal: 1Hz sine, kvart period (0.25s) → +1', () => {
  expect(computeLfoSignal(makeLfo(), 250_000)).toBeCloseTo(1, 6);
});

test('computeLfoSignal: 1Hz sine, halv period (0.5s) → 0', () => {
  expect(computeLfoSignal(makeLfo(), 500_000)).toBeCloseTo(0, 6);
});

test('computeLfoSignal: 1Hz sine, 3/4 period (0.75s) → -1', () => {
  expect(computeLfoSignal(makeLfo(), 750_000)).toBeCloseTo(-1, 6);
});

test('computeLfoSignal: rate=2 multiplier, master=1 → 2Hz effective (kvart 125ms)', () => {
  expect(computeLfoSignal(makeLfo({ rate: 2 }), 125_000, 1)).toBeCloseTo(1, 6);
});

test('computeLfoSignal: rate=1 multiplier, master=2 → 2Hz effective (kvart 125ms)', () => {
  expect(computeLfoSignal(makeLfo({ rate: 1 }), 125_000, 2)).toBeCloseTo(1, 6);
});

test('computeLfoSignal: rate × master = effective Hz (multiplikativ)', () => {
  // 0.5× × 4Hz = 2Hz effective. Kvart period vid 2Hz = 125ms
  expect(computeLfoSignal(makeLfo({ rate: 0.5 }), 125_000, 4)).toBeCloseTo(1, 6);
});

test('computeLfoSignal: amount=0 silences helt', () => {
  expect(computeLfoSignal(makeLfo({ amount: 0 }), 250_000)).toBe(0);
});

test('computeLfoSignal: amount=0.5 dämpar med hälften', () => {
  expect(computeLfoSignal(makeLfo({ amount: 0.5 }), 250_000)).toBeCloseTo(0.5, 6);
});

test('computeLfoSignal: rate=0 (DC mode) — fri-fas konstant 0 → sine(0) = 0', () => {
  const lfo = makeLfo({ rate: 0, phase: Math.PI / 2 });
  // phase är konstant offset → sine(0 + π/2) = 1 oavsett t
  expect(computeLfoSignal(lfo, 0)).toBeCloseTo(1, 6);
  expect(computeLfoSignal(lfo, 1_000_000)).toBeCloseTo(1, 6);
  expect(computeLfoSignal(lfo, 5_000_000)).toBeCloseTo(1, 6);
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

test('computeLfoSignal: konstant phase-offset shiftar trajectory', () => {
  // phase=π/2 → sine(0 + π/2) = 1 vid t=0
  expect(computeLfoSignal(makeLfo({ phase: Math.PI / 2 }), 0)).toBeCloseTo(1, 6);
  // phase=π/2 vid t=0.25s → sine(π/2 + π/2) = sine(π) = 0
  expect(computeLfoSignal(makeLfo({ phase: Math.PI / 2 }), 250_000)).toBeCloseTo(0, 6);
});

test('computeLfoSignal: amount clamp till [0, 1]', () => {
  expect(computeLfoSignal(makeLfo({ amount: 5 }), 250_000)).toBeCloseTo(1, 6);
  expect(computeLfoSignal(makeLfo({ amount: -0.5 }), 250_000)).toBe(0);
});

// ── PhaseGlide convergence ────────────────────────────────────────────

test('phaseGlide: vid t=glideStart är glide=offset (continuous med gamla rate)', () => {
  const lfo = makeLfo({
    rate: 2,
    phase: 0,
    phaseGlide: { offset: Math.PI / 4, glideStartMicros: 1_000_000, glideDurMicros: 1_000_000 },
  });
  // Vid t=glideStart: free_phase + offset (eftersom progress=0)
  // free_phase vid t=1s, rate=2 → 2π × 2 × 1 = 4π → wrap till 0
  // total = 0 + π/4 = π/4 → sine = √2/2
  const phase = effectiveLfoPhase(lfo, 1_000_000, 1);
  expect(phase).toBeCloseTo(Math.PI / 4, 6);
});

test('phaseGlide: vid t=glideStart+glideDur är glide=0 (synk med fri-fas)', () => {
  const lfo = makeLfo({
    rate: 2,
    phase: 0,
    phaseGlide: { offset: Math.PI / 4, glideStartMicros: 0, glideDurMicros: 1_000_000 },
  });
  // Vid t=1s: glide ska ha decayat till 0
  // free_phase vid t=1s, rate=2 → 4π → wrap till 0
  const phase = effectiveLfoPhase(lfo, 1_000_000, 1);
  expect(phase).toBeCloseTo(0, 6);
});

test('phaseGlide: vid t > glideStart+glideDur ignoreras glide-state', () => {
  const lfo = makeLfo({
    rate: 1,
    phaseGlide: { offset: Math.PI, glideStartMicros: 0, glideDurMicros: 1_000_000 },
  });
  // Långt efter glide: bara fri-fas
  const phase = effectiveLfoPhase(lfo, 5_000_000, 1);
  // free_phase vid t=5s, rate=1 → 10π → wrap till 0
  expect(phase).toBeCloseTo(0, 6);
});

test('phaseGlide: linjär decay vid halvvägs', () => {
  const lfo = makeLfo({
    rate: 0.001, // mycket långsam så fri-fas är ~0 över 1s
    phaseGlide: { offset: Math.PI, glideStartMicros: 0, glideDurMicros: 1_000_000 },
  });
  // Vid t=0.5s: progress=0.5, glide = π × (1 - 0.5) = π/2
  const phase = effectiveLfoPhase(lfo, 500_000, 1);
  expect(phase).toBeGreaterThan(Math.PI / 2 - 0.01);
  expect(phase).toBeLessThan(Math.PI / 2 + 0.01);
});

test('phaseGlide: ingen glide-state → fri-fas direkt', () => {
  const lfo = makeLfo({ rate: 1 }); // ingen phaseGlide
  expect(effectiveLfoPhase(lfo, 250_000, 1)).toBeCloseTo(Math.PI / 2, 6);
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
  expect(applyLfoMode(0.5, 'negative-boost')).toBe(0.5);
  expect(applyLfoMode(1, 'negative-boost')).toBe(1);
  expect(applyLfoMode(0, 'negative-boost')).toBe(0);
  expect(applyLfoMode(-0.5, 'negative-boost')).toBe(-1);
  expect(applyLfoMode(-1, 'negative-boost')).toBe(-2);
  expect(applyLfoMode(-0.001, 'negative-boost')).toBeCloseTo(-0.002, 6);
});

test('applyLfoMode: negative-only mappar [-1, +1] till [-1, 0] via (s-1)/2', () => {
  expect(applyLfoMode(1, 'negative-only')).toBe(0);
  expect(applyLfoMode(0, 'negative-only')).toBe(-0.5);
  expect(applyLfoMode(-1, 'negative-only')).toBe(-1);
  expect(applyLfoMode(0.5, 'negative-only')).toBe(-0.25);
  expect(applyLfoMode(-0.5, 'negative-only')).toBe(-0.75);
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
  expect(computeLfoSignal(makeLfo(), 250_000)).toBeCloseTo(1, 6);
  expect(computeLfoSignal(makeLfo(), 750_000)).toBeCloseTo(-1, 6);
});

test('computeLfoSignal: negative-boost — negativ halva räcker till -2', () => {
  const lfo = makeLfo({ mode: 'negative-boost' });
  expect(computeLfoSignal(lfo, 250_000)).toBeCloseTo(1, 6);
  expect(computeLfoSignal(lfo, 750_000)).toBeCloseTo(-2, 6);
});

test('computeLfoSignal: negative-only — output alltid ≤ 0', () => {
  const lfo = makeLfo({ mode: 'negative-only' });
  expect(computeLfoSignal(lfo, 250_000)).toBeCloseTo(0, 6);
  expect(computeLfoSignal(lfo, 750_000)).toBeCloseTo(-1, 6);
  expect(computeLfoSignal(lfo, 0)).toBeCloseTo(-0.5, 6);
});

test('computeLfoSignal: amount skalar EFTER mode-transform', () => {
  const lfo = makeLfo({ mode: 'negative-boost', amount: 0.5 });
  expect(computeLfoSignal(lfo, 750_000)).toBeCloseTo(-1, 6);
});

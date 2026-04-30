import { test, expect } from 'bun:test';
import { computeLfoSignal, reAnchorPhase } from '../../src/synth/lfo';
import type { LFO } from '../../src/synth/types';

function makeLfo(overrides: Partial<LFO> = {}): LFO {
  return {
    id: 'lfo-1',
    rate: 1, // 1Hz
    amount: 1,
    shape: 'sine',
    phase: 0,
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

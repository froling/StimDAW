import { test, expect } from 'bun:test';
import {
  meanPulseWidthMicros,
  meanPaceMicros,
  pulseWidthPercent,
  pacePercent,
  PULSE_WIDTH_MIN_MICROS,
  PULSE_WIDTH_MAX_MICROS,
  PACE_MIN_MICROS,
  PACE_MAX_MICROS,
} from '../../src/ui/descriptor-timing';
import type { PtDescriptor } from '../../src/protocol/descriptor';

function makeDescriptor(overrides: Partial<PtDescriptor> = {}): PtDescriptor {
  return {
    meta: 0,
    sequenceNumber: 0,
    phase: 0,
    pulseWidthMicros: 144,
    startTimeMicros: 0,
    electrodeSet: [0b0001, 0b0010],
    nrOfPulses: 1,
    paceQuarterMs: 0,
    amplitude: 128,
    deltaPulseWidthQuarters: 0,
    deltaPaceMicros: 0,
    ...overrides,
  };
}

test('meanPulseWidthMicros: nrOfPulses=1 → base value (DAW-streaming case)', () => {
  expect(meanPulseWidthMicros(makeDescriptor({ pulseWidthMicros: 144, nrOfPulses: 1 }))).toBe(144);
});

test('meanPulseWidthMicros: nrOfPulses>1, delta=0 → base value', () => {
  expect(
    meanPulseWidthMicros(makeDescriptor({ pulseWidthMicros: 144, nrOfPulses: 8 })),
  ).toBe(144);
});

test('meanPulseWidthMicros: positiv delta ramping → mean > base', () => {
  // base=100, N=8, delta=8 (quarter-µs/puls, så +2µs per puls)
  // pulses: 100, 102, 104, ..., 114
  // mean = (100 + 114) / 2 = 107
  // formel: 100 + (8-1)*8/8 = 100 + 7 = 107
  const d = makeDescriptor({
    pulseWidthMicros: 100,
    nrOfPulses: 8,
    deltaPulseWidthQuarters: 8,
  });
  expect(meanPulseWidthMicros(d)).toBe(107);
});

test('meanPulseWidthMicros: negativ delta ramping → mean < base', () => {
  // base=144, N=4, delta=-8 → mean = 144 + 3*(-8)/8 = 144 - 3 = 141
  const d = makeDescriptor({
    pulseWidthMicros: 144,
    nrOfPulses: 4,
    deltaPulseWidthQuarters: -8,
  });
  expect(meanPulseWidthMicros(d)).toBe(141);
});

test('meanPaceMicros: nrOfPulses=1 → base * 250 (paceQuarterMs → µs)', () => {
  // paceQuarterMs=100 → 25_000 µs = 25ms (Toggle pace)
  expect(meanPaceMicros(makeDescriptor({ paceQuarterMs: 100, nrOfPulses: 1 }))).toBe(25_000);
});

test('meanPaceMicros: positiv delta ramping → mean > base', () => {
  // base=25_000, N=4, delta=100 → mean = 25_000 + 3*100/2 = 25_150
  const d = makeDescriptor({
    paceQuarterMs: 100,
    nrOfPulses: 4,
    deltaPaceMicros: 100,
  });
  expect(meanPaceMicros(d)).toBe(25_150);
});

test('pulseWidthPercent: 0 → 0%', () => {
  expect(pulseWidthPercent(0)).toBe(0);
});

test('pulseWidthPercent: hardware-max (200µs) → 100%', () => {
  expect(pulseWidthPercent(PULSE_WIDTH_MAX_MICROS)).toBe(1);
});

test('pulseWidthPercent: 144µs (default) → 72%', () => {
  // 144 / 200 = 0.72
  expect(pulseWidthPercent(144)).toBeCloseTo(0.72, 3);
});

test('pulseWidthPercent: hardware-min 2µs → 1% (synligt)', () => {
  // 2 / 200 = 0.01
  expect(pulseWidthPercent(PULSE_WIDTH_MIN_MICROS)).toBeCloseTo(0.01, 3);
});

test('pulseWidthPercent: clamps negativa och över-max', () => {
  expect(pulseWidthPercent(-50)).toBe(0);
  expect(pulseWidthPercent(500)).toBe(1); // firmware clampar
});

test('pacePercent: 0 → 0%', () => {
  expect(pacePercent(0)).toBe(0);
});

test('pacePercent: hardware-max (62.5ms) → 100%', () => {
  expect(pacePercent(PACE_MAX_MICROS)).toBe(1);
});

test('pacePercent: Toggle 25ms → 40%', () => {
  // 25_000 / 62_500 = 0.4
  expect(pacePercent(25_000)).toBeCloseTo(0.4, 3);
});

test('pacePercent: Jackhammer 7ms → 11.2% (synligt, var 3.5% pre-fix)', () => {
  // 7_000 / 62_500 = 0.112
  expect(pacePercent(7_000)).toBeCloseTo(0.112, 3);
});

test('pacePercent: hardware-min 5ms → 8% (synligt)', () => {
  // 5_000 / 62_500 = 0.08
  expect(pacePercent(PACE_MIN_MICROS)).toBeCloseTo(0.08, 3);
});

test('pacePercent: clamps negativa och över-max', () => {
  expect(pacePercent(-1_000)).toBe(0);
  expect(pacePercent(100_000)).toBe(1);
});

test('pulseWidthPercent + pacePercent: NaN/Infinity → 0', () => {
  expect(pulseWidthPercent(NaN)).toBe(0);
  expect(pulseWidthPercent(Infinity)).toBe(0);
  expect(pacePercent(NaN)).toBe(0);
  expect(pacePercent(-Infinity)).toBe(0);
});

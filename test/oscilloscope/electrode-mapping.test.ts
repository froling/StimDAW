import { test, expect } from 'bun:test';
import { mapPulseToElectrodes } from '../../src/oscilloscope/electrode-mapping';
import type { FiredPulse } from '../../src/oscilloscope/types';
import { ElectrodeMask } from '../../src/patterns/types';

function makePulse(overrides: Partial<FiredPulse> = {}): FiredPulse {
  return {
    streamTimeMicros: 0,
    elcon: [ElectrodeMask.A, ElectrodeMask.B],
    phase: 0,
    pulseWidthMicros: 100,
    paceMicros: 10_000,
    descriptorAmplitude: 128, // ~50% av 255 → amp_norm ~0.502
    sourceDescriptorSeq: 7,
    pulseIdxInBurst: 0,
    ...overrides,
  };
}

test('elcon=[A, B] phase=0 → A:pos B:neg', () => {
  const pulse = makePulse();
  const result = mapPulseToElectrodes(pulse);
  expect(result).toHaveLength(2);
  const a = result.find((r) => r.bit === 1);
  const b = result.find((r) => r.bit === 2);
  expect(a?.rowPulse.polarity).toBe('pos');
  expect(b?.rowPulse.polarity).toBe('neg');
});

test('elcon=[A, B] phase=1 → A:neg B:pos (flipped)', () => {
  const pulse = makePulse({ phase: 1 });
  const result = mapPulseToElectrodes(pulse);
  expect(result).toHaveLength(2);
  const a = result.find((r) => r.bit === 1);
  const b = result.find((r) => r.bit === 2);
  expect(a?.rowPulse.polarity).toBe('neg');
  expect(b?.rowPulse.polarity).toBe('pos');
});

test('elcon=[AC, BD] phase=0 → A,C:pos B,D:neg', () => {
  const pulse = makePulse({
    elcon: [ElectrodeMask.A | ElectrodeMask.C, ElectrodeMask.B | ElectrodeMask.D],
  });
  const result = mapPulseToElectrodes(pulse);
  expect(result).toHaveLength(4);
  expect(result.find((r) => r.bit === 1)?.rowPulse.polarity).toBe('pos'); // A
  expect(result.find((r) => r.bit === 4)?.rowPulse.polarity).toBe('pos'); // C
  expect(result.find((r) => r.bit === 2)?.rowPulse.polarity).toBe('neg'); // B
  expect(result.find((r) => r.bit === 8)?.rowPulse.polarity).toBe('neg'); // D
});

test('elcon=[AC, BD] phase=1 → flipped (A,C:neg B,D:pos)', () => {
  const pulse = makePulse({
    elcon: [ElectrodeMask.A | ElectrodeMask.C, ElectrodeMask.B | ElectrodeMask.D],
    phase: 1,
  });
  const result = mapPulseToElectrodes(pulse);
  expect(result.find((r) => r.bit === 1)?.rowPulse.polarity).toBe('neg');
  expect(result.find((r) => r.bit === 4)?.rowPulse.polarity).toBe('neg');
  expect(result.find((r) => r.bit === 2)?.rowPulse.polarity).toBe('pos');
  expect(result.find((r) => r.bit === 8)?.rowPulse.polarity).toBe('pos');
});

test('elcon=[A, BD] (asymmetric) → A:pos B,D:neg, C inactive', () => {
  const pulse = makePulse({
    elcon: [ElectrodeMask.A, ElectrodeMask.B | ElectrodeMask.D],
  });
  const result = mapPulseToElectrodes(pulse);
  expect(result).toHaveLength(3);
  expect(result.find((r) => r.bit === 1)?.rowPulse.polarity).toBe('pos');
  expect(result.find((r) => r.bit === 2)?.rowPulse.polarity).toBe('neg');
  expect(result.find((r) => r.bit === 8)?.rowPulse.polarity).toBe('neg');
  expect(result.find((r) => r.bit === 4)).toBeUndefined(); // C inactive
});

test('phase ≥ 2 → reject (tom array, matchar firmware bsp:840)', () => {
  const pulse = makePulse({ phase: 2 as unknown as 0 | 1 });
  expect(mapPulseToElectrodes(pulse)).toEqual([]);
  const pulse3 = makePulse({ phase: 7 as unknown as 0 | 1 });
  expect(mapPulseToElectrodes(pulse3)).toEqual([]);
});

test('elcon=[0, 0] (no electrodes) → empty', () => {
  const pulse = makePulse({ elcon: [0, 0] });
  expect(mapPulseToElectrodes(pulse)).toEqual([]);
});

test('elcon med pos & neg overlap → reject (kortslutning)', () => {
  const pulse = makePulse({
    elcon: [ElectrodeMask.A | ElectrodeMask.B, ElectrodeMask.B | ElectrodeMask.C],
  });
  expect(mapPulseToElectrodes(pulse)).toEqual([]);
});

test('amplitudeNorm: 0..1 från descriptorAmplitude / 255', () => {
  const full = makePulse({ descriptorAmplitude: 255 });
  expect(mapPulseToElectrodes(full)[0]?.rowPulse.amplitudeNorm).toBeCloseTo(1.0, 5);

  const half = makePulse({ descriptorAmplitude: 128 });
  expect(mapPulseToElectrodes(half)[0]?.rowPulse.amplitudeNorm).toBeCloseTo(0.502, 2);

  const zero = makePulse({ descriptorAmplitude: 0 });
  expect(mapPulseToElectrodes(zero)[0]?.rowPulse.amplitudeNorm).toBe(0);
});

test('amplitudeNorm clampar till 0..1 för out-of-range input', () => {
  const over = makePulse({ descriptorAmplitude: 99_999 });
  expect(mapPulseToElectrodes(over)[0]?.rowPulse.amplitudeNorm).toBe(1);

  const neg = makePulse({ descriptorAmplitude: -100 });
  expect(mapPulseToElectrodes(neg)[0]?.rowPulse.amplitudeNorm).toBe(0);

  const nan = makePulse({ descriptorAmplitude: NaN });
  expect(mapPulseToElectrodes(nan)[0]?.rowPulse.amplitudeNorm).toBe(0);
});

test('rowPulse propagerar streamTime + pulseWidth + sourceSeq', () => {
  const pulse = makePulse({
    streamTimeMicros: 12_345,
    pulseWidthMicros: 87,
    sourceDescriptorSeq: 99,
  });
  const result = mapPulseToElectrodes(pulse);
  expect(result[0]?.rowPulse.streamTimeMicros).toBe(12_345);
  expect(result[0]?.rowPulse.pulseWidthMicros).toBe(87);
  expect(result[0]?.rowPulse.sourceDescriptorSeq).toBe(99);
});

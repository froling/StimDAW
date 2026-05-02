import { test, expect } from 'bun:test';
import { expandDescriptor } from '../../src/oscilloscope/expand';
import type { PtDescriptor } from '../../src/protocol/descriptor';
import { ElectrodeMask } from '../../src/patterns/types';

function makeDesc(overrides: Partial<PtDescriptor> = {}): PtDescriptor {
  return {
    meta: 0,
    sequenceNumber: 0,
    phase: 0,
    pulseWidthMicros: 50,
    startTimeMicros: 0,
    electrodeSet: [ElectrodeMask.A, ElectrodeMask.B],
    nrOfPulses: 1,
    paceQuarterMs: 40, // = 10ms
    amplitude: 200,
    deltaPulseWidthQuarters: 0,
    deltaPaceMicros: 0,
    ...overrides,
  };
}

test('expand: nr=1, no deltas → 1 puls med descriptor-värden', () => {
  const d = makeDesc({ pulseWidthMicros: 100, paceQuarterMs: 40 });
  const pulses = expandDescriptor(d, 0);
  expect(pulses).toHaveLength(1);
  expect(pulses[0]).toMatchObject({
    streamTimeMicros: 0,
    pulseWidthMicros: 100,
    paceMicros: 10_000, // 40 × 250
    phase: 0,
    pulseIdxInBurst: 0,
    descriptorAmplitude: 200, // wire-truth byte, not Vcap
  });
});

test('expand: nr=10, delta_pw=4 → pw evolverar 50→59.25µs', () => {
  // delta_pw = 4 ¼µs = 1µs per puls → pulse 0 = 50µs, pulse 9 = 59µs
  // Men eftersom basePw=50 + k×4 ¼µs = 200 ¼µs + k×4, /4 = 50 + k µs
  const d = makeDesc({
    nrOfPulses: 10,
    pulseWidthMicros: 50,
    deltaPulseWidthQuarters: 4,
  });
  const pulses = expandDescriptor(d, 0);
  expect(pulses).toHaveLength(10);
  expect(pulses[0]?.pulseWidthMicros).toBe(50);
  expect(pulses[1]?.pulseWidthMicros).toBe(51);
  expect(pulses[5]?.pulseWidthMicros).toBe(55);
  expect(pulses[9]?.pulseWidthMicros).toBe(59);
});

test('expand: nr=10, delta_pace=200 → pace evolverar, streamTime ackumulerar', () => {
  const d = makeDesc({
    nrOfPulses: 10,
    paceQuarterMs: 40, // 10000µs
    deltaPaceMicros: 200,
  });
  const pulses = expandDescriptor(d, 0);
  expect(pulses).toHaveLength(10);
  expect(pulses[0]?.paceMicros).toBe(10_000);
  expect(pulses[1]?.paceMicros).toBe(10_200);
  expect(pulses[9]?.paceMicros).toBe(11_800);
  // streamTime = sum av paces innan
  expect(pulses[0]?.streamTimeMicros).toBe(0);
  expect(pulses[1]?.streamTimeMicros).toBe(10_000);
  expect(pulses[2]?.streamTimeMicros).toBe(10_000 + 10_200);
  // Sanity: monotont stigande
  for (let i = 1; i < pulses.length; i++) {
    expect(pulses[i]!.streamTimeMicros).toBeGreaterThan(pulses[i - 1]!.streamTimeMicros);
  }
});

test('expand: dpw clampar till MAX_PULSE_WIDTH (200µs)', () => {
  // Start=190µs, dpw=4 ¼µs (=1µs/puls). Vid puls 11 = 201µs → clamp till 200.
  const d = makeDesc({
    nrOfPulses: 20,
    pulseWidthMicros: 190,
    deltaPulseWidthQuarters: 4,
  });
  const pulses = expandDescriptor(d, 0);
  expect(pulses[10]?.pulseWidthMicros).toBe(200); // 190 + 10 = 200, OK
  expect(pulses[11]?.pulseWidthMicros).toBe(200); // skulle bli 201, clampad
  expect(pulses[19]?.pulseWidthMicros).toBe(200); // alla efter clampade
});

test('expand: dpw clampar till MIN_PULSE_WIDTH (2µs)', () => {
  // Start=10µs, dpw=-4 ¼µs (=-1µs/puls). Vid puls 9 = 1µs → clamp till 2.
  const d = makeDesc({
    nrOfPulses: 15,
    pulseWidthMicros: 10,
    deltaPulseWidthQuarters: -4,
  });
  const pulses = expandDescriptor(d, 0);
  expect(pulses[8]?.pulseWidthMicros).toBe(2); // 10 - 8 = 2
  expect(pulses[10]?.pulseWidthMicros).toBe(2); // skulle bli 0, clampad
  expect(pulses[14]?.pulseWidthMicros).toBe(2);
});

test('expand: dpace clampar till MAX_PULSE_PACE (62500µs)', () => {
  // Start=60000µs, dpace=1000. Vid puls 3 = 63000 → clamp till 62500.
  const d = makeDesc({
    nrOfPulses: 5,
    paceQuarterMs: 240, // 60000µs
    deltaPaceMicros: 1000,
  });
  const pulses = expandDescriptor(d, 0);
  expect(pulses[0]?.paceMicros).toBe(60_000);
  expect(pulses[2]?.paceMicros).toBe(62_000);
  expect(pulses[3]?.paceMicros).toBe(62_500); // skulle bli 63000, clampad
  expect(pulses[4]?.paceMicros).toBe(62_500);
});

test('expand: nr=0 → tom array', () => {
  const d = makeDesc({ nrOfPulses: 0 });
  expect(expandDescriptor(d, 0)).toEqual([]);
});

test('expand: phase bit 0 isolated (phase byte med stage-bits ignoreras)', () => {
  // phase = 0b011 (stage=1, polarity=1) → vi tar bara bit 0
  const d = makeDesc({ phase: 0b011 });
  const pulses = expandDescriptor(d, 0);
  expect(pulses[0]?.phase).toBe(1);
});

test('expand: descriptorStreamTime offset propagerar', () => {
  const d = makeDesc({ nrOfPulses: 3, paceQuarterMs: 40 });
  const pulses = expandDescriptor(d, 5_000_000); // start vid 5s
  expect(pulses[0]?.streamTimeMicros).toBe(5_000_000);
  expect(pulses[1]?.streamTimeMicros).toBe(5_010_000);
  expect(pulses[2]?.streamTimeMicros).toBe(5_020_000);
});

test('expand: bevarar elcon + sourceDescriptorSeq', () => {
  const d = makeDesc({
    sequenceNumber: 42,
    electrodeSet: [ElectrodeMask.A | ElectrodeMask.C, ElectrodeMask.B | ElectrodeMask.D],
  });
  const pulses = expandDescriptor(d, 0);
  expect(pulses[0]?.elcon).toEqual([5, 10]); // AC, BD
  expect(pulses[0]?.sourceDescriptorSeq).toBe(42);
});

test('expand: nr=65535 (max u16) — no overflow, tar tid men producerar rätt antal', () => {
  const d = makeDesc({ nrOfPulses: 65535 });
  const pulses = expandDescriptor(d, 0);
  expect(pulses).toHaveLength(65535);
  // Alla pulses har samma pw eftersom delta=0
  expect(pulses[65534]?.pulseWidthMicros).toBe(50);
});

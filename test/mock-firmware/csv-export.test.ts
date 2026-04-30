import { test, expect } from 'bun:test';
import {
  dispatchedToPulses,
  exportDispatchedAsCsv,
} from '../../src/mock-firmware/csv-export';
import { parsePatterns312Csv } from '../../src/patterns/csv-format';
import type { DispatchedDescriptor } from '../../src/mock-firmware/firmware';
import type { PtDescriptor } from '../../src/protocol/descriptor';

function makeDescriptor(overrides: Partial<PtDescriptor> = {}): PtDescriptor {
  return {
    meta: 0,
    sequenceNumber: 1,
    phase: 0,
    pulseWidthMicros: 100,
    startTimeMicros: 1000,
    electrodeSet: [0b0001, 0b0010],
    nrOfPulses: 1,
    paceQuarterMs: 0,
    amplitude: 128,
    deltaPulseWidthQuarters: 0,
    deltaPaceMicros: 0,
    ...overrides,
  };
}

function makeDispatched(d: PtDescriptor, opts: { queueIdx?: 0 | 1 } = {}): DispatchedDescriptor {
  return {
    descriptor: d,
    dispatchedAtMicros: d.startTimeMicros,
    queueIdx: opts.queueIdx ?? ((d.phase & 0x01) as 0 | 1),
  };
}

test('dispatchedToPulses: 1-puls descriptor → 1 row', () => {
  const desc = makeDescriptor({ sequenceNumber: 5, startTimeMicros: 1234, phase: 1 });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  expect(pulses.length).toBe(1);
  expect(pulses[0]!.stage).toBe('A');
  expect(pulses[0]!.timestampMicros).toBe(1234);
  expect(pulses[0]!.phase).toBe(1);
  expect(pulses[0]!.widthMicros).toBe(100);
});

test('dispatchedToPulses: N-puls descriptor expanderar till N rows', () => {
  // 3 pulses, pace 1ms (paceQuarterMs=4 → 1000µs), startTime=0
  const desc = makeDescriptor({
    nrOfPulses: 3,
    paceQuarterMs: 4,
    startTimeMicros: 0,
    pulseWidthMicros: 50,
  });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  expect(pulses.length).toBe(3);
  expect(pulses[0]!.timestampMicros).toBe(0);
  expect(pulses[1]!.timestampMicros).toBe(1000);
  expect(pulses[2]!.timestampMicros).toBe(2000);
  expect(pulses.every((p) => p.widthMicros === 50)).toBe(true);
});

test('dispatchedToPulses: deltaPulseWidth ackumuleras per puls', () => {
  // pulse i width = base + ⌊i × delta / 4⌋, delta=4 → +1µs per pulse
  const desc = makeDescriptor({
    nrOfPulses: 4,
    paceQuarterMs: 4,
    pulseWidthMicros: 100,
    deltaPulseWidthQuarters: 4,
  });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  expect(pulses[0]!.widthMicros).toBe(100);
  expect(pulses[1]!.widthMicros).toBe(101);
  expect(pulses[2]!.widthMicros).toBe(102);
  expect(pulses[3]!.widthMicros).toBe(103);
});

test('dispatchedToPulses: deltaPaceMicros ackumuleras per puls', () => {
  // base pace 1000µs, delta -50µs per puls → pulse[i] = pulse[i-1] + (1000 + (i-1)*-50)
  // ts: 0, 0+1000=1000, 1000+(1000-50)=1950, 1950+(1000-100)=2850
  const desc = makeDescriptor({
    nrOfPulses: 4,
    paceQuarterMs: 4,
    startTimeMicros: 0,
    deltaPaceMicros: -50,
  });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  expect(pulses[0]!.timestampMicros).toBe(0);
  expect(pulses[1]!.timestampMicros).toBe(1000);
  expect(pulses[2]!.timestampMicros).toBe(1950);
  expect(pulses[3]!.timestampMicros).toBe(2850);
});

test('dispatchedToPulses: seqNr stiger globalt över multipla descriptors', () => {
  const d1 = makeDescriptor({ sequenceNumber: 100, nrOfPulses: 2, paceQuarterMs: 4 });
  const d2 = makeDescriptor({ sequenceNumber: 200, nrOfPulses: 3, paceQuarterMs: 4 });
  const pulses = dispatchedToPulses([makeDispatched(d1), makeDispatched(d2)]);
  expect(pulses.map((p) => p.seqNr)).toEqual([0, 1, 2, 3, 4]);
});

test('dispatchedToPulses: amplitude → vprimMv proxy (128 ≈ 1500mV)', () => {
  const desc = makeDescriptor({ amplitude: 128 });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  // 128/255 × 3000 ≈ 1505
  expect(pulses[0]!.vprimMv).toBeCloseTo(1505, -1);
});

test('exportDispatchedAsCsv: round-trip via parsePatterns312Csv', () => {
  const desc1 = makeDescriptor({
    sequenceNumber: 10,
    phase: 0,
    nrOfPulses: 2,
    paceQuarterMs: 4,
    pulseWidthMicros: 130,
    startTimeMicros: 5000,
    amplitude: 255,
  });
  const desc2 = makeDescriptor({
    sequenceNumber: 11,
    phase: 1,
    nrOfPulses: 2,
    paceQuarterMs: 4,
    pulseWidthMicros: 145,
    startTimeMicros: 5200,
    amplitude: 200,
  });
  const csv = exportDispatchedAsCsv([makeDispatched(desc1), makeDispatched(desc2)]);
  const parsed = parsePatterns312Csv(csv);
  expect(parsed.length).toBe(4);
  expect(parsed[0]!.phase).toBe(0);
  expect(parsed[2]!.phase).toBe(1);
  expect(parsed[0]!.timestampMicros).toBe(5000);
  expect(parsed[2]!.timestampMicros).toBe(5200);
});

test('exportDispatchedAsCsv: tom input → bara header (utan Electrodes)', () => {
  const csv = exportDispatchedAsCsv([]);
  // Tom input → ingen Electrodes-kolumn (back-compat header)
  expect(csv).toBe('"Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]"\n');
});

test('dispatchedToPulses: forward-polaritet → "A>B"', () => {
  const desc = makeDescriptor({
    electrodeSet: [0b0001, 0b0010], // pos=A, neg=B
  });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  expect(pulses[0]!.electrodes).toBe('A>B');
});

test('dispatchedToPulses: reverse-polaritet → "A<B"', () => {
  const desc = makeDescriptor({
    electrodeSet: [0b0010, 0b0001], // pos=B, neg=A
  });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  expect(pulses[0]!.electrodes).toBe('A<B');
});

test('dispatchedToPulses: multi-elektrod AC>BD', () => {
  const desc = makeDescriptor({
    electrodeSet: [0b0101, 0b1010], // pos=AC, neg=BD
  });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  expect(pulses[0]!.electrodes).toBe('AC>BD');
});

test('dispatchedToPulses: alla pulser i samma descriptor delar electrodes-label', () => {
  const desc = makeDescriptor({
    nrOfPulses: 4,
    paceQuarterMs: 4,
    electrodeSet: [0b1010, 0b0101], // pos=BD, neg=AC → reverse
  });
  const pulses = dispatchedToPulses([makeDispatched(desc)]);
  expect(pulses.every((p) => p.electrodes === 'AC<BD')).toBe(true);
});

test('exportDispatchedAsCsv: NeoDK-export inkluderar Electrodes-kolumn', () => {
  const desc = makeDescriptor({ electrodeSet: [0b0001, 0b0010] });
  const csv = exportDispatchedAsCsv([makeDispatched(desc)]);
  expect(csv).toContain('"Electrodes"');
  expect(csv).toContain(',A>B');
});

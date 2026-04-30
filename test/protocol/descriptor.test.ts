import { test, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
  DescriptorDecodeError,
  DescriptorEncodeError,
  decodeDescriptor,
  encodeDescriptor,
  type PtDescriptor,
} from '../../src/protocol/descriptor';

const baseDescriptor: PtDescriptor = {
  meta: 0,
  sequenceNumber: 42,
  phase: 0,
  pulseWidthMicros: 144,
  startTimeMicros: 100_000,
  electrodeSet: [1, 2], // A↔B
  nrOfPulses: 4,
  paceQuarterMs: 100,
  amplitude: 128,
  deltaPulseWidthQuarters: 0,
  deltaPaceMicros: 0,
};

test('encode: full descriptor 16 bytes when all deltas non-zero', () => {
  const d = { ...baseDescriptor, deltaPaceMicros: 5 };
  expect(encodeDescriptor(d).length).toBe(16);
});

test('encode: omit dp → 15 bytes when deltaPaceMicros == 0', () => {
  const d = { ...baseDescriptor, deltaPulseWidthQuarters: 3, deltaPaceMicros: 0 };
  expect(encodeDescriptor(d).length).toBe(15);
});

test('encode: omit dp+dpw → 14 bytes when both deltas == 0 and amp != 0', () => {
  const d = { ...baseDescriptor, amplitude: 100 };
  expect(encodeDescriptor(d).length).toBe(14);
});

test('encode: omit amp+dp+dpw → 13 bytes when amp == 0 and nr != 1', () => {
  const d = { ...baseDescriptor, amplitude: 0, nrOfPulses: 4 };
  expect(encodeDescriptor(d).length).toBe(13);
});

test('encode: omit nr+pace+amp+deltas → 10 bytes when nr == 1 and amp == 0', () => {
  const d = { ...baseDescriptor, nrOfPulses: 1, amplitude: 0 };
  expect(encodeDescriptor(d).length).toBe(10);
});

test('encode: minimal 10-byte preserves required fields', () => {
  const d = { ...baseDescriptor, nrOfPulses: 1, amplitude: 0 };
  const buf = encodeDescriptor(d);
  expect(buf[0]).toBe(0); // meta
  expect(buf[1]).toBe(42); // seq
  expect(buf[3]).toBe(144); // pw
  expect(buf[4]).toBe(0xa0); // start_time low byte (100000 & 0xff = 0xa0)
  expect(buf[8]).toBe(1); // pos
  expect(buf[9]).toBe(2); // neg
});

test('encode + decode round-trip preserves all fields (size 16)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 255 }), // seq
      fc.integer({ min: 0, max: 200 }), // pw
      fc.integer({ min: 0, max: 0xffffff }), // startTime (limited for safety)
      fc.integer({ min: 1, max: 65535 }), // nr
      fc.integer({ min: 0, max: 255 }), // pace
      fc.integer({ min: 0, max: 255 }), // amp
      fc.integer({ min: -128, max: 127 }), // dpw
      fc.integer({ min: -128, max: 127 }).filter((v) => v !== 0), // dp non-zero so size=16
      (seq, pw, startTime, nr, pace, amp, dpw, dp) => {
        const d: PtDescriptor = {
          meta: 0,
          sequenceNumber: seq,
          phase: 0,
          pulseWidthMicros: pw,
          startTimeMicros: startTime,
          electrodeSet: [1, 2],
          nrOfPulses: nr,
          paceQuarterMs: pace,
          amplitude: amp,
          deltaPulseWidthQuarters: dpw,
          deltaPaceMicros: dp,
        };
        const decoded = decodeDescriptor(encodeDescriptor(d));
        expect(decoded).toEqual(d);
      },
    ),
    { numRuns: 100 },
  );
});

test('decode: defaults för omitted fields', () => {
  const minimal: PtDescriptor = {
    meta: 0,
    sequenceNumber: 1,
    phase: 0,
    pulseWidthMicros: 100,
    startTimeMicros: 1000,
    electrodeSet: [1, 2],
    nrOfPulses: 1,
    paceQuarterMs: 0,
    amplitude: 0,
    deltaPulseWidthQuarters: 0,
    deltaPaceMicros: 0,
  };
  const buf = encodeDescriptor(minimal);
  expect(buf.length).toBe(10);
  const decoded = decodeDescriptor(buf);
  expect(decoded.nrOfPulses).toBe(1);
  expect(decoded.amplitude).toBe(0);
  expect(decoded.deltaPaceMicros).toBe(0);
});

test('encode: throws på meta != 0', () => {
  expect(() => encodeDescriptor({ ...baseDescriptor, meta: 1 })).toThrow(
    DescriptorEncodeError,
  );
});

test('encode: throws på pulse_width > 200', () => {
  expect(() => encodeDescriptor({ ...baseDescriptor, pulseWidthMicros: 250 })).toThrow();
});

test('encode: throws på electrodeSet shortage (pos & neg != 0)', () => {
  expect(() => encodeDescriptor({ ...baseDescriptor, electrodeSet: [5, 7] })).toThrow(
    /Short circuit/,
  );
});

test('encode: throws på nrOfPulses 0 eller > 65535', () => {
  expect(() => encodeDescriptor({ ...baseDescriptor, nrOfPulses: 0 })).toThrow();
  expect(() => encodeDescriptor({ ...baseDescriptor, nrOfPulses: 70_000 })).toThrow();
});

test('decode: throws på invalid size', () => {
  expect(() => decodeDescriptor(new Uint8Array(8))).toThrow(DescriptorDecodeError);
  expect(() => decodeDescriptor(new Uint8Array(11))).toThrow(DescriptorDecodeError);
  expect(() => decodeDescriptor(new Uint8Array(17))).toThrow(DescriptorDecodeError);
});

test('decode: throws på meta != 0x00', () => {
  const buf = encodeDescriptor({ ...baseDescriptor });
  buf[0] = 0xff;
  expect(() => decodeDescriptor(buf)).toThrow(DescriptorDecodeError);
});

test('signed delta encoding: negative values round-trip', () => {
  const d: PtDescriptor = {
    ...baseDescriptor,
    deltaPulseWidthQuarters: -5,
    deltaPaceMicros: -10,
  };
  const decoded = decodeDescriptor(encodeDescriptor(d));
  expect(decoded.deltaPulseWidthQuarters).toBe(-5);
  expect(decoded.deltaPaceMicros).toBe(-10);
});

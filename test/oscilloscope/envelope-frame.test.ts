import { test, expect } from 'bun:test';
import { buildEnvelopeFrame } from '../../src/oscilloscope/envelope-frame';
import type { DispatchedDescriptor } from '../../src/mock-firmware/firmware';
import type { PtDescriptor } from '../../src/protocol/descriptor';
import { ElectrodeMask } from '../../src/patterns/types';

function makeDispatch(overrides: Partial<PtDescriptor> = {}, dispatchedAtMicros = 0): DispatchedDescriptor {
  return {
    descriptor: {
      meta: 0,
      sequenceNumber: 0,
      phase: 0,
      pulseWidthMicros: 100,
      startTimeMicros: 0,
      electrodeSet: [ElectrodeMask.A, ElectrodeMask.B],
      nrOfPulses: 1,
      paceQuarterMs: 40,
      amplitude: 200,
      deltaPulseWidthQuarters: 0,
      deltaPaceMicros: 0,
      ...overrides,
    },
    dispatchedAtMicros,
    queueIdx: ((overrides.phase ?? 0) & 1) as 0 | 1,
  };
}

test('buildEnvelopeFrame: null origin → tomma rader', () => {
  const f = buildEnvelopeFrame({
    dispatched: [],
    voltageHistory: [],
    streamOriginMicros: null,
    streamOriginWallMicros: null,
    streamNowMicros: 0,
  });
  expect(f.rows).toHaveLength(4);
  for (const row of f.rows) {
    for (const bin of row.bins) {
      expect(bin.ampNorm).toBe(0);
      expect(bin.pwNorm).toBe(0);
      expect(bin.pulseCount).toBe(0);
    }
  }
});

test('buildEnvelopeFrame: 4 rader oavsett input', () => {
  const f = buildEnvelopeFrame({
    dispatched: [],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 1_000_000,
  });
  expect(f.rows.map((r) => r.electrode)).toEqual(['A', 'B', 'C', 'D']);
});

test('buildEnvelopeFrame: enskild puls → bin med ampNorm > 0 på rätt rader', () => {
  const f = buildEnvelopeFrame({
    dispatched: [makeDispatch({ electrodeSet: [ElectrodeMask.A, ElectrodeMask.B] }, 0)],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 10_000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  // A och B ska ha någon bin med activity (ampNorm > 0)
  const aHasActivity = f.rows.find((r) => r.electrode === 'A')?.bins.some((b) => b.ampNorm > 0);
  const bHasActivity = f.rows.find((r) => r.electrode === 'B')?.bins.some((b) => b.ampNorm > 0);
  const cHasActivity = f.rows.find((r) => r.electrode === 'C')?.bins.some((b) => b.ampNorm > 0);
  expect(aHasActivity).toBe(true);
  expect(bHasActivity).toBe(true);
  expect(cHasActivity).toBe(false);
});

test('buildEnvelopeFrame: ampNorm = peak amp per bin (oavsett polaritet)', () => {
  const f = buildEnvelopeFrame({
    dispatched: [makeDispatch({ electrodeSet: [ElectrodeMask.A, ElectrodeMask.B], phase: 0, amplitude: 255 }, 0)],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 10_200, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  const aBin = f.rows.find((r) => r.electrode === 'A')?.bins.find((b) => b.ampNorm > 0);
  const bBin = f.rows.find((r) => r.electrode === 'B')?.bins.find((b) => b.ampNorm > 0);
  // Båda har full amp (descriptor.amplitude=255 → wire-truth full scale) — INGEN polaritets-distinktion
  expect(aBin?.ampNorm).toBeCloseTo(1.0, 2);
  expect(bBin?.ampNorm).toBeCloseTo(1.0, 2);
});

test('buildEnvelopeFrame: pwNorm = average pulse_width per bin', () => {
  const f = buildEnvelopeFrame({
    dispatched: [makeDispatch({ pulseWidthMicros: 100, electrodeSet: [ElectrodeMask.A, ElectrodeMask.B] }, 0)],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 5000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  const aBin = f.rows.find((r) => r.electrode === 'A')?.bins.find((b) => b.pulseCount > 0);
  // pwNorm = (100-2)/198 ≈ 0.495
  expect(aBin?.pwNorm).toBeCloseTo(0.495, 2);
});

test('buildEnvelopeFrame: bin-duration-konfig respekteras', () => {
  const f = buildEnvelopeFrame({
    dispatched: [],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 1_000_000,
    windowMicros: 1_000_000,
    binDurationMicros: 100_000, // 100ms bins
  });
  // 1s window / 100ms bins = 10 bins
  expect(f.rows[0]?.bins).toHaveLength(10);
});

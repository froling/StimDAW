import { test, expect } from 'bun:test';
import { buildPolarFrame } from '../../src/oscilloscope/polar-frame';
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

test('buildPolarFrame: null origin → tom array', () => {
  const f = buildPolarFrame({
    dispatched: [],
    voltageHistory: [],
    streamOriginMicros: null,
    streamOriginWallMicros: null,
    streamNowMicros: 0,
  });
  expect(f.arcs).toEqual([]);
});

test('buildPolarFrame: A↔B phase=0 → arc från A till B', () => {
  const f = buildPolarFrame({
    dispatched: [makeDispatch({ electrodeSet: [ElectrodeMask.A, ElectrodeMask.B] }, 0)],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  expect(f.arcs).toHaveLength(1);
  expect(f.arcs[0]?.electrodeA).toBe('A');
  expect(f.arcs[0]?.electrodeB).toBe('B');
});

test('buildPolarFrame: phase påverkar INTE arc-orientering (polariteten är safety)', () => {
  // Båda phases producerar samma odirigerade (A, B)-arc — biphasic är safety,
  // inte experience.
  const f = buildPolarFrame({
    dispatched: [makeDispatch({ electrodeSet: [ElectrodeMask.A, ElectrodeMask.B], phase: 1 }, 0)],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  expect(f.arcs).toHaveLength(1);
  expect(f.arcs[0]?.electrodeA).toBe('A');
  expect(f.arcs[0]?.electrodeB).toBe('B');
});

test('buildPolarFrame: AC↔BD phase=0 → 4 arcs (varje T+×T- combination)', () => {
  const f = buildPolarFrame({
    dispatched: [makeDispatch({
      electrodeSet: [ElectrodeMask.A | ElectrodeMask.C, ElectrodeMask.B | ElectrodeMask.D],
    }, 0)],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  expect(f.arcs).toHaveLength(4); // A→B, A→D, C→B, C→D
  const pairs = f.arcs.map((a) => `${a.electrodeA}-${a.electrodeB}`).sort();
  expect(pairs).toEqual(['A-B', 'A-D', 'C-B', 'C-D']);
});

test('buildPolarFrame: ageFade kvadratisk — recent pulse near 1, old near 0', () => {
  const f = buildPolarFrame({
    dispatched: [
      makeDispatch({ sequenceNumber: 1, startTimeMicros: 0 }, 0),
      makeDispatch({ sequenceNumber: 2, startTimeMicros: 900_000 }, 900_000),
    ],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 1_000_000,
    windowMicros: 1_000_000,
  });
  expect(f.arcs).toHaveLength(2);
  // Recent (age=100_000): linear=0.9, kvadratisk=0.81
  // Old (age=1_000_000): linear=0, kvadratisk=0
  const recent = f.arcs.find((a) => a.sourceDescriptorSeq === 2);
  const old = f.arcs.find((a) => a.sourceDescriptorSeq === 1);
  expect(recent?.ageFade).toBeGreaterThan(0.7); // 0.81 with quadratic
  expect(old?.ageFade).toBeLessThan(0.05);
});

test('buildPolarFrame: arcs — pulser bortom ARC_FADE_MICROS skippas', () => {
  // ARC_FADE_MICROS = 1_000_000 (hard-coded). Pulser >1s gamla ska INTE
  // pushas som arcs, även om de fortfarande är inom det större 6s-fönstret.
  // Detta ger snabb visuell fade-out när pattern stoppar; envelope-panelen
  // behåller fortfarande sina 6s historik separat.
  const f = buildPolarFrame({
    dispatched: [
      makeDispatch({ sequenceNumber: 1, startTimeMicros: 0 }, 0),               // age=2s → skip
      makeDispatch({ sequenceNumber: 2, startTimeMicros: 1_500_000 }, 1_500_000), // age=500ms → keep
    ],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 2_000_000,
    // windowMicros default 6s — descriptor-buffern tillåter båda
  });
  expect(f.arcs).toHaveLength(1);
  expect(f.arcs[0]?.sourceDescriptorSeq).toBe(2);
  // Mid-fade arc: age=500ms → ageFade = (1-0.5)² = 0.25
  expect(f.arcs[0]?.ageFade).toBeCloseTo(0.25, 2);
});

test('buildPolarFrame: nodes — activity = 1 vid recent puls (age < recency)', () => {
  // Pulse at age=0 (just fired). Activity should be saturated at 1.0,
  // peakPwNorm should reflect the pulse's pwNorm.
  const f = buildPolarFrame({
    dispatched: [makeDispatch({ pulseWidthMicros: 100 /* pwNorm=0.495 */ }, 0)],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 0, // pulse vid streamTime=0, age=0
  });
  const a = f.nodes.find((n) => n.electrode === 'A');
  expect(a?.activity).toBe(1); // age=0 → recency-fade = 1
  expect(a?.peakPwNorm).toBeCloseTo(0.495, 2);
});

test('buildPolarFrame: nodes — activity → 0 efter recency-window (250ms)', () => {
  // Pulse vid streamTime=0, observerad vid streamNow=400ms.
  // Age = 400ms > 250ms NODE_RECENCY → utanför recency-fönstret → activity=0,
  // peakPwNorm=0 (gated). Båge är fortfarande synlig (6s window).
  const f = buildPolarFrame({
    dispatched: [makeDispatch({ pulseWidthMicros: 200 }, 0)],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 400_000, // 400ms efter pulsen — utanför 250ms recency
  });
  const a = f.nodes.find((n) => n.electrode === 'A');
  expect(a?.activity).toBe(0);
  expect(a?.peakPwNorm).toBe(0);
  // Sanity: bågen finns kvar i 6s-fönstret
  expect(f.arcs.length).toBeGreaterThan(0);
});

test('buildPolarFrame: nodes — linear fade i recency-window', () => {
  // Pulse vid streamTime=0, observerad vid streamNow=125ms (halvvägs).
  // Förväntad activity = 1 - 125/250 = 0.5.
  const f = buildPolarFrame({
    dispatched: [makeDispatch({ pulseWidthMicros: 100 }, 0)],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 125_000,
  });
  const a = f.nodes.find((n) => n.electrode === 'A');
  expect(a?.activity).toBeCloseTo(0.5, 2);
  // peakPwNorm bibehålls inom recency
  expect(a?.peakPwNorm).toBeCloseTo(0.495, 2);
});

test('buildPolarFrame: nodes — youngest puls vinner när flera pulser i recency', () => {
  // Två pulser: gammal (200ms ago, age=200ms) och ny (50ms ago, age=50ms).
  // Activity ska följa den YNGSTA → 1 - 50/250 = 0.8.
  const f = buildPolarFrame({
    dispatched: [
      makeDispatch({ sequenceNumber: 1, startTimeMicros: 0, pulseWidthMicros: 50 }, 0),
      makeDispatch({ sequenceNumber: 2, startTimeMicros: 150_000, pulseWidthMicros: 100 }, 150_000),
    ],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 200_000, // youngest at age=50ms, oldest at age=200ms
  });
  const a = f.nodes.find((n) => n.electrode === 'A');
  expect(a?.activity).toBeCloseTo(0.8, 2);
  // peakPwNorm = pw från YNGSTA (100µs → 0.495), inte gamla (50µs → 0.242)
  expect(a?.peakPwNorm).toBeCloseTo(0.495, 2);
});

test('buildPolarFrame: pulser utanför window-start klipps', () => {
  const f = buildPolarFrame({
    dispatched: [
      makeDispatch({ sequenceNumber: 1, startTimeMicros: 0 }, 0),
      makeDispatch({ sequenceNumber: 2, startTimeMicros: 5_000_000 }, 5_000_000),
    ],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 5_500_000,
    windowMicros: 1_000_000, // 1s window
  });
  // Bara seq=2 är inom window (4_500_000..5_500_000)
  expect(f.arcs).toHaveLength(1);
  expect(f.arcs[0]?.sourceDescriptorSeq).toBe(2);
});

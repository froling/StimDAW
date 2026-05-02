import { test, expect } from 'bun:test';
import { buildFrame } from '../../src/oscilloscope/frame-builder';
import type { DispatchedDescriptor } from '../../src/mock-firmware/firmware';
import type { PtDescriptor } from '../../src/protocol/descriptor';
import type { VoltageSample } from '../../src/oscilloscope/voltage-state';
import { ElectrodeMask } from '../../src/patterns/types';

function makeDispatch(
  desc: Partial<PtDescriptor> = {},
  dispatchedAtMicros = 0,
): DispatchedDescriptor {
  return {
    descriptor: {
      meta: 0,
      sequenceNumber: 0,
      phase: 0,
      pulseWidthMicros: 50,
      startTimeMicros: 0,
      electrodeSet: [ElectrodeMask.A, ElectrodeMask.B],
      nrOfPulses: 1,
      paceQuarterMs: 40,
      amplitude: 200,
      deltaPulseWidthQuarters: 0,
      deltaPaceMicros: 0,
      ...desc,
    },
    dispatchedAtMicros,
    queueIdx: ((desc.phase ?? 0) & 1) as 0 | 1,
  };
}

test('buildFrame: null origin → tom frame med 4 tomma electrode-rows', () => {
  const frame = buildFrame({
    dispatched: [],
    voltageHistory: [],
    streamOriginMicros: null,
    streamOriginWallMicros: null,
    streamNowMicros: 0,
  });
  expect(frame.electrodeRows).toHaveLength(4);
  for (const row of frame.electrodeRows) {
    expect(row.pulses).toEqual([]);
  }
  expect(frame.primaryVoltageSteps).toEqual([]);
});

test('buildFrame: 4 fasta electrode-rows oavsett input', () => {
  const frame = buildFrame({
    dispatched: [],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 1_000_000,
  });
  expect(frame.electrodeRows.map((r) => r.electrode)).toEqual(['A', 'B', 'C', 'D']);
  expect(frame.electrodeRows.map((r) => r.bit)).toEqual([1, 2, 4, 8]);
});

test('buildFrame: enskild dispatched producerar pulser på rätt electrode-rows', () => {
  const dispatched = [
    makeDispatch({ electrodeSet: [ElectrodeMask.A, ElectrodeMask.B] }, 0),
  ];
  const voltages: VoltageSample[] = [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }];
  const frame = buildFrame({
    dispatched,
    voltageHistory: voltages,
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  // A och B aktiva, C och D inte
  expect(frame.electrodeRows[0]?.pulses).toHaveLength(1); // A
  expect(frame.electrodeRows[1]?.pulses).toHaveLength(1); // B
  expect(frame.electrodeRows[2]?.pulses).toHaveLength(0); // C
  expect(frame.electrodeRows[3]?.pulses).toHaveLength(0); // D
  // A på pos-side (phase=0), B på neg-side
  expect(frame.electrodeRows[0]?.pulses[0]?.polarity).toBe('pos');
  expect(frame.electrodeRows[1]?.pulses[0]?.polarity).toBe('neg');
});

test('buildFrame: window filter — descriptor utanför fönster exkluderas', () => {
  const old = makeDispatch({ startTimeMicros: 0 }, 0);
  const recent = makeDispatch({ startTimeMicros: 5_500_000 }, 5_500_000);
  const frame = buildFrame({
    dispatched: [old, recent],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 6_000_000,
  });
  // 'old' vid streamTime=0 ligger vid window-start (6s-6s=0), inkluderas precis
  // 'recent' vid streamTime=5.5s är klart inom — inkluderas
  // Samtliga 2 pulser hamnar i någon av A/B
  const totalA = frame.electrodeRows[0]?.pulses.length ?? 0;
  const totalB = frame.electrodeRows[1]?.pulses.length ?? 0;
  expect(totalA + totalB).toBe(4); // 2 dispatched × 2 electrodes per dispatch
});

test('buildFrame: multi-pulse descriptor expanderas i pulser i fönstret', () => {
  // nr=5, pace=10ms → 5 pulser med streamTime 0, 10ms, 20ms, 30ms, 40ms
  const dispatched = [
    makeDispatch(
      {
        nrOfPulses: 5,
        paceQuarterMs: 40,
        electrodeSet: [ElectrodeMask.A, ElectrodeMask.B],
      },
      0,
    ),
  ];
  const frame = buildFrame({
    dispatched,
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  expect(frame.electrodeRows[0]?.pulses).toHaveLength(5); // alla 5 i A
  expect(frame.electrodeRows[1]?.pulses).toHaveLength(5); // alla 5 i B
  // streamTime monotont
  const aPulses = frame.electrodeRows[0]?.pulses ?? [];
  for (let i = 1; i < aPulses.length; i++) {
    expect(aPulses[i]!.streamTimeMicros).toBeGreaterThan(aPulses[i - 1]!.streamTimeMicros);
  }
});

test('buildFrame: TENS-overlap (samma streamTime, motsatt phase) — båda renderas på samma rad', () => {
  // Spec-exempel: två descriptors på samma elcon AC↔BD, motsatt phase, 180µs offset
  const d1 = makeDispatch(
    {
      sequenceNumber: 1,
      phase: 0,
      startTimeMicros: 0,
      electrodeSet: [ElectrodeMask.A | ElectrodeMask.C, ElectrodeMask.B | ElectrodeMask.D],
    },
    0,
  );
  const d2 = makeDispatch(
    {
      sequenceNumber: 2,
      phase: 1,
      startTimeMicros: 180,
      electrodeSet: [ElectrodeMask.A | ElectrodeMask.C, ElectrodeMask.B | ElectrodeMask.D],
    },
    180,
  );
  const frame = buildFrame({
    dispatched: [d1, d2],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 100_000,
  });
  // Rad A: båda pulserna (en pos från d1, en neg från d2)
  expect(frame.electrodeRows[0]?.pulses).toHaveLength(2);
  const aPulses = frame.electrodeRows[0]?.pulses ?? [];
  expect(aPulses[0]?.polarity).toBe('pos'); // d1 phase=0, A på pos-side
  expect(aPulses[1]?.polarity).toBe('neg'); // d2 phase=1, A flippas till neg
});

test('buildFrame: voltage-trace populeras från voltageHistory', () => {
  const voltages: VoltageSample[] = [
    { Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 1_000_000 },
    { Vbat_mV: 9000, Vcap_mV: 8500, Iprim_mA: 110, wallTimeMicros: 2_000_000 },
    { Vbat_mV: 9000, Vcap_mV: 7500, Iprim_mA: 90, wallTimeMicros: 3_000_000 },
  ];
  const frame = buildFrame({
    dispatched: [],
    voltageHistory: voltages,
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 4_000_000,
  });
  expect(frame.primaryVoltageSteps).toHaveLength(3);
  expect(frame.primaryVoltageSteps[0]?.voltageMV).toBe(8000);
  expect(frame.primaryVoltageSteps[2]?.voltageMV).toBe(7500);
});

test('buildFrame: pulse utanför fönster (för gammalt) klipps bort', () => {
  // 100 pulser × 50ms pace = 5s burst (pace 50ms = paceQuarterMs=200, inom MAX)
  // streamOrigin=0, now=8s → window 2s..8s. Pulser 0-39 är utanför vänster.
  // Pulser k=40..99 är i fönstret = 60 pulser.
  const dispatched = [
    makeDispatch(
      {
        nrOfPulses: 100,
        paceQuarterMs: 200, // 50ms per pulse, inom hardware bounds
        electrodeSet: [ElectrodeMask.A, ElectrodeMask.B],
      },
      0,
    ),
  ];
  const frame = buildFrame({
    dispatched,
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 8_000_000,
  });
  const aPulses = frame.electrodeRows[0]?.pulses ?? [];
  expect(aPulses).toHaveLength(60); // k=40..99 inclusive
  expect(aPulses[0]!.streamTimeMicros).toBe(2_000_000); // pulse 40 vid 2s exakt
  expect(aPulses[aPulses.length - 1]!.streamTimeMicros).toBe(4_950_000); // pulse 99 vid 4.95s
});

test('buildFrame: empty dispatched → frame med tomma rader (men 4 rader finns)', () => {
  const frame = buildFrame({
    dispatched: [],
    voltageHistory: [],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 1_000_000,
  });
  expect(frame.electrodeRows).toHaveLength(4);
  for (const row of frame.electrodeRows) expect(row.pulses).toEqual([]);
});

test('buildFrame: streamNow respekteras (descriptors med startTime > now exkluderas)', () => {
  const future = makeDispatch({ startTimeMicros: 5_000_000 }, 5_000_000);
  const frame = buildFrame({
    dispatched: [future],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 1_000_000, // future descriptor är 4s framåt
  });
  // Future descriptor exkluderas
  for (const row of frame.electrodeRows) expect(row.pulses).toEqual([]);
});

test('buildFrame: window-bredd configurable', () => {
  const recent = makeDispatch({ startTimeMicros: 1_000_000 }, 1_000_000);
  const old = makeDispatch({ startTimeMicros: 0 }, 0);
  // Liten window (500ms): bara recent ska synas, inte old
  const frame = buildFrame({
    dispatched: [old, recent],
    voltageHistory: [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 0 }],
    streamOriginMicros: 0,
    streamOriginWallMicros: 0,
    streamNowMicros: 1_000_000,
    windowMicros: 500_000,
  });
  // Window: 0.5s..1.0s. Old vid 0 är utanför; recent vid 1s är vid kanten
  const totalPulses =
    (frame.electrodeRows[0]?.pulses.length ?? 0) +
    (frame.electrodeRows[1]?.pulses.length ?? 0);
  expect(totalPulses).toBe(2); // bara recent (1 pulse × 2 electrodes)
});

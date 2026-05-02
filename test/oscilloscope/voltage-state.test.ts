import { test, expect } from 'bun:test';
import {
  resolveVoltageAtWallTime,
  buildVoltageSteps,
  effectiveVoltageAtDispatch,
  type VoltageSample,
} from '../../src/oscilloscope/voltage-state';

test('resolveVoltageAtWallTime: empty history → 0', () => {
  expect(resolveVoltageAtWallTime([], 1_000_000)).toBe(0);
  expect(resolveVoltageAtWallTime([], 0)).toBe(0);
});

test('resolveVoltageAtWallTime: enskild sample exakt vid target → returnerar det värdet', () => {
  const h: VoltageSample[] = [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 1_000_000 }];
  expect(resolveVoltageAtWallTime(h, 1_000_000)).toBe(8000);
});

test('resolveVoltageAtWallTime: target före alla samples → 0', () => {
  const h: VoltageSample[] = [
    { Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 1_000_000 },
    { Vbat_mV: 9000, Vcap_mV: 8500, Iprim_mA: 110, wallTimeMicros: 2_000_000 },
  ];
  expect(resolveVoltageAtWallTime(h, 500_000)).toBe(0);
});

test('resolveVoltageAtWallTime: target efter alla samples → senaste värdet', () => {
  const h: VoltageSample[] = [
    { Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 1_000_000 },
    { Vbat_mV: 9000, Vcap_mV: 8500, Iprim_mA: 110, wallTimeMicros: 2_000_000 },
  ];
  expect(resolveVoltageAtWallTime(h, 5_000_000)).toBe(8500);
});

test('resolveVoltageAtWallTime: target mellan två samples → senaste-före', () => {
  const h: VoltageSample[] = [
    { Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 1_000_000 },
    { Vbat_mV: 9000, Vcap_mV: 9000, Iprim_mA: 110, wallTimeMicros: 2_000_000 },
    { Vbat_mV: 8800, Vcap_mV: 7500, Iprim_mA: 90, wallTimeMicros: 3_000_000 },
  ];
  expect(resolveVoltageAtWallTime(h, 1_500_000)).toBe(8000); // mellan 1 och 2
  expect(resolveVoltageAtWallTime(h, 2_500_000)).toBe(9000); // mellan 2 och 3
  expect(resolveVoltageAtWallTime(h, 3_500_000)).toBe(7500); // efter 3
});

test('buildVoltageSteps: null origin → tom array', () => {
  const h: VoltageSample[] = [{ Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 1_000_000 }];
  expect(buildVoltageSteps(h, null, 5_000_000, 0)).toEqual([]);
});

test('buildVoltageSteps: filtrerar till fönster', () => {
  const h: VoltageSample[] = [
    { Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 1_000_000 },
    { Vbat_mV: 9000, Vcap_mV: 8500, Iprim_mA: 110, wallTimeMicros: 3_000_000 },
    { Vbat_mV: 8800, Vcap_mV: 7500, Iprim_mA: 90, wallTimeMicros: 5_000_000 },
    { Vbat_mV: 8800, Vcap_mV: 7000, Iprim_mA: 80, wallTimeMicros: 7_000_000 },
  ];
  // window: 2s..6s, origin=0
  const steps = buildVoltageSteps(h, 0, 6_000_000, 2_000_000);
  expect(steps).toHaveLength(2); // 3M och 5M är inom
  expect(steps[0]?.voltageMV).toBe(8500);
  expect(steps[0]?.streamTimeMicros).toBe(3_000_000); // 3M - 0 origin
  expect(steps[1]?.voltageMV).toBe(7500);
});

test('buildVoltageSteps: stream-time normaliserar mot origin', () => {
  const h: VoltageSample[] = [
    { Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 10_000_000 },
    { Vbat_mV: 9000, Vcap_mV: 8500, Iprim_mA: 110, wallTimeMicros: 11_000_000 },
  ];
  const steps = buildVoltageSteps(h, 9_000_000, 12_000_000, 9_000_000);
  expect(steps[0]?.streamTimeMicros).toBe(1_000_000); // 10M - 9M = 1M
  expect(steps[1]?.streamTimeMicros).toBe(2_000_000);
  expect(steps[0]?.source).toBe('telemetry');
});

test('effectiveVoltageAtDispatch: returnerar Vcap vid dispatch-tid', () => {
  const h: VoltageSample[] = [
    { Vbat_mV: 9000, Vcap_mV: 8000, Iprim_mA: 100, wallTimeMicros: 1_000_000 },
    { Vbat_mV: 9000, Vcap_mV: 8500, Iprim_mA: 110, wallTimeMicros: 2_000_000 },
  ];
  expect(effectiveVoltageAtDispatch(h, 1_500_000)).toBe(8000);
  expect(effectiveVoltageAtDispatch(h, 2_500_000)).toBe(8500);
});

import { test, expect } from 'bun:test';
import { VoltageSim } from '../../src/mock-firmware/voltage-sim';

test('voltage-sim: idle state has Vbat near 8800mV, Vcap near 0', () => {
  const sim = new VoltageSim();
  const r = sim.read();
  expect(r.Vbat_mV).toBeGreaterThan(8500);
  expect(r.Vbat_mV).toBeLessThan(9100);
  expect(r.Vcap_mV).toBeLessThan(200);
  expect(r.Iprim_mA).toBe(0);
});

test('voltage-sim: Vcap rises toward target when playing at 50%', () => {
  const sim = new VoltageSim();
  sim.setIntensity(50);
  sim.setPlaying(true);
  // Advance well past 5×tau to reach steady state
  sim.advance(2000);
  const r = sim.read();
  // Target = 50% of 80000 = 40000 mV
  expect(r.Vcap_mV).toBeGreaterThan(38000);
  expect(r.Vcap_mV).toBeLessThan(42000);
});

test('voltage-sim: Vcap decays to 0 when stopped', () => {
  const sim = new VoltageSim();
  sim.setIntensity(80);
  sim.setPlaying(true);
  sim.advance(2000);
  sim.setPlaying(false);
  sim.advance(2000);
  const r = sim.read();
  expect(r.Vcap_mV).toBeLessThan(200);
});

test('voltage-sim: NaN/negative dt does not corrupt state', () => {
  const sim = new VoltageSim();
  sim.setIntensity(50);
  sim.setPlaying(true);
  sim.advance(NaN);
  sim.advance(-100);
  sim.advance(Infinity);
  const r = sim.read();
  expect(Number.isFinite(r.Vcap_mV)).toBe(true);
  expect(r.Vcap_mV).toBeGreaterThanOrEqual(0);
});

test('voltage-sim: intensity clamped to 0-100', () => {
  const sim = new VoltageSim();
  sim.setIntensity(150);
  sim.setPlaying(true);
  sim.advance(2000);
  const r = sim.read();
  // Should be capped at 100% → 80000 mV target
  expect(r.Vcap_mV).toBeLessThanOrEqual(80100);
});

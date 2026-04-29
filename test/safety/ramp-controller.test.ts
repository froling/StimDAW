import { test, expect } from 'bun:test';
import { RampController } from '../../src/safety/ramp-controller';

test('ramp: !connected → effective = 0 regardless of desired', () => {
  const r = new RampController({ rampUpDurationMs: 5000 });
  r.setDesired(80);
  expect(r.getEffective(0)).toBe(0);
});

test('ramp: connected with desired 80, no prior session → effective = 80, no ramp', () => {
  const r = new RampController({ rampUpDurationMs: 5000 });
  r.onConnect(0);
  r.setDesired(80);
  expect(r.getEffective(0)).toBe(80);
});

test('ramp: disconnect → effective = 0, lastKnown preserved', () => {
  const r = new RampController({ rampUpDurationMs: 5000 });
  r.onConnect(0);
  r.setDesired(80);
  r.onDisconnect();
  expect(r.getEffective(100)).toBe(0);
  expect(r.snapshot(100).lastKnown).toBe(80);
});

test('ramp: reconnect → linear ramp from 0 to lastKnown over rampUpDurationMs', () => {
  const r = new RampController({ rampUpDurationMs: 5000 });
  r.onConnect(0);
  r.setDesired(80);
  r.onDisconnect();
  r.onConnect(1000);

  expect(r.getEffective(1000)).toBe(0);
  expect(r.getEffective(2000)).toBe(16); // 1/5 = 16/80
  expect(r.getEffective(3500)).toBe(40); // 1/2 of ramp = 40
  expect(r.getEffective(5000)).toBe(64); // 4/5 = 64
  expect(r.getEffective(6000)).toBe(80); // ramp complete
  expect(r.getEffective(10000)).toBe(80); // stable at lastKnown
});

test('ramp: STOP cancels ramp and zeros desired+lastKnown', () => {
  const r = new RampController({ rampUpDurationMs: 5000 });
  r.onConnect(0);
  r.setDesired(80);
  r.onDisconnect();
  r.onConnect(1000);

  expect(r.getEffective(2500)).toBe(24); // mid-ramp
  r.onStop();
  expect(r.getEffective(2501)).toBe(0);
  expect(r.snapshot(2501).lastKnown).toBe(0);
  expect(r.snapshot(2501).desired).toBe(0);
});

test('ramp: setDesired during ramp cancels ramp (active intent overrides)', () => {
  const r = new RampController({ rampUpDurationMs: 5000 });
  r.onConnect(0);
  r.setDesired(80);
  r.onDisconnect();
  r.onConnect(1000);

  expect(r.getEffective(2500)).toBe(24); // mid-ramp
  r.setDesired(60); // user moves slider during ramp
  expect(r.getEffective(2501)).toBe(60);
  expect(r.snapshot(2501).ramping).toBe(false);
  expect(r.snapshot(2501).lastKnown).toBe(60);
});

test('ramp: connect with lastKnown=0 → no ramp (clean session start)', () => {
  const r = new RampController({ rampUpDurationMs: 5000 });
  r.onConnect(0);
  expect(r.snapshot(0).ramping).toBe(false);
  expect(r.getEffective(0)).toBe(0);
});

test('ramp: setDesired clamps to 0..100', () => {
  const r = new RampController();
  r.onConnect(0);
  r.setDesired(150);
  expect(r.snapshot(0).desired).toBe(100);
  r.setDesired(-20);
  expect(r.snapshot(0).desired).toBe(0);
  r.setDesired(NaN);
  expect(r.snapshot(0).desired).toBe(0);
});

test('ramp: ramp completion mutates state (auto-cleanup)', () => {
  const r = new RampController({ rampUpDurationMs: 1000 });
  r.onConnect(0);
  r.setDesired(50);
  r.onDisconnect();
  r.onConnect(100);

  expect(r.snapshot(100).ramping).toBe(true);
  r.getEffective(2000); // way past ramp end — triggers auto-complete
  expect(r.snapshot(2000).ramping).toBe(false);
});

test('ramp: zero rampUpDuration → instant restore (no ramp at all)', () => {
  const r = new RampController({ rampUpDurationMs: 0 });
  r.onConnect(0);
  r.setDesired(80);
  r.onDisconnect();
  r.onConnect(100);
  // With 0 duration, even t=100 (start) should already complete
  expect(r.getEffective(100)).toBe(80);
});

test('ramp: app-restart equivalent (fresh instance) → lastKnown = 0', () => {
  // Simulate app-restart by creating a new RampController
  const fresh = new RampController({ rampUpDurationMs: 5000 });
  fresh.onConnect(0);
  expect(fresh.snapshot(0).lastKnown).toBe(0);
  expect(fresh.snapshot(0).ramping).toBe(false);
  expect(fresh.getEffective(2500)).toBe(0);
});

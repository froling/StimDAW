import { test, expect } from 'bun:test';
import { SimClock } from '../../src/mock-firmware/sim-clock';

test('sim-clock: events fire in scheduled order', () => {
  const clock = new SimClock();
  const log: number[] = [];
  clock.scheduleIn(100, () => log.push(100));
  clock.scheduleIn(50, () => log.push(50));
  clock.scheduleIn(200, () => log.push(200));
  clock.advance(150);
  expect(log).toEqual([50, 100]);
  clock.advance(100);
  expect(log).toEqual([50, 100, 200]);
});

test('sim-clock: scheduling at exact-current time fires immediately on advance', () => {
  const clock = new SimClock();
  let fired = false;
  clock.scheduleAt(0, () => {
    fired = true;
  });
  clock.advance(0);
  expect(fired).toBe(true);
});

test('sim-clock: scheduling in the past throws', () => {
  const clock = new SimClock();
  clock.advance(100);
  expect(() => clock.scheduleAt(50, () => {})).toThrow();
});

test('sim-clock: events scheduled inside event handlers fire in same advance', () => {
  const clock = new SimClock();
  const log: number[] = [];
  clock.scheduleIn(10, () => {
    log.push(10);
    clock.scheduleIn(10, () => log.push(20));
  });
  clock.advance(50);
  expect(log).toEqual([10, 20]);
});

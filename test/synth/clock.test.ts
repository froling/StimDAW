import { test, expect } from 'bun:test';
import { TestClock, RealtimeClock } from '../../src/synth/clock';

test('TestClock: nowMicros startar på 0', () => {
  const c = new TestClock();
  expect(c.nowMicros()).toBe(0);
});

test('TestClock: advance bumpar nowMicros', () => {
  const c = new TestClock();
  c.advance(1000);
  expect(c.nowMicros()).toBe(1000);
  c.advance(500);
  expect(c.nowMicros()).toBe(1500);
});

test('TestClock: scheduleAt fires events vid rätt tid', () => {
  const c = new TestClock();
  const fired: number[] = [];
  c.scheduleAt(500, () => fired.push(c.nowMicros()));
  c.scheduleAt(1500, () => fired.push(c.nowMicros()));
  c.scheduleAt(1000, () => fired.push(c.nowMicros()));

  c.advance(2000);
  expect(fired).toEqual([500, 1000, 1500]);
});

test('TestClock: events under target advance fires; events efter target stannar', () => {
  const c = new TestClock();
  const fired: number[] = [];
  c.scheduleAt(500, () => fired.push(500));
  c.scheduleAt(1500, () => fired.push(1500));

  c.advance(1000);
  expect(fired).toEqual([500]);
  expect(c.pendingCount()).toBe(1); // 1500 är kvar
  expect(c.nowMicros()).toBe(1000);

  c.advance(1000);
  expect(fired).toEqual([500, 1500]);
});

test('TestClock: past-due events clampas till now och fires vid nästa advance', () => {
  const c = new TestClock();
  c.advance(1000); // now=1000
  const fired: number[] = [];
  c.scheduleAt(500, () => fired.push(c.nowMicros())); // past-due

  expect(fired).toEqual([]); // inte fire'd än

  c.advance(0); // event clampat till 1000, ska fire vid advance(0)?
  // Hmm, advance(0) target=1000, events[0].time === 1000 (clamped) ≤ 1000 → fire
  expect(fired).toEqual([1000]);
});

test('TestClock: reset rensar tid och events', () => {
  const c = new TestClock();
  c.scheduleAt(500, () => {});
  c.advance(200);
  expect(c.pendingCount()).toBe(1);

  c.reset();
  expect(c.nowMicros()).toBe(0);
  expect(c.pendingCount()).toBe(0);
});

test('TestClock: callback som schemalägger nya events fångas inom samma advance', () => {
  const c = new TestClock();
  const fired: number[] = [];
  c.scheduleAt(500, () => {
    fired.push(500);
    c.scheduleAt(1500, () => fired.push(1500));
  });

  c.advance(2000);
  expect(fired).toEqual([500, 1500]);
});

test('TestClock: multipla events vid samma tid fires i schedule-ordning', () => {
  const c = new TestClock();
  const fired: string[] = [];
  c.scheduleAt(500, () => fired.push('first'));
  c.scheduleAt(500, () => fired.push('second'));
  c.scheduleAt(500, () => fired.push('third'));

  c.advance(1000);
  expect(fired).toEqual(['first', 'second', 'third']);
});

test('RealtimeClock: nowMicros är monotont stigande', async () => {
  const c = new RealtimeClock();
  const t1 = c.nowMicros();
  await new Promise((r) => setTimeout(r, 10));
  const t2 = c.nowMicros();
  expect(t2).toBeGreaterThan(t1);
  // ~10ms = 10_000µs, men allow för jitter
  expect(t2 - t1).toBeGreaterThan(5_000);
});

test('RealtimeClock: scheduleAt fires fn efter delay', async () => {
  const c = new RealtimeClock();
  let fired = false;
  const target = c.nowMicros() + 20_000; // 20ms in future
  c.scheduleAt(target, () => {
    fired = true;
  });
  expect(fired).toBe(false);
  await new Promise((r) => setTimeout(r, 50));
  expect(fired).toBe(true);
});

import { test, expect } from 'bun:test';
import { DispatchedRing } from '../../src/mock-firmware/dispatched-ring';

test('DispatchedRing: empty initial state', () => {
  const r = new DispatchedRing<number>(5);
  expect(r.size).toBe(0);
  expect(r.capacity).toBe(5);
  expect(r.snapshot()).toEqual([]);
});

test('DispatchedRing: push under cap behåller ordning', () => {
  const r = new DispatchedRing<number>(5);
  r.push(1);
  r.push(2);
  r.push(3);
  expect(r.size).toBe(3);
  expect(r.snapshot()).toEqual([1, 2, 3]);
});

test('DispatchedRing: push exakt till cap', () => {
  const r = new DispatchedRing<number>(3);
  r.push(1);
  r.push(2);
  r.push(3);
  expect(r.size).toBe(3);
  expect(r.snapshot()).toEqual([1, 2, 3]);
});

test('DispatchedRing: överskriver äldsta vid overflow (FIFO drop)', () => {
  const r = new DispatchedRing<number>(3);
  r.push(1);
  r.push(2);
  r.push(3);
  r.push(4); // 1 dropas, ring innehåller [2,3,4]
  expect(r.size).toBe(3);
  expect(r.snapshot()).toEqual([2, 3, 4]);
  r.push(5); // 2 dropas
  expect(r.snapshot()).toEqual([3, 4, 5]);
});

test('DispatchedRing: snapshot kronologisk efter multipla wraparounds', () => {
  const r = new DispatchedRing<number>(3);
  for (let i = 1; i <= 10; i++) r.push(i);
  // Sista 3 = [8,9,10]
  expect(r.snapshot()).toEqual([8, 9, 10]);
});

test('DispatchedRing: clear återställer till empty', () => {
  const r = new DispatchedRing<number>(3);
  r.push(1);
  r.push(2);
  r.clear();
  expect(r.size).toBe(0);
  expect(r.snapshot()).toEqual([]);
  // Push efter clear startar från scratch
  r.push(99);
  expect(r.snapshot()).toEqual([99]);
});

test('DispatchedRing: snapshot returnerar kopia, ej intern array', () => {
  const r = new DispatchedRing<{ v: number }>(3);
  r.push({ v: 1 });
  r.push({ v: 2 });
  const snap = r.snapshot();
  snap.push({ v: 999 }); // mutera kopian
  expect(r.size).toBe(2); // ringen oförändrad
  expect(r.snapshot()).toEqual([{ v: 1 }, { v: 2 }]);
});

test('DispatchedRing: cap=1 edge case', () => {
  const r = new DispatchedRing<number>(1);
  r.push(1);
  r.push(2);
  r.push(3);
  expect(r.size).toBe(1);
  expect(r.snapshot()).toEqual([3]);
});

test('DispatchedRing: cap<=0 throws', () => {
  expect(() => new DispatchedRing<number>(0)).toThrow();
  expect(() => new DispatchedRing<number>(-1)).toThrow();
});

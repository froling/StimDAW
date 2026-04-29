import { test, expect } from 'bun:test';
import { MaxCeiling } from '../../src/safety/max-ceiling';

test('max-ceiling: default value is 50, max is 100', () => {
  const c = new MaxCeiling();
  expect(c.get()).toBe(50);
  expect(c.getMax()).toBe(100);
});

test('max-ceiling: enforce caps candidate at ceiling', () => {
  const c = new MaxCeiling(50);
  expect(c.enforce(30)).toBe(30);
  expect(c.enforce(50)).toBe(50);
  expect(c.enforce(80)).toBe(50);
});

test('max-ceiling: enforce clamps NaN/negative to 0', () => {
  const c = new MaxCeiling(50);
  expect(c.enforce(NaN)).toBe(0);
  expect(c.enforce(-10)).toBe(0);
  expect(c.enforce(Infinity)).toBe(50);
});

test('max-ceiling: set is clamped to [0, max]', () => {
  const c = new MaxCeiling(50);
  expect(c.set(70)).toBe(70);
  expect(c.get()).toBe(70);
  expect(c.set(150)).toBe(100);
  expect(c.set(-5)).toBe(0);
});

import { test, expect } from 'bun:test';
import { streamTime, ELECTRODE_DEFS, DEFAULT_WINDOW_MICROS } from '../../src/oscilloscope/types';

test('streamTime: null origin → 0', () => {
  expect(streamTime(123_456, null)).toBe(0);
  expect(streamTime(0, null)).toBe(0);
});

test('streamTime: subtracts origin from descriptor time', () => {
  expect(streamTime(1_000_000, 0)).toBe(1_000_000);
  expect(streamTime(1_500_000, 1_000_000)).toBe(500_000);
  expect(streamTime(0, 0)).toBe(0);
});

test('streamTime: handles negative result (descriptor before origin)', () => {
  // Edge case: descriptor.startTimeMicros < origin (kan hända om origin
  // sätts vid första-dispatch men en senare descriptor har lägre startTime)
  expect(streamTime(500_000, 1_000_000)).toBe(-500_000);
});

test('ELECTRODE_DEFS: 4 electrodes, A=1 B=2 C=4 D=8', () => {
  expect(ELECTRODE_DEFS).toHaveLength(4);
  expect(ELECTRODE_DEFS[0]).toEqual({ electrode: 'A', bit: 1 });
  expect(ELECTRODE_DEFS[1]).toEqual({ electrode: 'B', bit: 2 });
  expect(ELECTRODE_DEFS[2]).toEqual({ electrode: 'C', bit: 4 });
  expect(ELECTRODE_DEFS[3]).toEqual({ electrode: 'D', bit: 8 });
});

test('DEFAULT_WINDOW_MICROS: 6 seconds', () => {
  expect(DEFAULT_WINDOW_MICROS).toBe(6_000_000);
});

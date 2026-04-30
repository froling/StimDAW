import { test, expect } from 'bun:test';
import {
  PULSE_WIDTH_MIN_MICROS as PW_MIN_BOUNDS,
  PULSE_WIDTH_MAX_MICROS as PW_MAX_BOUNDS,
  PACE_MIN_MICROS as PACE_MIN_BOUNDS,
  PACE_MAX_MICROS as PACE_MAX_BOUNDS,
  AMPLITUDE_MIN,
  AMPLITUDE_MAX,
  PULSE_WIDTH_BOUNDS,
  PACE_BOUNDS,
  AMPLITUDE_BOUNDS,
} from '../../src/protocol/hardware-bounds';
import {
  PULSE_WIDTH_MIN_MICROS as PW_MIN_TIMING,
  PULSE_WIDTH_MAX_MICROS as PW_MAX_TIMING,
  PACE_MIN_MICROS as PACE_MIN_TIMING,
  PACE_MAX_MICROS as PACE_MAX_TIMING,
} from '../../src/ui/descriptor-timing';

/**
 * GAP-C per eng-review: skydda mot framtida split mellan
 * src/protocol/hardware-bounds.ts (β single source) och
 * src/ui/descriptor-timing.ts (α2 visualisering).
 *
 * Båda moduler MÅSTE referera till samma hardware-konstanter.
 * Test failures här = någon ändrade på en plats utan andra → silent bug.
 */

test('hardware-bounds: src/protocol och src/ui/descriptor-timing exporterar samma PULSE_WIDTH-värden', () => {
  expect(PW_MIN_BOUNDS).toBe(PW_MIN_TIMING);
  expect(PW_MAX_BOUNDS).toBe(PW_MAX_TIMING);
});

test('hardware-bounds: src/protocol och src/ui/descriptor-timing exporterar samma PACE-värden', () => {
  expect(PACE_MIN_BOUNDS).toBe(PACE_MIN_TIMING);
  expect(PACE_MAX_BOUNDS).toBe(PACE_MAX_TIMING);
});

test('hardware-bounds: värden matchar firmware/inc/burst.h', () => {
  // MIN_PULSE_WIDTH_¼µs (2 * 4) → 2µs
  expect(PW_MIN_BOUNDS).toBe(2);
  // MAX_PULSE_WIDTH_¼µs (200 * 4) → 200µs
  expect(PW_MAX_BOUNDS).toBe(200);
  // MIN_PULSE_PACE_µs 5000 = 5ms (200Hz max)
  expect(PACE_MIN_BOUNDS).toBe(5_000);
  // MAX_PULSE_PACE_µs 62500 = 62.5ms (16Hz min)
  expect(PACE_MAX_BOUNDS).toBe(62_500);
  // Amplitude byte 0..255
  expect(AMPLITUDE_MIN).toBe(0);
  expect(AMPLITUDE_MAX).toBe(255);
});

test('hardware-bounds: convenience-tuples speglar konstanter', () => {
  expect(PULSE_WIDTH_BOUNDS).toEqual({ min: 2, max: 200 });
  expect(PACE_BOUNDS).toEqual({ min: 5_000, max: 62_500 });
  expect(AMPLITUDE_BOUNDS).toEqual({ min: 0, max: 255 });
});

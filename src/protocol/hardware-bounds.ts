/**
 * Hardware bounds — single source-of-truth för NeoDK firmware-clamps.
 *
 * Värden härledda från `reference/NeoDK/firmware/inc/burst.h`:
 *   #define MIN_PULSE_WIDTH_¼µs   (  2 * 4)    →  2µs
 *   #define MAX_PULSE_WIDTH_¼µs   (200 * 4)    →  200µs
 *   #define MIN_PULSE_PACE_µs     5000          →  5ms (200Hz max)
 *   #define MAX_PULSE_PACE_µs     62500         →  62.5ms (16Hz min)
 *
 * Amplitude byte: 0..255 (1/255 av maxspänning, ~80V vid 9V batteri).
 *
 * Per eng-review 2.2A: båda src/synth och src/ui/descriptor-timing
 * importerar från denna modul. Ändringar i firmware-version uppdateras
 * på en plats. Bounds-shared-test (test/synth/bounds-shared.test.ts)
 * skyddar mot framtida split.
 */

export const PULSE_WIDTH_MIN_MICROS = 2;
export const PULSE_WIDTH_MAX_MICROS = 200;

/** 5ms = 200Hz max pulse rate per firmware. */
export const PACE_MIN_MICROS = 5_000;
/** 62.5ms = 16Hz min pulse rate per firmware. */
export const PACE_MAX_MICROS = 62_500;

export const AMPLITUDE_MIN = 0;
export const AMPLITUDE_MAX = 255;

/** Convenience tuples för bounds-checks. */
export const PULSE_WIDTH_BOUNDS = {
  min: PULSE_WIDTH_MIN_MICROS,
  max: PULSE_WIDTH_MAX_MICROS,
} as const;

export const PACE_BOUNDS = {
  min: PACE_MIN_MICROS,
  max: PACE_MAX_MICROS,
} as const;

export const AMPLITUDE_BOUNDS = {
  min: AMPLITUDE_MIN,
  max: AMPLITUDE_MAX,
} as const;

/**
 * Pure helpers för descriptor-timing-visualization i Oscilloscope.
 *
 * Aggregerar mean pulse_width och mean pace per descriptor — tar hänsyn till
 * delta_pulse_width_¼µs och delta_pace_µs när nrOfPulses > 1. Reduceras till
 * descriptorns base-värden för nrOfPulses=1 (DAW-streaming-fallet).
 *
 * Hardware-bounds från reference/NeoDK/firmware/inc/burst.h:
 *   PULSE_WIDTH: 2µs..200µs
 *   PACE:        5ms..62.5ms
 *
 * Procent-mapping är linjär mellan min och max — värden utanför clampar till
 * 0% resp 100%. Detta är intentionellt eftersom hardware också clampar dessa.
 */
import type { PtDescriptor } from '../protocol/descriptor';

export const PULSE_WIDTH_MIN_MICROS = 2;
export const PULSE_WIDTH_MAX_MICROS = 200;
export const PACE_MIN_MICROS = 5_000; // 5ms
export const PACE_MAX_MICROS = 62_500; // 62.5ms (16Hz min)

/**
 * Mean pulse_width µs över descriptor's nrOfPulses, inkl delta-ramping.
 *
 * Per spec: pulse[i].width = base + ⌊(i × deltaPulseWidthQuarters) / 4⌋
 * Mean över i=0..N-1 med floor-division ger lite jitter; enklast är att
 * approximera utan floor (kontinuerlig rampe), vilket är bra nog för
 * visualisering: mean = base + (N-1) × delta / 8.
 *
 * Detta är samma som arithmetic mean av (base, base+delta/4, ..., base+(N-1)×delta/4).
 */
export function meanPulseWidthMicros(d: PtDescriptor): number {
  const base = d.pulseWidthMicros;
  if (d.nrOfPulses <= 1) return base;
  return base + ((d.nrOfPulses - 1) * d.deltaPulseWidthQuarters) / 8;
}

/**
 * Mean pace µs över descriptor's nrOfPulses, inkl delta-ramping.
 *
 * Per spec: pulse[i].pace = paceMicros + i × deltaPaceMicros
 * Mean = paceMicros + (N-1) × delta / 2.
 *
 * Notera: descriptor lagrar pace som paceQuarterMs (¼ms-units), så vi
 * multiplicerar med 250 för att få µs.
 */
export function meanPaceMicros(d: PtDescriptor): number {
  const baseMicros = d.paceQuarterMs * 250;
  if (d.nrOfPulses <= 1) return baseMicros;
  return baseMicros + ((d.nrOfPulses - 1) * d.deltaPaceMicros) / 2;
}

/**
 * Mappa pulse_width µs → procent av hardware-range (PULSE_WIDTH_MIN..MAX).
 * Returns 0..1 (clamped). 2µs → 0, 200µs → 1.
 */
export function pulseWidthPercent(microns: number): number {
  if (!Number.isFinite(microns)) return 0;
  const range = PULSE_WIDTH_MAX_MICROS - PULSE_WIDTH_MIN_MICROS;
  const t = (microns - PULSE_WIDTH_MIN_MICROS) / range;
  return Math.max(0, Math.min(1, t));
}

/**
 * Mappa pace µs → procent av hardware-range (PACE_MIN..MAX).
 * Returns 0..1 (clamped). 5ms → 0, 62.5ms → 1.
 */
export function pacePercent(micros: number): number {
  if (!Number.isFinite(micros)) return 0;
  const range = PACE_MAX_MICROS - PACE_MIN_MICROS;
  const t = (micros - PACE_MIN_MICROS) / range;
  return Math.max(0, Math.min(1, t));
}

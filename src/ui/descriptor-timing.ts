/**
 * Pure helpers för descriptor-timing-visualization i Oscilloscope.
 *
 * Aggregerar mean pulse_width och mean pace per descriptor — tar hänsyn till
 * delta_pulse_width_¼µs och delta_pace_µs när nrOfPulses > 1. Reduceras till
 * descriptorns base-värden för nrOfPulses=1 (DAW-streaming-fallet).
 *
 * Hardware-bounds från reference/NeoDK/firmware/inc/burst.h:
 *   PULSE_WIDTH: 2µs..200µs
 *   PACE:        5ms..62.5ms (16Hz min, 200Hz max)
 *
 * Procent-mapping är 0..MAX (inte MIN..MAX). Motivering: vid MIN..MAX-mapping
 * blir Jackhammer's 7ms pace = 3.5% = sub-pixel-osynligt i timing-charten.
 * 0..MAX gör att stapelhöjd är proportionell till absolut värde — pace=7ms
 * ger 11% (synligt), pace=62.5ms ger 100%. Värden över MAX clampar till 100%
 * (matchar firmware-clamping).
 */
import type { PtDescriptor } from '../protocol/descriptor';

export const PULSE_WIDTH_MIN_MICROS = 2; // hardware floor (defense)
export const PULSE_WIDTH_MAX_MICROS = 200;
export const PACE_MIN_MICROS = 5_000; // 5ms = 200Hz (hardware floor, defense)
export const PACE_MAX_MICROS = 62_500; // 62.5ms = 16Hz

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
 * Mappa pulse_width µs → procent av PULSE_WIDTH_MAX (0..MAX, inte MIN..MAX).
 * Returns 0..1 (clamped). 0µs → 0%, 200µs → 100%, 144µs → 72%.
 */
export function pulseWidthPercent(micros: number): number {
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return Math.min(1, micros / PULSE_WIDTH_MAX_MICROS);
}

/**
 * Mappa pace µs → procent av PACE_MAX (0..MAX, inte MIN..MAX).
 * Returns 0..1 (clamped). 0µs → 0%, 62.5ms → 100%, 7ms → 11%.
 */
export function pacePercent(micros: number): number {
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return Math.min(1, micros / PACE_MAX_MICROS);
}

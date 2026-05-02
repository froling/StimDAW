/**
 * Pure module. No Svelte imports, no $state, no I/O.
 *
 * Expandera en PT-descriptor med `nr_of_pulses > 1` till en ström av
 * FiredPulse-events (en per puls), med `delta_pulse_width_¼µs` och
 * `delta_pace_µs` applicerade per puls.
 *
 * Hedrar PulseTrainDescr.md spec, INTE nuvarande firmware-bug
 * (`bsp_stm32g071.c:476` har `Burst_applyDeltas`-anropet utkommenterat).
 * Vi gör det rätta; firmware kommer ikapp.
 *
 * Clamps följer `firmware/inc/burst.h`:
 *   MIN_PULSE_WIDTH_¼µs = 8  (= 2µs)
 *   MAX_PULSE_WIDTH_¼µs = 800 (= 200µs)
 *   MAX_PULSE_PACE_µs   = 62500
 *
 * Per-pulse evolution:
 *   pw_k = clamp(base_pw + k * delta_pw, MIN, MAX)    [¼µs units internally]
 *   pace_k = clamp(base_pace + k * delta_pace, ?, MAX)  [µs]
 *   streamTime_k = descriptor.startTimeMicros + sum(pace_0..pace_k-1)
 */
import type { PtDescriptor } from '../protocol/descriptor';
import type { Elcon } from '../patterns/types';
import type { FiredPulse } from './types';
import {
  PULSE_WIDTH_MIN_MICROS,
  PULSE_WIDTH_MAX_MICROS,
  PACE_MAX_MICROS,
} from '../protocol/hardware-bounds';

const MIN_PULSE_WIDTH_QUARTERS = PULSE_WIDTH_MIN_MICROS * 4; // 8
const MAX_PULSE_WIDTH_QUARTERS = PULSE_WIDTH_MAX_MICROS * 4; // 800

/**
 * Expandera en descriptor till `nr_of_pulses` FiredPulse-events.
 *
 * @param descriptor - PT-descriptor från host emit-stream
 * @param descriptorStreamTimeMicros - descriptor.startTimeMicros men
 *   redan stream-time-normaliserad (origin subtraherat). Caller ansvarar.
 *
 * @returns array av FiredPulse, en per puls. Tom array om nr_of_pulses=0.
 *
 * Note (2026-05-02): tidigare tog parametern `effectivePrimaryVoltageMV`
 * (resolved Vcap från voltage-history). Bortdroppad per eng-review — viz
 * använder nu `descriptor.amplitude` direkt (wire-truth byte). Ingen
 * voltage-state-lookup behövs för pulse-rendering.
 */
export function expandDescriptor(
  descriptor: PtDescriptor,
  descriptorStreamTimeMicros: number,
): FiredPulse[] {
  const n = descriptor.nrOfPulses;
  if (n === 0 || !Number.isFinite(n)) return [];

  const elcon = descriptor.electrodeSet as Elcon;
  const phase = (descriptor.phase & 0x01) as 0 | 1;
  const seq = descriptor.sequenceNumber;
  const baseWidthQuarters = descriptor.pulseWidthMicros * 4;
  const basePaceMicros = descriptor.paceQuarterMs * 250;
  const dpwQuarters = descriptor.deltaPulseWidthQuarters;
  const dpaceMicros = descriptor.deltaPaceMicros;

  const out: FiredPulse[] = [];
  let cumulativeMicros = descriptorStreamTimeMicros;

  for (let k = 0; k < n; k++) {
    // Per-pulse pulse width with delta application + clamp
    const pwQuartersRaw = baseWidthQuarters + k * dpwQuarters;
    const pwQuarters = clamp(pwQuartersRaw, MIN_PULSE_WIDTH_QUARTERS, MAX_PULSE_WIDTH_QUARTERS);
    const pulseWidthMicros = pwQuarters / 4;

    // Per-pulse pace with delta application + upper clamp.
    // Lower clamp deferred — firmware accepts pace below MIN as long as it's > 0.
    // Negative drift (delta_pace<0) can result in tiny pace; we clamp to 1µs minimum
    // to avoid divide-by-zero / non-monotonic streamTime.
    const paceRaw = basePaceMicros + k * dpaceMicros;
    const paceMicros = clamp(paceRaw, 1, PACE_MAX_MICROS);

    out.push({
      streamTimeMicros: cumulativeMicros,
      elcon,
      phase,
      pulseWidthMicros,
      paceMicros,
      descriptorAmplitude: descriptor.amplitude,
      sourceDescriptorSeq: seq,
      pulseIdxInBurst: k,
    });

    cumulativeMicros += paceMicros;
  }

  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

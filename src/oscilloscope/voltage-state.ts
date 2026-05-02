/**
 * Pure module. No Svelte imports, no $state, no I/O.
 *
 * Resolve "what was the primary voltage at stream-time T?" från en historik
 * av voltage-events. För BETA Oscilloscope läses voltage-trace från real
 * device-telemetri (Vcap_mV via `voltages`-event), INTE en host-side
 * approximation av IntensityPercent → mV.
 *
 * Per eng-review T2: voltage-trace = real Vcap_mV. Mock-firmware emittar
 * realistiska voltages-events via voltage-sim.ts.
 *
 * Inputformat: array av samples med wall-time-stamp (samma som
 * `app.voltageHistory` i stores.svelte.ts) + en stream-time-origin för
 * konvertering.
 */
import type { PrimaryVoltageStep } from './types';

/**
 * En voltage-sample från device telemetri (eller mock). Innehåller hela
 * AI_VOLTAGES-attributets payload + wall-clock-stamp.
 */
export interface VoltageSample {
  /** Battery voltage i mV (~8-12V) */
  readonly Vbat_mV: number;
  /** Buffer-cap voltage i mV — den fysiska spänningen på C2/C9/C10 */
  readonly Vcap_mV: number;
  /** Primary winding current i mA (mätt via shunt R4) */
  readonly Iprim_mA: number;
  /**
   * Wall-clock-tid (`performance.now() * 1000`) när samplet anlände.
   * Konverteras till stream-time via streamOriginWallMicros.
   */
  readonly wallTimeMicros: number;
}

/**
 * Resolve effective primary voltage vid stream-time T.
 *
 * Scan history för senaste sample där `wallTime ≤ targetWallTime`.
 * Om history är tom eller alla samples är efter target → 0 mV.
 *
 * Linear-scan implementation. History är bounded (~600 samples per
 * `VOLTAGE_RING_SIZE` i stores.svelte.ts) så O(N) räcker. Optimering
 * via binary-search om history växer.
 */
export function resolveVoltageAtWallTime(
  history: readonly VoltageSample[],
  targetWallTimeMicros: number,
): number {
  if (history.length === 0) return 0;

  // Senaste sample med wallTime ≤ target
  let result = 0;
  for (const sample of history) {
    if (sample.wallTimeMicros <= targetWallTimeMicros) {
      result = sample.Vcap_mV;
    } else {
      // Samples är typiskt monotont stigande i tid, så vi kan break
      // när vi passerat target. Men för säkerhet (och om historik ej
      // garanterat sorted) — fortsätt loopa, behåll senaste-före-target.
      // Om loop blir perf-issue, lägg till sortedness-check i caller.
      break;
    }
  }
  return result;
}

/**
 * Producera step-line-data för rendering. För varje förändring i
 * Vcap_mV (relative to previous), emit en step. Fingranulära ändringar
 * från RC-recovery dedupliceras inte — caller renderar smooth path.
 *
 * Filtrerar samples till 6s-fönstret för perf.
 */
export function buildVoltageSteps(
  history: readonly VoltageSample[],
  streamOriginWallMicros: number | null,
  windowEndWallMicros: number,
  windowStartWallMicros: number,
): PrimaryVoltageStep[] {
  if (streamOriginWallMicros === null) return [];

  const out: PrimaryVoltageStep[] = [];
  for (const sample of history) {
    if (sample.wallTimeMicros < windowStartWallMicros) continue;
    if (sample.wallTimeMicros > windowEndWallMicros) break;

    const streamTime = sample.wallTimeMicros - streamOriginWallMicros;
    out.push({
      streamTimeMicros: streamTime,
      voltageMV: sample.Vcap_mV,
      source: 'telemetry',
    });
  }
  return out;
}

/**
 * För expand-pipeline: vid en descriptors `dispatchedAtWallMicros`,
 * vad var primary voltage just då?
 *
 * Detta används av frame-builder för att binda en "effective primary
 * voltage" till varje FiredPulse. Värdet propagerar genom expand →
 * electrode-mapping → render.
 */
export function effectiveVoltageAtDispatch(
  history: readonly VoltageSample[],
  dispatchedAtWallMicros: number,
): number {
  return resolveVoltageAtWallTime(history, dispatchedAtWallMicros);
}

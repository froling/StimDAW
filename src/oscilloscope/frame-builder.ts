/**
 * Pure module. No Svelte imports, no $state, no I/O.
 *
 * Bygg en OscilloscopeFrame från (dispatched-buffer, voltage-history,
 * stream-now, window). Anropas av frame-timer var 33ms (30Hz) i
 * stores.svelte.ts.
 *
 * Pipeline per frame:
 *   1. Filter dispatched till descriptors med streamTime ≤ now
 *   2. Per descriptor: resolve effective primary voltage vid dispatch-tid
 *   3. Per descriptor: expand till FiredPulse[] (nr=1-stream)
 *   4. Filter pulses till 6s-fönster (now - window .. now)
 *   5. Per pulse: map till electrode-rader
 *   6. Group per electrode-rad, build ElectrodeRowFrame
 *   7. Build PrimaryVoltageStep[] från voltage-history
 *   8. Returnera OscilloscopeFrame
 */
import type { DispatchedDescriptor } from '../mock-firmware/firmware';
import { expandDescriptor } from './expand';
import { mapPulseToElectrodes } from './electrode-mapping';
import {
  buildVoltageSteps,
  type VoltageSample,
} from './voltage-state';
import {
  ELECTRODE_DEFS,
  DEFAULT_WINDOW_MICROS,
  streamTime,
  type OscilloscopeFrame,
  type ElectrodeRowFrame,
  type ElectrodeRowPulse,
} from './types';

export interface BuildFrameInputs {
  /** Wire-truth, från app.dispatchedDescriptors */
  readonly dispatched: readonly DispatchedDescriptor[];
  /** Real telemetri, från app.voltageHistory */
  readonly voltageHistory: readonly VoltageSample[];
  /** Stream-time origin (descriptor.startTimeMicros vid första dispatch) */
  readonly streamOriginMicros: number | null;
  /**
   * Wall-clock origin (`performance.now()*1000` vid första dispatch).
   * Används för att translatera voltage-history (wall-time) till stream-time.
   */
  readonly streamOriginWallMicros: number | null;
  /** Aktuell stream-time (now-cursor på höger kant) */
  readonly streamNowMicros: number;
  /** Window-bredd, default 6_000_000 (6s) */
  readonly windowMicros?: number;
}

export function buildFrame(inputs: BuildFrameInputs): OscilloscopeFrame {
  const windowMicros = inputs.windowMicros ?? DEFAULT_WINDOW_MICROS;
  const windowStartStream = inputs.streamNowMicros - windowMicros;

  // Empty frame om ingen origin satt
  if (inputs.streamOriginMicros === null || inputs.streamOriginWallMicros === null) {
    return {
      streamNowMicros: inputs.streamNowMicros,
      windowMicros,
      electrodeRows: emptyElectrodeRows(),
      primaryVoltageSteps: [],
    };
  }

  // Group ElectrodeRowPulses per electrode-bit
  const rowMap = new Map<1 | 2 | 4 | 8, ElectrodeRowPulse[]>();
  for (const def of ELECTRODE_DEFS) rowMap.set(def.bit, []);

  for (const dispatch of inputs.dispatched) {
    const descriptorStreamTime = streamTime(
      dispatch.descriptor.startTimeMicros,
      inputs.streamOriginMicros,
    );

    // Skip descriptors helt utanför fönstret. En descriptor kan span:a fönster-
    // gränsen (multi-pulse) — vi expanderar och filtrerar pulses individuellt.
    const descriptorEndApprox =
      descriptorStreamTime +
      dispatch.descriptor.nrOfPulses * dispatch.descriptor.paceQuarterMs * 250;
    if (descriptorEndApprox < windowStartStream) continue;
    if (descriptorStreamTime > inputs.streamNowMicros) continue;

    // Expand till nr=1 stream
    const pulses = expandDescriptor(
      dispatch.descriptor,
      descriptorStreamTime,
    );

    // Filter pulses till fönstret + map till electrodes
    for (const pulse of pulses) {
      if (pulse.streamTimeMicros < windowStartStream) continue;
      if (pulse.streamTimeMicros > inputs.streamNowMicros) continue;

      const mappings = mapPulseToElectrodes(pulse);
      for (const m of mappings) {
        rowMap.get(m.bit)!.push(m.rowPulse);
      }
    }
  }

  // Build ElectrodeRowFrame per electrode (alltid 4 rader)
  const electrodeRows: ElectrodeRowFrame[] = ELECTRODE_DEFS.map((def) => ({
    electrode: def.electrode,
    bit: def.bit,
    pulses: rowMap.get(def.bit) ?? [],
  }));

  // Build primary voltage steps från telemetri-history
  const windowEndWall = inputs.streamOriginWallMicros + inputs.streamNowMicros;
  const windowStartWall = inputs.streamOriginWallMicros + windowStartStream;
  const primaryVoltageSteps = buildVoltageSteps(
    inputs.voltageHistory,
    inputs.streamOriginWallMicros,
    windowEndWall,
    windowStartWall,
  );

  return {
    streamNowMicros: inputs.streamNowMicros,
    windowMicros,
    electrodeRows,
    primaryVoltageSteps,
  };
}

function emptyElectrodeRows(): ElectrodeRowFrame[] {
  return ELECTRODE_DEFS.map((def) => ({
    electrode: def.electrode,
    bit: def.bit,
    pulses: [] as ElectrodeRowPulse[],
  }));
}

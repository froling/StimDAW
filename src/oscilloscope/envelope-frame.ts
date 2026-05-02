/**
 * Pure module. No Svelte imports, no $state, no I/O.
 *
 * Envelope frame-builder. Producerar en SMOOTH amplitudkurva per elektrod
 * över 6s-fönstret istället för diskreta pulse-rektanglar. Modellerar hur
 * stim KÄNNS över tid: tät burst av pulser → jämn stark känsla; gleshet
 * → tystnad; pulse-width-modulation → form på envelope.
 *
 * För varje time-bin (33ms) över 6s:
 *   - intensity[A] = sum over pulses i bin × amp × pulse_width
 *   - polarity[A] = vägd polaritet (varm/kall mix)
 *   - bins blir y-värden för en filled smooth path per electrode-rad
 *
 * Skiljer från frame-builder.ts (gamla per-puls): tonen är annorlunda,
 * vi visar känsla, inte enskilda events.
 */
import type { DispatchedDescriptor } from '../mock-firmware/firmware';
import { expandDescriptor } from './expand';
import type { VoltageSample } from './voltage-state';
import { ELECTRODE_DEFS, DEFAULT_WINDOW_MICROS, streamTime } from './types';
import type { Elcon } from '../patterns/types';

/**
 * En time-bin per electrode med aggregerade känslo-parametrar.
 *
 * Polariteten är medvetet INTE inkluderad här — den är säkerhets-mekanik
 * (DC-skydd via biphasic alternation) och påverkar inte upplevelsen.
 */
export interface EnvelopeBin {
  readonly streamTimeMicros: number;
  /** 0..1 — vägd amplitude (driver envelope-höjd). */
  readonly ampNorm: number;
  /** 0..1 — vägd pulse_width (driver envelope-stroke-tjocklek). */
  readonly pwNorm: number;
  /** Antal pulser som bidrog (0 = idle, höga värden = tät rytm). */
  readonly pulseCount: number;
}

export interface EnvelopeRow {
  readonly electrode: 'A' | 'B' | 'C' | 'D';
  readonly bins: readonly EnvelopeBin[];
}

export interface EnvelopeFrame {
  readonly streamNowMicros: number;
  readonly windowMicros: number;
  readonly binDurationMicros: number;
  readonly rows: readonly EnvelopeRow[];
}

export interface BuildEnvelopeFrameInputs {
  readonly dispatched: readonly DispatchedDescriptor[];
  /**
   * @deprecated Behålls för API-kompat men oanvänd i envelope-render.
   * Vcap-trace flyttad till Live Monitor (rätt mental separation:
   * monitor = telemetri, envelope = upplevelse-modell).
   */
  readonly voltageHistory?: readonly VoltageSample[];
  readonly streamOriginMicros: number | null;
  readonly streamOriginWallMicros: number | null;
  readonly streamNowMicros: number;
  readonly windowMicros?: number;
  readonly binDurationMicros?: number;
}

const DEFAULT_BIN_MICROS = 33_000; // 33ms = matchar frame-rate

export function buildEnvelopeFrame(inputs: BuildEnvelopeFrameInputs): EnvelopeFrame {
  const windowMicros = inputs.windowMicros ?? DEFAULT_WINDOW_MICROS;
  const binDurationMicros = inputs.binDurationMicros ?? DEFAULT_BIN_MICROS;
  const windowStart = inputs.streamNowMicros - windowMicros;

  // Empty frame om ingen origin
  if (
    inputs.streamOriginMicros === null ||
    inputs.streamOriginWallMicros === null
  ) {
    return {
      streamNowMicros: inputs.streamNowMicros,
      windowMicros,
      binDurationMicros,
      rows: emptyRows(windowStart, inputs.streamNowMicros, binDurationMicros),
    };
  }

  /*
   * Bins anchoras vid ABSOLUT stream-time (multiplar av binDur från t=0),
   * INTE vid windowStart. Det gör att bin-centrum är fixerade i tid; bara
   * fönstret rullar. Tidigare implementation drev bin-centrum 1 bin/frame
   * vilket gjorde att hela envelope-formen "hoppade" åt vänster varje 33ms.
   *
   * lastBinIdx kräver att bin-CENTER ≤ streamNow så vi inte inkluderar en
   * "framtida" partial-bin vars center hamnar past now.
   */
  const firstBinIdx = Math.floor(windowStart / binDurationMicros);
  const lastBinIdx = Math.floor((inputs.streamNowMicros - binDurationMicros / 2) / binDurationMicros);
  const numBins = Math.max(0, lastBinIdx - firstBinIdx + 1);

  type Accum = { peakAmp: number; pwSum: number; count: number };
  const accums: Record<'A' | 'B' | 'C' | 'D', Accum[]> = {
    A: makeAccums(numBins),
    B: makeAccums(numBins),
    C: makeAccums(numBins),
    D: makeAccums(numBins),
  };

  // Drift-free time-axis: använd dispatch.dispatchedAtMicros (wall-time vid emit)
  // istället för descriptor.startTimeMicros (kumulativ logisk tid från runner).
  // Runner's await sleep är inte perfekt-exakt → logisk stream-time släpar
  // efter wall-time över långa körningar (~30ms/s drift). Det syns som att
  // hela envelope-grafen "flyttas till vänster" trots att pulser kommer.
  // Matchar polar-frame fix från NeoDK-context-update 2026-05-02.
  for (const dispatch of inputs.dispatched) {
    const descriptorStreamTime = streamTime(
      dispatch.descriptor.startTimeMicros,
      inputs.streamOriginMicros,
    );
    // Wall-aligned stream-time = wall-elapsed-since-origin (drift-fri,
    // samma skala som streamNow eftersom streamNow också är wall-derived)
    const dispatchAligned = dispatch.dispatchedAtMicros - inputs.streamOriginWallMicros;
    const descriptorEndAligned =
      dispatchAligned +
      dispatch.descriptor.nrOfPulses * dispatch.descriptor.paceQuarterMs * 250;
    if (descriptorEndAligned < windowStart) continue;
    if (dispatchAligned > inputs.streamNowMicros) continue;

    const pulses = expandDescriptor(
      dispatch.descriptor,
      descriptorStreamTime,
    );

    for (const pulse of pulses) {
      // Konvertera logisk pulse-tid till wall-aligned via intra-burst-offset
      // (offset:en inom en descriptor är firmware-precis, ingen drift där).
      const intraBurstOffset = pulse.streamTimeMicros - descriptorStreamTime;
      const pulseAligned = dispatchAligned + intraBurstOffset;
      if (pulseAligned < windowStart) continue;
      if (pulseAligned > inputs.streamNowMicros) continue;

      const absBinIdx = Math.floor(pulseAligned / binDurationMicros);
      const binIdx = absBinIdx - firstBinIdx;
      if (binIdx < 0 || binIdx >= numBins) continue;

      // Wire-truth: descriptor.amplitude byte (0..255) som går på protokollet.
      // Per eng-review 2026-05-02: ampNorm = wire-byte / 255, INTE Vcap-telemetri.
      const ampNorm = clamp01(pulse.descriptorAmplitude / 255);
      const pwNorm = clamp01((pulse.pulseWidthMicros - 2) / 198);

      const elcon: Elcon = pulse.elcon;
      const activeMask = elcon[0] | elcon[1];
      if ((elcon[0] & elcon[1]) !== 0) continue;

      for (const def of ELECTRODE_DEFS) {
        if ((activeMask & def.bit) === 0) continue;
        const acc = accums[def.electrode][binIdx]!;
        if (ampNorm > acc.peakAmp) acc.peakAmp = ampNorm;
        acc.pwSum += pwNorm;
        acc.count += 1;
      }
    }
  }

  const rows: EnvelopeRow[] = ELECTRODE_DEFS.map((def) => {
    const accumRow = accums[def.electrode];
    const bins: EnvelopeBin[] = accumRow.map((acc, idx) => ({
      // Absolut stream-time för bin-center — stabil mellan frames
      streamTimeMicros: (firstBinIdx + idx) * binDurationMicros + binDurationMicros / 2,
      ampNorm: acc.peakAmp,
      pwNorm: acc.count > 0 ? acc.pwSum / acc.count : 0,
      pulseCount: acc.count,
    }));
    return { electrode: def.electrode, bins };
  });

  return {
    streamNowMicros: inputs.streamNowMicros,
    windowMicros,
    binDurationMicros,
    rows,
  };
}

function makeAccums(n: number): { peakAmp: number; pwSum: number; count: number }[] {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = { peakAmp: 0, pwSum: 0, count: 0 };
  return arr;
}

function emptyRows(windowStart: number, streamNow: number, binDuration: number): EnvelopeRow[] {
  const firstBinIdx = Math.floor(windowStart / binDuration);
  const lastBinIdx = Math.floor((streamNow - binDuration / 2) / binDuration);
  const numBins = Math.max(0, lastBinIdx - firstBinIdx + 1);
  return ELECTRODE_DEFS.map((def) => ({
    electrode: def.electrode,
    bins: Array.from({ length: numBins }, (_, idx) => ({
      streamTimeMicros: (firstBinIdx + idx) * binDuration + binDuration / 2,
      ampNorm: 0,
      pwNorm: 0,
      pulseCount: 0,
    })),
  }));
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/**
 * Replay-validation framework — jämför två RecordedPulse[] med tolerance-band.
 *
 * Per outside-voice finding #1 (α2 design-doc): JS event-loop jitter på Windows
 * är upp till 16ms, så strikt byte-match är inte realistiskt. Tolerance bands
 * ±50µs timing och ±50µs width matchar real-world hardware-spridning.
 *
 * Topology-not: patterns312/*.csv är ET-312-inspelningar som inte mappar 1:1
 * mot NeoDK-output. Stage-kolumnen och Vprim utelämnas medvetet från
 * jämförelsen — bara timing/phase/seqNr-strukturen valideras.
 *
 * Använd:
 *   - Self-consistency: runner→mock→csv→parse → samma pace/width-stream
 *   - Future hardware-recorded golden refs när NeoDK landar (β-prep)
 */
import type { RecordedPulse } from './csv-format';

export interface ReplayTolerance {
  /** ±µs accept för pulse timestamp */
  readonly timingMicros: number;
  /** ±µs accept för pulse width */
  readonly widthMicros: number;
}

/** Outside-voice #1: ±50µs timing + ±50µs width för all replay. */
export const DEFAULT_TOLERANCE: ReplayTolerance = {
  timingMicros: 50,
  widthMicros: 50,
};

export type MismatchField =
  | 'count'
  | 'phase'
  | 'seqNr'
  | 'timestamp'
  | 'width';

export interface ReplayMismatch {
  /** Pulse-index i båda arrays (-1 för count-mismatch). */
  readonly index: number;
  readonly field: MismatchField;
  readonly expected: number;
  readonly actual: number;
  /** Beräknad delta (för numeriska fält). */
  readonly delta?: number;
}

export interface ReplayMatchReport {
  readonly matched: boolean;
  readonly totalExpected: number;
  readonly totalActual: number;
  readonly matchedPulses: number;
  readonly mismatches: readonly ReplayMismatch[];
}

/**
 * Validera att `actual` matchar `expected` inom tolerance.
 *
 * Matched fields:
 *   - phase (strikt)
 *   - seqNr (strikt — krav: båda har sekventiell ordning)
 *   - timestampMicros (±tolerance.timingMicros)
 *   - widthMicros (±tolerance.widthMicros)
 *
 * Skip:ade fields (topologi-skillnad ET-312/NeoDK):
 *   - stage (NeoDK 'A' vs ET-312 'A'/'B' har olika semantik)
 *   - vprimMv (mock är amplitude-byte-proxy, ej real measurement)
 *
 * Count-mismatch ger early-return med en (index=-1, field='count') mismatch.
 */
export function validateReplay(
  expected: readonly RecordedPulse[],
  actual: readonly RecordedPulse[],
  tolerance: ReplayTolerance = DEFAULT_TOLERANCE,
): ReplayMatchReport {
  if (expected.length !== actual.length) {
    return {
      matched: false,
      totalExpected: expected.length,
      totalActual: actual.length,
      matchedPulses: 0,
      mismatches: [
        {
          index: -1,
          field: 'count',
          expected: expected.length,
          actual: actual.length,
        },
      ],
    };
  }

  const mismatches: ReplayMismatch[] = [];
  let matchedPulses = 0;

  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const a = actual[i]!;
    let pulseMatched = true;

    // Phase: strikt match — biphasic-strukturen ska bevaras
    if (e.phase !== a.phase) {
      mismatches.push({
        index: i,
        field: 'phase',
        expected: e.phase,
        actual: a.phase,
      });
      pulseMatched = false;
    }

    // SeqNr: strikt match — sekventiell ordning ska bevaras
    if (e.seqNr !== a.seqNr) {
      mismatches.push({
        index: i,
        field: 'seqNr',
        expected: e.seqNr,
        actual: a.seqNr,
        delta: a.seqNr - e.seqNr,
      });
      pulseMatched = false;
    }

    // Timestamp: tolerance-band
    const tsDelta = Math.abs(e.timestampMicros - a.timestampMicros);
    if (tsDelta > tolerance.timingMicros) {
      mismatches.push({
        index: i,
        field: 'timestamp',
        expected: e.timestampMicros,
        actual: a.timestampMicros,
        delta: tsDelta,
      });
      pulseMatched = false;
    }

    // Width: tolerance-band
    const wDelta = Math.abs(e.widthMicros - a.widthMicros);
    if (wDelta > tolerance.widthMicros) {
      mismatches.push({
        index: i,
        field: 'width',
        expected: e.widthMicros,
        actual: a.widthMicros,
        delta: wDelta,
      });
      pulseMatched = false;
    }

    if (pulseMatched) matchedPulses++;
  }

  return {
    matched: mismatches.length === 0,
    totalExpected: expected.length,
    totalActual: actual.length,
    matchedPulses,
    mismatches,
  };
}

/** Format en human-readable summary av mismatch-rapporten (för test-fel). */
export function formatReplayReport(report: ReplayMatchReport): string {
  if (report.matched) {
    return `OK: ${report.matchedPulses}/${report.totalExpected} pulses matched within tolerance`;
  }
  const lines: string[] = [
    `FAIL: ${report.matchedPulses}/${report.totalExpected} matched, ${report.mismatches.length} mismatches`,
  ];
  // Visa upp till 5 första mismatches för debug
  for (const m of report.mismatches.slice(0, 5)) {
    const deltaStr = m.delta !== undefined ? ` (Δ=${m.delta})` : '';
    lines.push(
      `  pulse[${m.index}].${m.field}: expected=${m.expected}, actual=${m.actual}${deltaStr}`,
    );
  }
  if (report.mismatches.length > 5) {
    lines.push(`  ... ${report.mismatches.length - 5} more`);
  }
  return lines.join('\n');
}

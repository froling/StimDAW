import { test, expect } from 'bun:test';
import {
  validateReplay,
  formatReplayReport,
  DEFAULT_TOLERANCE,
} from '../../src/patterns/replay-validate';
import type { RecordedPulse } from '../../src/patterns/csv-format';

function pulse(overrides: Partial<RecordedPulse> = {}): RecordedPulse {
  return {
    stage: 'A',
    seqNr: 0,
    timestampMicros: 0,
    phase: 0,
    widthMicros: 144,
    vprimMv: 2400,
    ...overrides,
  };
}

test('validateReplay: identiska arrays matchar', () => {
  const pulses = [pulse({ seqNr: 0 }), pulse({ seqNr: 1, phase: 1 })];
  const report = validateReplay(pulses, pulses);
  expect(report.matched).toBe(true);
  expect(report.matchedPulses).toBe(2);
  expect(report.mismatches).toEqual([]);
});

test('validateReplay: count-mismatch returnerar early', () => {
  const expected = [pulse({ seqNr: 0 })];
  const actual = [pulse({ seqNr: 0 }), pulse({ seqNr: 1 })];
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(false);
  expect(report.mismatches.length).toBe(1);
  expect(report.mismatches[0]?.field).toBe('count');
  expect(report.mismatches[0]?.index).toBe(-1);
});

test('validateReplay: timing inom tolerance accepteras', () => {
  const expected = [pulse({ seqNr: 0, timestampMicros: 1000 })];
  const actual = [pulse({ seqNr: 0, timestampMicros: 1040 })]; // +40µs, < 50µs
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(true);
});

test('validateReplay: timing utanför tolerance fail:ar', () => {
  const expected = [pulse({ seqNr: 0, timestampMicros: 1000 })];
  const actual = [pulse({ seqNr: 0, timestampMicros: 1100 })]; // +100µs > 50µs
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(false);
  expect(report.mismatches[0]?.field).toBe('timestamp');
  expect(report.mismatches[0]?.delta).toBe(100);
});

test('validateReplay: width inom tolerance accepteras', () => {
  const expected = [pulse({ widthMicros: 144 })];
  const actual = [pulse({ widthMicros: 180 })]; // +36µs < 50µs
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(true);
});

test('validateReplay: width utanför tolerance fail:ar', () => {
  const expected = [pulse({ widthMicros: 144 })];
  const actual = [pulse({ widthMicros: 250 })]; // +106µs > 50µs
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(false);
  expect(report.mismatches[0]?.field).toBe('width');
});

test('validateReplay: phase är strikt — ingen tolerance', () => {
  const expected = [pulse({ phase: 0 })];
  const actual = [pulse({ phase: 1 })];
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(false);
  expect(report.mismatches[0]?.field).toBe('phase');
});

test('validateReplay: seqNr är strikt med delta-info', () => {
  const expected = [pulse({ seqNr: 5 })];
  const actual = [pulse({ seqNr: 7 })];
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(false);
  expect(report.mismatches[0]?.field).toBe('seqNr');
  expect(report.mismatches[0]?.delta).toBe(2);
});

test('validateReplay: stage och vprim ignoreras (topology-skip)', () => {
  // ET-312-recordings har stage='A'/'B', NeoDK har 'A>C', 'AC<BD' etc.
  // Och vprim är amplitude-proxy i mock, real measurement i recordings.
  // Båda fält ska skippas i validering.
  const expected = [pulse({ stage: 'A', vprimMv: 2400 })];
  const actual = [pulse({ stage: 'A>C', vprimMv: 1500 })];
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(true);
});

test('validateReplay: multipla mismatches per puls samlas', () => {
  const expected = [pulse({ phase: 0, seqNr: 0, timestampMicros: 1000 })];
  const actual = [pulse({ phase: 1, seqNr: 5, timestampMicros: 5000 })];
  const report = validateReplay(expected, actual);
  expect(report.matched).toBe(false);
  expect(report.mismatches.length).toBe(3); // phase + seqNr + timestamp
  expect(report.matchedPulses).toBe(0);
});

test('validateReplay: custom tolerance fungerar', () => {
  // Stricter: 10µs timing
  const tight = { timingMicros: 10, widthMicros: 10 };
  const expected = [pulse({ timestampMicros: 1000 })];
  const actual = [pulse({ timestampMicros: 1040 })];

  const defaultReport = validateReplay(expected, actual, DEFAULT_TOLERANCE);
  expect(defaultReport.matched).toBe(true);

  const tightReport = validateReplay(expected, actual, tight);
  expect(tightReport.matched).toBe(false);
});

test('formatReplayReport: matched ger OK-summary', () => {
  const report = validateReplay([pulse()], [pulse()]);
  expect(formatReplayReport(report)).toContain('OK:');
  expect(formatReplayReport(report)).toContain('1/1 pulses matched');
});

test('formatReplayReport: mismatch ger detaljerad fail-summary', () => {
  const expected = [pulse({ phase: 0, timestampMicros: 1000 })];
  const actual = [pulse({ phase: 1, timestampMicros: 5000 })];
  const report = validateReplay(expected, actual);
  const summary = formatReplayReport(report);
  expect(summary).toContain('FAIL');
  expect(summary).toContain('phase');
  expect(summary).toContain('timestamp');
  expect(summary).toContain('Δ=4000');
});

test('formatReplayReport: trunc:ar mismatches > 5', () => {
  const expected = Array.from({ length: 10 }, (_, i) =>
    pulse({ seqNr: i, phase: 0 }),
  );
  const actual = Array.from({ length: 10 }, (_, i) =>
    pulse({ seqNr: i, phase: 1 }),
  );
  const report = validateReplay(expected, actual);
  expect(report.mismatches.length).toBe(10);
  const summary = formatReplayReport(report);
  expect(summary).toContain('5 more');
});

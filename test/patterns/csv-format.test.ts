import { test, expect } from 'bun:test';
import {
  CsvParseError,
  parsePatterns312Csv,
  serializePatterns312Csv,
  type RecordedPulse,
} from '../../src/patterns/csv-format';

const HEADER_NO_UNITS = '"Stage","SeqNr","Timestamp","Phase","Width","Vprim"';
const HEADER_WITH_UNITS = '"Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]"';

test('parse: tom string returnerar tom lista', () => {
  expect(parsePatterns312Csv('')).toEqual([]);
});

test('parse: bara header returnerar tom lista', () => {
  expect(parsePatterns312Csv(HEADER_WITH_UNITS)).toEqual([]);
});

test('parse: header utan units accepteras (Intense.csv-format)', () => {
  const csv = `${HEADER_NO_UNITS}\nA,647,6560335,0,143,2310`;
  const result = parsePatterns312Csv(csv);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({
    stage: 'A',
    seqNr: 647,
    timestampMicros: 6560335,
    phase: 0,
    widthMicros: 143,
    vprimMv: 2310,
  });
});

test('parse: header med units accepteras (Orgasm_*.csv-format)', () => {
  const csv = `${HEADER_WITH_UNITS}\nB,1234,8688922,1,145,1748`;
  const result = parsePatterns312Csv(csv);
  expect(result.length).toBe(1);
  expect(result[0]?.stage).toBe('B');
  expect(result[0]?.phase).toBe(1);
});

test('parse: flera rader', () => {
  const csv = [
    HEADER_WITH_UNITS,
    'A,1,1000,0,144,2400',
    'A,2,1130,1,143,2030',
    'B,3,1260,0,145,2300',
    '',
  ].join('\n');
  const result = parsePatterns312Csv(csv);
  expect(result.length).toBe(3);
  expect(result[0]?.seqNr).toBe(1);
  expect(result[2]?.stage).toBe('B');
});

test('parse: invalid header throws', () => {
  expect(() => parsePatterns312Csv('not a valid header\n1,2,3,4,5,6')).toThrow(CsvParseError);
});

test('parse: invalid stage throws med radnummer', () => {
  const csv = `${HEADER_WITH_UNITS}\nC,1,1000,0,144,2400`;
  try {
    parsePatterns312Csv(csv);
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(CsvParseError);
    if (e instanceof CsvParseError) {
      expect(e.line).toBe(2);
    }
  }
});

test('parse: invalid phase throws', () => {
  const csv = `${HEADER_WITH_UNITS}\nA,1,1000,2,144,2400`;
  expect(() => parsePatterns312Csv(csv)).toThrow(CsvParseError);
});

test('parse: non-integer field throws', () => {
  const csv = `${HEADER_WITH_UNITS}\nA,1,1000.5,0,144,2400`;
  expect(() => parsePatterns312Csv(csv)).toThrow(CsvParseError);
});

test('parse: too few fields throws', () => {
  const csv = `${HEADER_WITH_UNITS}\nA,1,1000,0,144`;
  expect(() => parsePatterns312Csv(csv)).toThrow(CsvParseError);
});

test('serialize → parse round-trip', () => {
  const pulses: RecordedPulse[] = [
    { stage: 'A', seqNr: 1, timestampMicros: 1000, phase: 0, widthMicros: 144, vprimMv: 2400 },
    { stage: 'B', seqNr: 2, timestampMicros: 2000, phase: 1, widthMicros: 143, vprimMv: 1750 },
  ];
  const csv = serializePatterns312Csv(pulses);
  expect(csv).toContain('"Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]"');
  const parsed = parsePatterns312Csv(csv);
  expect(parsed).toEqual(pulses);
});

test('parse: skippa tomma rader och whitespace', () => {
  const csv = [
    '',
    HEADER_WITH_UNITS,
    'A,1,1000,0,144,2400',
    '',
    '   ',
    'A,2,1130,1,143,2030',
    '',
  ].join('\n');
  const result = parsePatterns312Csv(csv);
  expect(result.length).toBe(2);
});

test('parse: golden — riktig Toggle.csv-rad parsas exakt', () => {
  // Direkt sample från reference/NeoDK/patterns312/Toggle.csv rad 2
  const csv = `${HEADER_NO_UNITS}\nA,647,6560335,0,143,2310`;
  const result = parsePatterns312Csv(csv);
  expect(result[0]).toEqual({
    stage: 'A',
    seqNr: 647,
    timestampMicros: 6560335,
    phase: 0,
    widthMicros: 143,
    vprimMv: 2310,
  });
});

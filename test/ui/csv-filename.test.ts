import { test, expect } from 'bun:test';
import { buildCsvFilename } from '../../src/ui/csv-filename';

const FIXED = new Date('2026-04-30T15:32:11.234Z');

test('buildCsvFilename: enkel pattern-namn slug:as till lowercase + dashes', () => {
  expect(buildCsvFilename('Toggle', FIXED)).toBe('stimdaw-toggle-20260430T153211.csv');
});

test('buildCsvFilename: spaces och multiplikations-tecken kollapsas till dash', () => {
  expect(buildCsvFilename('Toggle 300×', FIXED)).toBe('stimdaw-toggle-300-20260430T153211.csv');
});

test('buildCsvFilename: leading/trailing dashes trimmas', () => {
  expect(buildCsvFilename('--Test--', FIXED)).toBe('stimdaw-test-20260430T153211.csv');
});

test('buildCsvFilename: null/undefined → no-pattern fallback', () => {
  expect(buildCsvFilename(null, FIXED)).toBe('stimdaw-no-pattern-20260430T153211.csv');
  expect(buildCsvFilename(undefined, FIXED)).toBe('stimdaw-no-pattern-20260430T153211.csv');
});

test('buildCsvFilename: tom sträng → no-pattern fallback', () => {
  expect(buildCsvFilename('', FIXED)).toBe('stimdaw-no-pattern-20260430T153211.csv');
});

test('buildCsvFilename: bara icke-alfanumeriskt → no-pattern fallback (ej dangling dash)', () => {
  expect(buildCsvFilename('!!!', FIXED)).toBe('stimdaw-no-pattern-20260430T153211.csv');
});

test('buildCsvFilename: tidsstämpel saknar kolon, dashes och millisekunder', () => {
  const fname = buildCsvFilename('x', new Date('2026-12-31T23:59:59.999Z'));
  expect(fname).toBe('stimdaw-x-20261231T235959.csv');
  // Granska bara tidsstämpel-segmentet (mellan andra och tredje dasharna)
  const stamp = fname.split('-')[2]!.replace('.csv', '');
  expect(stamp).toBe('20261231T235959');
  expect(stamp).not.toContain(':');
  expect(stamp).not.toContain('.');
});

test('buildCsvFilename: unicode-tecken kollapsas (svenska å/ä/ö)', () => {
  // svenska tecken är inte [a-z0-9] → kollapsas till dash
  expect(buildCsvFilename('Pulsåder', FIXED)).toBe('stimdaw-puls-der-20260430T153211.csv');
});

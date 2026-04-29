import { test, expect } from 'bun:test';
import { migrate, MigrationError } from '../../src/fileformat/migrate';
import { defaultStimDAWFile } from '../../src/fileformat/schema';

test('migrate: v0 → v0 is identity', () => {
  const original = defaultStimDAWFile();
  const result = migrate(original);
  expect(result.version).toBe(0);
  expect(result.settings).toEqual(original.settings);
});

test('migrate: throws MigrationError on missing version', () => {
  expect(() => migrate({ settings: {} })).toThrow(MigrationError);
});

test('migrate: throws on non-numeric version', () => {
  expect(() => migrate({ version: '0', settings: {} })).toThrow(MigrationError);
});

test('migrate: throws on null/non-object', () => {
  expect(() => migrate(null)).toThrow(MigrationError);
  expect(() => migrate('not json')).toThrow(MigrationError);
  expect(() => migrate(42)).toThrow(MigrationError);
});

test('migrate: throws on future version', () => {
  expect(() =>
    migrate({
      version: 99,
      settings: { rampUpDurationMs: 5000, maxCeilingPercent: 50 },
    }),
  ).toThrow(MigrationError);
});

test('migrate: throws on schema-invalid input', () => {
  expect(() =>
    migrate({
      version: 0,
      settings: { rampUpDurationMs: -1, maxCeilingPercent: 50 },
    }),
  ).toThrow(MigrationError);
});

test('migrate: applies defaults when fields missing', () => {
  const result = migrate({ version: 0, settings: {}, cliHistory: [] });
  expect(result.settings.rampUpDurationMs).toBe(5000);
  expect(result.settings.maxCeilingPercent).toBe(50);
});

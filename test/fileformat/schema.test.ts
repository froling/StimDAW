import { test, expect } from 'bun:test';
import {
  CURRENT_VERSION,
  SettingsV0,
  StimDAWFile,
  StimDAWFileV0,
  defaultStimDAWFile,
} from '../../src/fileformat/schema';

test('schema: defaultStimDAWFile is valid', () => {
  const def = defaultStimDAWFile();
  const parsed = StimDAWFile.parse(def);
  expect(parsed.version).toBe(0);
  expect(parsed.settings.rampUpDurationMs).toBe(5000);
  expect(parsed.settings.maxCeilingPercent).toBe(50);
});

test('schema: settings defaults applied when fields missing', () => {
  const result = SettingsV0.parse({});
  expect(result.rampUpDurationMs).toBe(5000);
  expect(result.maxCeilingPercent).toBe(50);
});

test('schema: rejects out-of-range rampUpDuration', () => {
  expect(() => SettingsV0.parse({ rampUpDurationMs: -1 })).toThrow();
  expect(() => SettingsV0.parse({ rampUpDurationMs: 100_000 })).toThrow();
});

test('schema: rejects out-of-range ceiling', () => {
  expect(() => SettingsV0.parse({ maxCeilingPercent: 101 })).toThrow();
  expect(() => SettingsV0.parse({ maxCeilingPercent: -5 })).toThrow();
});

test('schema: rejects wrong version literal', () => {
  expect(() =>
    StimDAWFileV0.parse({ version: 1, settings: { rampUpDurationMs: 5000, maxCeilingPercent: 50 } }),
  ).toThrow();
});

test('schema: rejects rampUpDuration as float', () => {
  expect(() => SettingsV0.parse({ rampUpDurationMs: 5000.5 })).toThrow();
});

test('schema: CURRENT_VERSION is 0', () => {
  expect(CURRENT_VERSION).toBe(0);
});

test('schema: cliHistory accepts empty + capped at 200 entries', () => {
  const ok = StimDAWFileV0.parse({
    version: 0,
    settings: { rampUpDurationMs: 5000, maxCeilingPercent: 50 },
    cliHistory: Array.from({ length: 200 }, (_, i) => `/cmd${i}`),
  });
  expect(ok.cliHistory.length).toBe(200);
  expect(() =>
    StimDAWFileV0.parse({
      version: 0,
      settings: { rampUpDurationMs: 5000, maxCeilingPercent: 50 },
      cliHistory: Array.from({ length: 201 }, (_, i) => `/cmd${i}`),
    }),
  ).toThrow();
});

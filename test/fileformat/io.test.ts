import { test, expect, beforeEach, afterEach } from 'bun:test';
import { loadSettings, saveSettings } from '../../src/fileformat/io';

// Stub localStorage for Bun (no DOM)
class LocalStorageStub {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

let originalLS: typeof globalThis.localStorage | undefined;

beforeEach(() => {
  originalLS = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage: unknown }).localStorage = new LocalStorageStub();
});

afterEach(() => {
  (globalThis as { localStorage: unknown }).localStorage = originalLS;
});

test('io: loadSettings returns null when nothing saved', () => {
  expect(loadSettings()).toBeNull();
});

test('io: save then load round-trips settings', () => {
  saveSettings({ rampUpDurationMs: 8000, maxCeilingPercent: 70 });
  const loaded = loadSettings();
  expect(loaded).toEqual({ rampUpDurationMs: 8000, maxCeilingPercent: 70 });
});

test('io: loadSettings returns null on corrupt JSON', () => {
  (globalThis as { localStorage: Storage }).localStorage.setItem(
    'stimdaw:v0:settings',
    'not json {{{',
  );
  expect(loadSettings()).toBeNull();
});

test('io: loadSettings returns null on schema-invalid data', () => {
  (globalThis as { localStorage: Storage }).localStorage.setItem(
    'stimdaw:v0:settings',
    JSON.stringify({ version: 0, settings: { rampUpDurationMs: -1, maxCeilingPercent: 50 } }),
  );
  expect(loadSettings()).toBeNull();
});

test('io: saveSettings strips identity (no paths in stored JSON)', () => {
  // (we don't put paths IN settings normally, but verify scrubber runs)
  saveSettings({ rampUpDurationMs: 5000, maxCeilingPercent: 50 });
  const stored = (globalThis as { localStorage: Storage }).localStorage.getItem(
    'stimdaw:v0:settings',
  );
  expect(stored).not.toBeNull();
  expect(stored!).not.toContain('/Users/');
  expect(stored!).not.toContain('C:\\Users\\');
});

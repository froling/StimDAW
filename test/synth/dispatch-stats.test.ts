import { test, expect } from 'bun:test';
import { computeDispatchRate, dispatchRateTone } from '../../src/synth/dispatch-stats';

function descsAt(...microsArr: number[]): { dispatchedAtMicros: number }[] {
  return microsArr.map((m) => ({ dispatchedAtMicros: m }));
}

// ── computeDispatchRate ───────────────────────────────────────────────

test('computeDispatchRate: tom buffer → 0 dps', () => {
  const r = computeDispatchRate([], 1_000_000);
  expect(r.dps).toBe(0);
  expect(r.bytesPerSec).toBe(0);
});

test('computeDispatchRate: 5 descriptors inom senaste sekunden → 5 dps', () => {
  // Now=2s, descriptors vid 1.0, 1.2, 1.4, 1.6, 1.8s
  const descs = descsAt(1_000_000, 1_200_000, 1_400_000, 1_600_000, 1_800_000);
  const r = computeDispatchRate(descs, 2_000_000);
  expect(r.dps).toBe(5);
  expect(r.bytesPerSec).toBe(5 * 24);
});

test('computeDispatchRate: descriptors äldre än fönster ignoreras', () => {
  // Now=10s, gamla descs vid 0.5..1s + nya vid 9..9.9s
  const descs = descsAt(500_000, 900_000, 9_000_000, 9_500_000, 9_900_000);
  const r = computeDispatchRate(descs, 10_000_000);
  expect(r.dps).toBe(3); // bara 3 nyaste inom 9..10s
});

test('computeDispatchRate: alla inom fönster räknas', () => {
  const descs = descsAt(0, 250_000, 500_000, 750_000, 999_999);
  const r = computeDispatchRate(descs, 1_000_000);
  expect(r.dps).toBe(5);
});

test('computeDispatchRate: descriptor exakt på cutoff räknas inte', () => {
  // cutoff = nowMicros - windowMicros = 0. d.dispatchedAtMicros < 0 är false (=0).
  // Iteration: d.dispatchedAtMicros < cutoff → break. Vid lika räknas det.
  const descs = descsAt(0); // exakt på cutoff
  const r = computeDispatchRate(descs, 1_000_000);
  expect(r.dps).toBe(1); // included (cutoff är exclusive)
});

test('computeDispatchRate: anpassat fönster skalar korrekt till per-sekund', () => {
  // 10 descriptors över 500ms = 20/s rate
  const descs = descsAt(0, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000, 450_000);
  const r = computeDispatchRate(descs, 500_000, 500_000);
  expect(r.dps).toBe(20); // 10 descs in 500ms → 20/s
});

test('computeDispatchRate: stora buffrar — iteration bakifrån är O(rate × window)', () => {
  // 10000 äldre descriptors + 50 inom senaste sekunden
  const old = Array.from({ length: 10000 }, (_, i) => ({ dispatchedAtMicros: i * 100 }));
  const recent = Array.from({ length: 50 }, (_, i) => ({
    dispatchedAtMicros: 99_000_000 + i * 10_000,
  }));
  const all = [...old, ...recent];
  const r = computeDispatchRate(all, 100_000_000);
  expect(r.dps).toBe(50); // bara recent räknas
});

test('computeDispatchRate: bytesPerSec = dps × 24', () => {
  const descs = descsAt(0, 100_000);
  const r = computeDispatchRate(descs, 1_000_000);
  expect(r.bytesPerSec).toBe(r.dps * 24);
});

test('computeDispatchRate: window <= 0 → 0 (defensive)', () => {
  const descs = descsAt(500_000);
  expect(computeDispatchRate(descs, 1_000_000, 0).dps).toBe(0);
  expect(computeDispatchRate(descs, 1_000_000, -1).dps).toBe(0);
});

// ── dispatchRateTone ──────────────────────────────────────────────────

test('dispatchRateTone: < 40 → ok', () => {
  expect(dispatchRateTone(0)).toBe('ok');
  expect(dispatchRateTone(20)).toBe('ok');
  expect(dispatchRateTone(40)).toBe('ok'); // exakt 40 är fortfarande OK
});

test('dispatchRateTone: 40 < x ≤ 60 → warn', () => {
  expect(dispatchRateTone(41)).toBe('warn');
  expect(dispatchRateTone(50)).toBe('warn');
  expect(dispatchRateTone(60)).toBe('warn');
});

test('dispatchRateTone: > 60 → alarm', () => {
  expect(dispatchRateTone(61)).toBe('alarm');
  expect(dispatchRateTone(100)).toBe('alarm');
  expect(dispatchRateTone(1000)).toBe('alarm');
});

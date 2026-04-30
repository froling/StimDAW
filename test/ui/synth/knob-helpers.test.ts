import { test, expect } from 'bun:test';
import {
  tToValue,
  valueToT,
  dragDeltaToValue,
  formatKnobValue,
} from '../../../src/ui/synth/knob-helpers';
import {
  PULSE_WIDTH_BOUNDS,
  PACE_BOUNDS,
  AMPLITUDE_BOUNDS,
} from '../../../src/protocol/hardware-bounds';

// ── Linear scale ──────────────────────────────────────────────────

test('tToValue linear: t=0 → min', () => {
  expect(tToValue(0, PULSE_WIDTH_BOUNDS)).toBe(2);
});

test('tToValue linear: t=1 → max', () => {
  expect(tToValue(1, PULSE_WIDTH_BOUNDS)).toBe(200);
});

test('tToValue linear: t=0.5 → midpoint', () => {
  expect(tToValue(0.5, PULSE_WIDTH_BOUNDS)).toBe(101);
});

test('tToValue linear: clamps t utanför [0, 1]', () => {
  expect(tToValue(-0.5, PULSE_WIDTH_BOUNDS)).toBe(2);
  expect(tToValue(2, PULSE_WIDTH_BOUNDS)).toBe(200);
});

// ── Log scale (för pace) ──────────────────────────────────────────

test('tToValue log: t=0 → PACE_MIN (5ms)', () => {
  expect(tToValue(0, PACE_BOUNDS, { log: true })).toBeCloseTo(5_000, 5);
});

test('tToValue log: t=1 → PACE_MAX (62.5ms)', () => {
  expect(tToValue(1, PACE_BOUNDS, { log: true })).toBeCloseTo(62_500, 5);
});

test('tToValue log: t=0.5 → geometric mean (√(min × max))', () => {
  // √(5000 × 62500) = √312_500_000 ≈ 17677.7
  const expected = Math.sqrt(5_000 * 62_500);
  expect(tToValue(0.5, PACE_BOUNDS, { log: true })).toBeCloseTo(expected, 1);
});

test('tToValue log: 50% drag-position ger användbar mid-pace', () => {
  // Confirma att log-scale ger ~17.7ms vid mitten av drag
  const midPace = tToValue(0.5, PACE_BOUNDS, { log: true });
  expect(midPace).toBeGreaterThan(15_000); // > 15ms
  expect(midPace).toBeLessThan(20_000); // < 20ms
});

// ── valueToT (inverse) ────────────────────────────────────────────

test('valueToT linear: 144µs i [2..200] → 0.7172', () => {
  expect(valueToT(144, PULSE_WIDTH_BOUNDS)).toBeCloseTo(0.7172, 3);
});

test('valueToT log: 25ms i [5..62.5ms] → 0.6826...', () => {
  // ln(25000) - ln(5000) / (ln(62500) - ln(5000))
  // = ln(5) / ln(12.5) ≈ 1.6094 / 2.5257 ≈ 0.637
  expect(valueToT(25_000, PACE_BOUNDS, { log: true })).toBeCloseTo(0.637, 2);
});

test('valueToT roundtrip: tToValue och valueToT är inverser', () => {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const v = tToValue(t, PACE_BOUNDS, { log: true });
    expect(valueToT(v, PACE_BOUNDS, { log: true })).toBeCloseTo(t, 5);
  }
});

// ── dragDeltaToValue ──────────────────────────────────────────────

test('dragDeltaToValue: upp (negative deltaY) ökar värdet', () => {
  const newV = dragDeltaToValue(100, -50, PULSE_WIDTH_BOUNDS);
  expect(newV).toBeGreaterThan(100);
});

test('dragDeltaToValue: ned (positive deltaY) minskar värdet', () => {
  const newV = dragDeltaToValue(100, 50, PULSE_WIDTH_BOUNDS);
  expect(newV).toBeLessThan(100);
});

test('dragDeltaToValue: full-drag (200px) → ~full-range-delta', () => {
  // Default sensitivity 200px för full range
  // Från 2 (min) till 200 (max) är delta=198. -200px deltaY = +1.0 t
  const newV = dragDeltaToValue(2, -200, PULSE_WIDTH_BOUNDS);
  expect(newV).toBeCloseTo(200, 0);
});

test('dragDeltaToValue: Shift fine-grain ger 10× mindre delta', () => {
  const normal = dragDeltaToValue(100, -20, PULSE_WIDTH_BOUNDS);
  const fine = dragDeltaToValue(100, -20, PULSE_WIDTH_BOUNDS, { fineGrain: true });
  expect(normal - 100).toBeGreaterThan(fine - 100);
  // Fine ger ungefär 1/10 av delta
  expect((fine - 100) * 10).toBeCloseTo(normal - 100, 1);
});

test('dragDeltaToValue: clampar till bounds', () => {
  // Stor upp-drag från max ska clampa
  expect(dragDeltaToValue(200, -1000, PULSE_WIDTH_BOUNDS)).toBe(200);
  // Stor ned-drag från min ska clampa
  expect(dragDeltaToValue(2, 1000, PULSE_WIDTH_BOUNDS)).toBe(2);
});

test('dragDeltaToValue log-scale: drag-delta är jämn i log-rummet', () => {
  // Test att log-scale gör knob användbar över hela pace-range
  // Vid mid-värde (~17.7ms), 100px drag ska inte hoppa till min/max
  const mid = tToValue(0.5, PACE_BOUNDS, { log: true });
  const after = dragDeltaToValue(mid, -100, PACE_BOUNDS, { log: true });
  expect(after).toBeGreaterThan(mid);
  expect(after).toBeLessThan(PACE_BOUNDS.max);
});

// ── formatKnobValue ──────────────────────────────────────────────

test('formatKnobValue: us format', () => {
  const f = formatKnobValue(144, 'us');
  expect(f.display).toBe('144');
  expect(f.suffix).toBe('µs');
});

test('formatKnobValue: ms format med en decimal', () => {
  expect(formatKnobValue(25_000, 'ms')).toEqual({ display: '25.0', suffix: 'ms' });
  expect(formatKnobValue(7_000, 'ms')).toEqual({ display: '7.0', suffix: 'ms' });
});

test('formatKnobValue: percent från 0..255 → 0..100 (amp-byte)', () => {
  expect(formatKnobValue(0, 'percent')).toEqual({ display: '0', suffix: '%' });
  expect(formatKnobValue(128, 'percent')).toEqual({ display: '50', suffix: '%' });
  expect(formatKnobValue(255, 'percent')).toEqual({ display: '100', suffix: '%' });
});

test('formatKnobValue: fraction från 0..1 → 0..100 (LFO amount, cable depth)', () => {
  expect(formatKnobValue(0, 'fraction')).toEqual({ display: '0', suffix: '%' });
  expect(formatKnobValue(0.5, 'fraction')).toEqual({ display: '50', suffix: '%' });
  expect(formatKnobValue(0.8, 'fraction')).toEqual({ display: '80', suffix: '%' });
  expect(formatKnobValue(1, 'fraction')).toEqual({ display: '100', suffix: '%' });
});

test('formatKnobValue: hz format med två decimaler', () => {
  expect(formatKnobValue(1.5, 'hz')).toEqual({ display: '1.50', suffix: 'Hz' });
});

// ── Realistic knob scenarios ──────────────────────────────────────

test('Realistic: pulse_width knob default 144µs vid t≈0.717', () => {
  expect(valueToT(144, PULSE_WIDTH_BOUNDS)).toBeCloseTo(0.7172, 3);
});

test('Realistic: pace knob log-scale, 25ms default vid t≈0.637', () => {
  expect(valueToT(25_000, PACE_BOUNDS, { log: true })).toBeCloseTo(0.637, 2);
});

test('Realistic: amplitude knob default 128 vid t=0.502', () => {
  expect(valueToT(128, AMPLITUDE_BOUNDS)).toBeCloseTo(0.502, 2);
});

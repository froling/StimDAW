import { test, expect } from 'bun:test';
import { sine, saw, sawDown, square, triangle, getWaveform } from '../../src/synth/waveforms';

const PI = Math.PI;
const TWO_PI = PI * 2;

// ── sine ────────────────────────────────────────────────────────────

test('sine: principal values', () => {
  expect(sine(0)).toBeCloseTo(0, 10);
  expect(sine(PI / 2)).toBeCloseTo(1, 10);
  expect(sine(PI)).toBeCloseTo(0, 10);
  expect(sine(3 * PI / 2)).toBeCloseTo(-1, 10);
  expect(sine(TWO_PI)).toBeCloseTo(0, 10);
});

test('sine: outputs i [-1, +1] över full cycle', () => {
  for (let i = 0; i < 100; i++) {
    const v = sine((i / 100) * TWO_PI);
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  }
});

test('sine: cyklisk — sine(t) === sine(t + 2π)', () => {
  for (const t of [0, PI / 4, PI / 2, PI, 3.7]) {
    expect(sine(t)).toBeCloseTo(sine(t + TWO_PI), 10);
  }
});

// ── saw ─────────────────────────────────────────────────────────────

test('saw: monotont stigande inom cykel (-1 → +1)', () => {
  expect(saw(0)).toBeCloseTo(-1, 10);
  expect(saw(PI / 2)).toBeCloseTo(-0.5, 10);
  expect(saw(PI)).toBeCloseTo(0, 10);
  expect(saw(3 * PI / 2)).toBeCloseTo(0.5, 10);
});

test('saw: wrap vid 2π återställer till -1', () => {
  // Just under 2π → +1 - epsilon
  expect(saw(TWO_PI - 0.0001)).toBeGreaterThan(0.99);
  // Just over 2π → starts over near -1
  expect(saw(TWO_PI + 0.0001)).toBeCloseTo(-1, 4);
});

test('saw: negativ phase wrappar korrekt', () => {
  expect(saw(-PI)).toBeCloseTo(0, 10); // -π ≡ π
  expect(saw(-TWO_PI)).toBeCloseTo(-1, 10); // -2π ≡ 0
});

// ── sawDown ─────────────────────────────────────────────────────────

test('sawDown: monotont fallande inom cykel (+1 → -1)', () => {
  expect(sawDown(0)).toBeCloseTo(1, 10);
  expect(sawDown(PI / 2)).toBeCloseTo(0.5, 10);
  expect(sawDown(PI)).toBeCloseTo(0, 10);
  expect(sawDown(3 * PI / 2)).toBeCloseTo(-0.5, 10);
});

test('sawDown: wrap vid 2π återställer till +1', () => {
  expect(sawDown(TWO_PI - 0.0001)).toBeLessThan(-0.99);
  expect(sawDown(TWO_PI + 0.0001)).toBeCloseTo(1, 4);
});

test('sawDown: spegel av saw runt y-axeln (sawDown(t) === -saw(t))', () => {
  for (const t of [0.1, PI / 4, PI / 2, PI, 4.5, 5.8]) {
    expect(sawDown(t)).toBeCloseTo(-saw(t), 10);
  }
});

test('sawDown: outputs i [-1, +1] över full cycle', () => {
  for (let i = 0; i < 100; i++) {
    const v = sawDown((i / 100) * TWO_PI);
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  }
});

// ── square ──────────────────────────────────────────────────────────

test('square: +1 i första halvan, -1 i andra halvan', () => {
  expect(square(0)).toBe(1);
  expect(square(PI / 4)).toBe(1);
  expect(square(PI - 0.001)).toBe(1);
  expect(square(PI)).toBe(-1); // π exakt → andra halvan
  expect(square(3 * PI / 2)).toBe(-1);
  expect(square(TWO_PI - 0.001)).toBe(-1);
});

test('square: outputs alltid ±1', () => {
  for (let i = 0; i < 100; i++) {
    const v = square((i / 100) * TWO_PI);
    expect(Math.abs(v)).toBe(1);
  }
});

// ── triangle ────────────────────────────────────────────────────────

test('triangle: peaks och valleys', () => {
  expect(triangle(0)).toBeCloseTo(0, 10);
  expect(triangle(PI / 2)).toBeCloseTo(1, 10); // peak vid π/2 (t=0.25)
  expect(triangle(PI)).toBeCloseTo(0, 10);
  // 3π/2 ger t≈0.7499999... pga float — precision 4 räcker för att verifiera
  expect(triangle(3 * PI / 2)).toBeCloseTo(-1, 4); // valley vid 3π/2 (t=0.75)
  expect(triangle(TWO_PI - 0.0001)).toBeCloseTo(0, 3);
});

test('triangle: linjär rising och falling', () => {
  // t=0..0.25: linjär 0 → 1
  expect(triangle(PI / 4)).toBeCloseTo(0.5, 10);
  // t=0.25..0.75: linjär 1 → -1
  expect(triangle(PI)).toBeCloseTo(0, 10);
});

test('triangle: outputs i [-1, +1] över full cycle', () => {
  for (let i = 0; i < 100; i++) {
    const v = triangle((i / 100) * TWO_PI);
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  }
});

// ── getWaveform dispatcher ──────────────────────────────────────────

test('getWaveform: returnerar rätt funktion per shape-string', () => {
  expect(getWaveform('sine')(PI / 2)).toBeCloseTo(1, 10);
  expect(getWaveform('saw')(0)).toBeCloseTo(-1, 10);
  expect(getWaveform('saw-down')(0)).toBeCloseTo(1, 10);
  expect(getWaveform('square')(0)).toBe(1);
  expect(getWaveform('triangle')(PI / 2)).toBeCloseTo(1, 10);
});

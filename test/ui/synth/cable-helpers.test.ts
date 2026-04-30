import { test, expect } from 'bun:test';
import {
  bezierPath,
  bezierMidpoint,
  lfoColor,
  lfoColorAndLabel,
  LFO_COLOR_PALETTE,
} from '../../../src/ui/synth/cable-helpers';

// ── bezierPath ────────────────────────────────────────────────────

test('bezierPath: producerar gilltigt SVG d-string', () => {
  const d = bezierPath(0, 0, 100, 100);
  expect(d).toMatch(/^M[\d.,]+ C[\d.,]+ [\d.,]+ [\d.,]+$/);
  expect(d.startsWith('M0.00,0.00')).toBe(true);
  expect(d.endsWith('100.00,100.00')).toBe(true);
});

test('bezierPath: control points på 1/3 + 2/3 av delta med sag', () => {
  // (0,0) → (90, 60) med sag=12
  // cx1 = 0 + 90/3 = 30, cy1 = 0 + 60/3 + 12 = 32
  // cx2 = 0 + 60 = 60, cy2 = 0 + 40 + 12 = 52
  const d = bezierPath(0, 0, 90, 60, 12);
  expect(d).toContain('30.00,32.00');
  expect(d).toContain('60.00,52.00');
});

test('bezierPath: sag=0 ger raka linje (controls på diagonal)', () => {
  const d = bezierPath(0, 0, 90, 60, 0);
  // Med sag=0, cy1 = 20 (1/3 av 60), cy2 = 40
  expect(d).toContain('30.00,20.00');
  expect(d).toContain('60.00,40.00');
});

test('bezierPath: vertical port-to-port (samma x)', () => {
  const d = bezierPath(50, 10, 50, 100, 5);
  // dx=0 → cx1=cx2=50; cy1=10+30+5=45, cy2=10+60+5=75
  expect(d).toContain('M50.00,10.00');
  expect(d).toContain('50.00,45.00');
  expect(d).toContain('50.00,75.00');
});

// ── bezierMidpoint ──────────────────────────────────────────────────

test('bezierMidpoint: mid x = (x1+x2)/2, y = mid + (3/4)*sag', () => {
  const m = bezierMidpoint(0, 0, 100, 100, 8);
  expect(m.x).toBe(50);
  expect(m.y).toBeCloseTo(56, 5); // 50 + (3/4)*8 = 50 + 6 = 56
});

test('bezierMidpoint: sag=0 → exakt geometric mid', () => {
  const m = bezierMidpoint(0, 0, 100, 100, 0);
  expect(m.x).toBe(50);
  expect(m.y).toBe(50);
});

// ── lfoColor palette ───────────────────────────────────────────────

test('lfoColor: index 0..3 ger 4 distinkta färger', () => {
  expect(lfoColor(0)).toBe('#dd3388'); // L1 magenta
  expect(lfoColor(1)).toBe('#22aacc'); // L2 cyan
  expect(lfoColor(2)).toBe('#ddaa22'); // L3 yellow
  expect(lfoColor(3)).toBe('#66bb66'); // L4 green
});

test('lfoColor: wrappar modulo över 4', () => {
  expect(lfoColor(4)).toBe(lfoColor(0));
  expect(lfoColor(5)).toBe(lfoColor(1));
  expect(lfoColor(8)).toBe(lfoColor(0));
});

test('lfoColor: negativt index → fallback grå', () => {
  expect(lfoColor(-1)).toBe('#888');
});

test('LFO_COLOR_PALETTE: exakt 4 färger', () => {
  expect(LFO_COLOR_PALETTE.length).toBe(4);
});

// ── lfoColorAndLabel ──────────────────────────────────────────────

test('lfoColorAndLabel: hittar LFO och returnerar L1/L2 label', () => {
  const lfos = [{ id: 'lfo-a' }, { id: 'lfo-b' }, { id: 'lfo-c' }];
  expect(lfoColorAndLabel(lfos, 'lfo-a')).toEqual({ color: '#dd3388', label: 'L1' });
  expect(lfoColorAndLabel(lfos, 'lfo-b')).toEqual({ color: '#22aacc', label: 'L2' });
  expect(lfoColorAndLabel(lfos, 'lfo-c')).toEqual({ color: '#ddaa22', label: 'L3' });
});

test('lfoColorAndLabel: obefintlig LFO → fallback', () => {
  const lfos = [{ id: 'lfo-a' }];
  expect(lfoColorAndLabel(lfos, 'ghost')).toEqual({ color: '#888', label: '?' });
});

test('lfoColorAndLabel: tom lista', () => {
  expect(lfoColorAndLabel([], 'anything')).toEqual({ color: '#888', label: '?' });
});

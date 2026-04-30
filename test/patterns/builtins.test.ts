import { test, expect } from 'bun:test';
import {
  Circle,
  CrossToggle,
  Jackhammer,
  ScratchThatItch,
  Toggle,
  builtinPatterns,
  getPatternByName,
} from '../../src/patterns/builtins';
import { checkPattern } from '../../src/patterns/validate';
import { uniqueElcons } from '../../src/patterns/types';

test('alla 5 builtin patterns valideras OK (disjunkts-rule)', () => {
  for (const p of builtinPatterns) {
    expect(() => checkPattern(p)).not.toThrow();
  }
});

test('Jackhammer: 2 elcons, MAX pace, 200 reps', () => {
  expect(Jackhammer.elcons.length).toBe(2);
  expect(Jackhammer.nrOfReps).toBe(200);
  expect(Jackhammer.paceMicros).toBe(7000);
  // Symmetrisk: AC↔BD följt av BD↔AC
  expect(Jackhammer.elcons[0]).toEqual([5, 10]); // AC=5, BD=10
  expect(Jackhammer.elcons[1]).toEqual([10, 5]);
});

test('Toggle: 6 elcons (4 unika), 25ms pace, 300 reps', () => {
  expect(Toggle.elcons.length).toBe(6);
  expect(uniqueElcons(Toggle.elcons).length).toBe(4);
  expect(Toggle.paceMicros).toBe(25_000);
  expect(Toggle.nrOfReps).toBe(300);
});

test('CrossToggle: 4 elcons (alla unika)', () => {
  expect(CrossToggle.elcons.length).toBe(4);
  expect(uniqueElcons(CrossToggle.elcons).length).toBe(4);
});

test('Circle: 18 elcons (alla unika), 30ms pace', () => {
  expect(Circle.elcons.length).toBe(18);
  expect(uniqueElcons(Circle.elcons).length).toBe(18);
  expect(Circle.paceMicros).toBe(30_000);
});

test('ScratchThatItch: 12 elcons, 8ms pace, 5000 reps (streaming-stress)', () => {
  expect(ScratchThatItch.elcons.length).toBe(12);
  expect(ScratchThatItch.paceMicros).toBe(8_000);
  expect(ScratchThatItch.nrOfReps).toBe(5000);
});

test('getPatternByName: lookup', () => {
  expect(getPatternByName('Toggle')).toBe(Toggle);
  expect(getPatternByName('Jackhammer')).toBe(Jackhammer);
  expect(getPatternByName('Scratch that itch')).toBe(ScratchThatItch);
  expect(getPatternByName('NotAPattern')).toBeUndefined();
});

test('builtinPatterns: alla 5 listade i exportad order', () => {
  expect(builtinPatterns.length).toBe(5);
  expect(builtinPatterns.map((p) => p.name)).toEqual([
    'Jackhammer',
    'Toggle',
    'CrossToggle',
    'Circle',
    'Scratch that itch',
  ]);
});

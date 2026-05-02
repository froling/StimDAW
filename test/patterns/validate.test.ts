import { test, expect } from 'bun:test';
import {
  PatternValidationError,
  checkElcon,
  checkPattern,
  isValidPattern,
  isElconHardwareValid,
} from '../../src/patterns/validate';
import { ElectrodeMask } from '../../src/patterns/types';
import type { PatternDef } from '../../src/patterns/types';

test('checkElcon: hardware-valid buddy-pair-konfigurationer passar', () => {
  // De 9 unika valid (pos,neg)-konfigurationerna per NeoDK switch matrix
  // (en sida ⊆ {A,C}, andra sida ⊆ {B,D}).
  const valid = [
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.A, ElectrodeMask.D],
    [ElectrodeMask.A, ElectrodeMask.BD],
    [ElectrodeMask.C, ElectrodeMask.B],
    [ElectrodeMask.C, ElectrodeMask.D],
    [ElectrodeMask.C, ElectrodeMask.BD],
    [ElectrodeMask.AC, ElectrodeMask.B],
    [ElectrodeMask.AC, ElectrodeMask.D],
    [ElectrodeMask.AC, ElectrodeMask.BD],
  ] as const;
  for (const e of valid) {
    expect(() => checkElcon([e[0], e[1]])).not.toThrow();
  }
});

test('checkElcon: polaritetsspegling av valid configs passar', () => {
  // Samma 9 konfigs men pos↔neg flippade — också giltiga (phase-bit hanterar)
  const flipped = [
    [ElectrodeMask.B, ElectrodeMask.A],
    [ElectrodeMask.D, ElectrodeMask.A],
    [ElectrodeMask.BD, ElectrodeMask.A],
    [ElectrodeMask.B, ElectrodeMask.C],
    [ElectrodeMask.D, ElectrodeMask.C],
    [ElectrodeMask.BD, ElectrodeMask.C],
    [ElectrodeMask.B, ElectrodeMask.AC],
    [ElectrodeMask.D, ElectrodeMask.AC],
    [ElectrodeMask.BD, ElectrodeMask.AC],
  ] as const;
  for (const e of flipped) {
    expect(() => checkElcon([e[0], e[1]])).not.toThrow();
  }
});

test('checkElcon: hardware-INVALID konfigurationer throws', () => {
  // A↔C: båda i {A,C}-buddy-paret, kan ej vara opposite poles (U4+U6 båda T+)
  expect(() => checkElcon([ElectrodeMask.A, ElectrodeMask.C])).toThrow(PatternValidationError);
  // B↔D: båda i {B,D}-buddy-paret (U5+U7 båda T−)
  expect(() => checkElcon([ElectrodeMask.B, ElectrodeMask.D])).toThrow(PatternValidationError);
  // A↔(B|C): C är i fel side (C tillhör {A,C}, måste vara på samma sida som A)
  expect(() => checkElcon([ElectrodeMask.A, ElectrodeMask.B | ElectrodeMask.C])).toThrow(PatternValidationError);
  // (A|B)↔D: A och B på samma sida — fel paret
  expect(() => checkElcon([ElectrodeMask.A | ElectrodeMask.B, ElectrodeMask.D])).toThrow(PatternValidationError);
});

test('checkElcon: empty side ([0,X] eller [X,0]) throws', () => {
  // Tomt set på någondera sidan = ingen ström = useless pulse
  expect(() => checkElcon([0, 0])).toThrow(PatternValidationError);
  expect(() => checkElcon([ElectrodeMask.A, 0])).toThrow(PatternValidationError);
  expect(() => checkElcon([0, ElectrodeMask.B])).toThrow(PatternValidationError);
});

test('checkElcon: överlappande masks throws (short circuit)', () => {
  expect(() => checkElcon([ElectrodeMask.A, ElectrodeMask.A])).toThrow(PatternValidationError);
  expect(() => checkElcon([ElectrodeMask.AC, ElectrodeMask.AB])).toThrow(PatternValidationError);
  expect(() => checkElcon([ElectrodeMask.ABCD, ElectrodeMask.A])).toThrow(PatternValidationError);
});

test('isElconHardwareValid: predicate matchar checkElcon', () => {
  expect(isElconHardwareValid([ElectrodeMask.AC, ElectrodeMask.BD])).toBe(true);
  expect(isElconHardwareValid([ElectrodeMask.A, ElectrodeMask.B])).toBe(true);
  expect(isElconHardwareValid([ElectrodeMask.A, ElectrodeMask.C])).toBe(false);
  expect(isElconHardwareValid([ElectrodeMask.B, ElectrodeMask.D])).toBe(false);
  expect(isElconHardwareValid([0, 0])).toBe(false);
});

test('checkElcon: ogiltiga mask-värden throws', () => {
  expect(() => checkElcon([16, 0])).toThrow(); // > 15
  expect(() => checkElcon([-1, 0])).toThrow(); // negativ
  expect(() => checkElcon([1.5, 0])).toThrow(); // float
});

test('checkPattern: valid pattern passar', () => {
  const valid: PatternDef = {
    name: 'Test',
    elcons: [[ElectrodeMask.A, ElectrodeMask.B]],
    paceMicros: 10000,
    nrOfSteps: 3,
    nrOfReps: 10,
  };
  expect(() => checkPattern(valid)).not.toThrow();
});

test('checkPattern: empty elcons throws', () => {
  const empty: PatternDef = {
    name: 'Empty',
    elcons: [],
    paceMicros: 10000,
    nrOfSteps: 3,
    nrOfReps: 10,
  };
  expect(() => checkPattern(empty)).toThrow(PatternValidationError);
});

test('checkPattern: invalid elcon i listan throws med index', () => {
  const bad: PatternDef = {
    name: 'Bad',
    elcons: [
      [ElectrodeMask.A, ElectrodeMask.B], // OK
      [ElectrodeMask.AC, ElectrodeMask.AB], // shortage — A delas
    ],
    paceMicros: 10000,
    nrOfSteps: 3,
    nrOfReps: 10,
  };
  try {
    checkPattern(bad);
    expect.unreachable('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(PatternValidationError);
    if (e instanceof PatternValidationError) {
      expect(e.elconIndex).toBe(1);
    }
  }
});

test('checkPattern: invalid pace/reps/steps throws', () => {
  const base = {
    name: 'X',
    elcons: [[ElectrodeMask.A, ElectrodeMask.B]] as const,
  };
  expect(() =>
    checkPattern({ ...base, paceMicros: 0, nrOfSteps: 1, nrOfReps: 1 }),
  ).toThrow();
  expect(() =>
    checkPattern({ ...base, paceMicros: 1000, nrOfSteps: 0, nrOfReps: 1 }),
  ).toThrow();
  expect(() =>
    checkPattern({ ...base, paceMicros: 1000, nrOfSteps: 1, nrOfReps: -1 }),
  ).toThrow();
});

test('isValidPattern: predicate variant', () => {
  expect(
    isValidPattern({
      name: 'X',
      elcons: [[ElectrodeMask.A, ElectrodeMask.B]],
      paceMicros: 10000,
      nrOfSteps: 1,
      nrOfReps: 1,
    }),
  ).toBe(true);
  expect(
    isValidPattern({
      name: 'X',
      elcons: [],
      paceMicros: 10000,
      nrOfSteps: 1,
      nrOfReps: 1,
    }),
  ).toBe(false);
});

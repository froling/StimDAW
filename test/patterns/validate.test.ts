import { test, expect } from 'bun:test';
import {
  PatternValidationError,
  checkElcon,
  checkPattern,
  isValidPattern,
} from '../../src/patterns/validate';
import { ElectrodeMask } from '../../src/patterns/types';
import type { PatternDef } from '../../src/patterns/types';

test('checkElcon: disjunkta elcons OK', () => {
  expect(() => checkElcon([ElectrodeMask.A, ElectrodeMask.B])).not.toThrow();
  expect(() => checkElcon([ElectrodeMask.AC, ElectrodeMask.BD])).not.toThrow();
  expect(() => checkElcon([0, 0])).not.toThrow();
});

test('checkElcon: överlappande masks throws', () => {
  expect(() => checkElcon([ElectrodeMask.A, ElectrodeMask.A])).toThrow(PatternValidationError);
  expect(() => checkElcon([ElectrodeMask.AC, ElectrodeMask.AB])).toThrow(PatternValidationError);
  expect(() => checkElcon([ElectrodeMask.ABCD, ElectrodeMask.A])).toThrow(PatternValidationError);
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

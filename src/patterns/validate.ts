import type { Elcon, PatternDef } from './types';
import { isDisjoint, elconToLabel } from './types';

export class PatternValidationError extends Error {
  constructor(
    message: string,
    public readonly patternName: string | undefined,
    public readonly elconIndex: number | undefined,
  ) {
    super(message);
    this.name = 'PatternValidationError';
  }
}

/**
 * Validera pattern-invariants. Direkt motsvarighet till firmware:s `checkPattern`
 * (reference/NeoDK/firmware/src/patterns.c).
 *
 * Hård regel: varje elcons (pos & neg) === 0, annars kortslutning på switch matrix.
 *
 * Per outside-voice finding #4: enforcas också vid `ptQueue.enqueue()` som
 * belt-and-suspenders. Builder-validate är första försvarslinjen.
 */
export function checkPattern(pattern: PatternDef): void {
  if (pattern.elcons.length === 0) {
    throw new PatternValidationError(
      `Pattern "${pattern.name}" has no elcons`,
      pattern.name,
      undefined,
    );
  }
  for (let i = 0; i < pattern.elcons.length; i++) {
    const elcon = pattern.elcons[i]!;
    checkElcon(elcon, pattern.name, i);
  }
  if (pattern.paceMicros <= 0) {
    throw new PatternValidationError(
      `Pattern "${pattern.name}" has invalid paceMicros: ${pattern.paceMicros}`,
      pattern.name,
      undefined,
    );
  }
  if (pattern.nrOfReps < 0) {
    throw new PatternValidationError(
      `Pattern "${pattern.name}" has invalid nrOfReps: ${pattern.nrOfReps}`,
      pattern.name,
      undefined,
    );
  }
  if (pattern.nrOfSteps < 1) {
    throw new PatternValidationError(
      `Pattern "${pattern.name}" has invalid nrOfSteps: ${pattern.nrOfSteps}`,
      pattern.name,
      undefined,
    );
  }
}

/** Validera en enskild elcon (disjunkt-regel). Throws på violation. */
export function checkElcon(elcon: Elcon, patternName?: string, index?: number): void {
  const [pos, neg] = elcon;
  if (pos < 0 || pos > 15 || !Number.isInteger(pos)) {
    throw new PatternValidationError(
      `Invalid pos mask: ${pos} (must be 0-15 integer)`,
      patternName,
      index,
    );
  }
  if (neg < 0 || neg > 15 || !Number.isInteger(neg)) {
    throw new PatternValidationError(
      `Invalid neg mask: ${neg} (must be 0-15 integer)`,
      patternName,
      index,
    );
  }
  if (!isDisjoint(pos, neg)) {
    throw new PatternValidationError(
      `Short circuit in elcon ${elconToLabel(elcon)}: pos and neg overlap (pos=${pos}, neg=${neg}, pos&neg=${pos & neg})`,
      patternName,
      index,
    );
  }
}

/** Predicate variant — returnerar true/false utan throw. */
export function isValidPattern(pattern: PatternDef): boolean {
  try {
    checkPattern(pattern);
    return true;
  } catch {
    return false;
  }
}

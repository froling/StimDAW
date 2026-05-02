import type { Elcon, ElectrodeMask, PatternDef } from './types';
import { isDisjoint, elconToLabel, ElectrodeMask as EM } from './types';

/**
 * Hårdvaru-buddy-pairs (per NeoDK switch matrix, 4 opto-triacs U4-U7):
 *   A och C delar T+ wiring (U4, U6) — kan ALDRIG vara på olika sidor
 *   B och D delar T− wiring (U5, U7) — kan ALDRIG vara på olika sidor
 *
 * Polaritetsbiten flippar transformatorns ±, men ändrar INTE wiringen.
 * Endast 9 fysiskt giltiga (pos,neg)-konfigurationer finns:
 *   pos ∈ {A, C, AC}  AND  neg ∈ {B, D, BD}    (3×3 = 9)
 *   PLUS deras polaritetsspeglingar (samma 9, omvänt) = 18 oriented.
 *
 * Källa: reference/NeoDK/Design.md §"Switch matrix" + patterns.c:22 enum
 * (EL_AC, EL_BD är fördefinierade buddy-pair-konstanter; EL_AB / EL_CD finns inte).
 */
export const PAIR_AC: ElectrodeMask = EM.A | EM.C; // 0x05
export const PAIR_BD: ElectrodeMask = EM.B | EM.D; // 0x0A

/**
 * True om elcon respekterar buddy-pair-constraint.
 * En sida måste vara delmängd av {A,C}, andra sida delmängd av {B,D}.
 */
export function isElconHardwareValid(elcon: Elcon): boolean {
  const [pos, neg] = elcon;
  if (pos === 0 || neg === 0) return false; // empty side = ingen ström
  const posInAC = (pos & ~PAIR_AC) === 0;
  const posInBD = (pos & ~PAIR_BD) === 0;
  const negInAC = (neg & ~PAIR_AC) === 0;
  const negInBD = (neg & ~PAIR_BD) === 0;
  return (posInAC && negInBD) || (posInBD && negInAC);
}

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

/** Validera en enskild elcon (disjunkt-regel + hårdvaru-buddy-pair). Throws på violation. */
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
  // Hårdvaru-constraint: NeoDK switch matrix har 4 fasta opto-triacs.
  // A och C delar T+ wiring; B och D delar T− wiring. En sida måste vara
  // delmängd av {A,C}, andra sida delmängd av {B,D}.
  if (!isElconHardwareValid(elcon)) {
    throw new PatternValidationError(
      `Hardware-invalid elcon ${elconToLabel(elcon)}: A and C share T+ wiring (U4/U6), B and D share T− wiring (U5/U7). One side must be a subset of {A,C}, the other a subset of {B,D}. (pos=${pos}, neg=${neg})`,
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

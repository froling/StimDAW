/**
 * Inbyggda patterns från reference/NeoDK/firmware/src/patterns.c.
 *
 * Direkt port: namn, elcons, pace, nr_of_steps, nr_of_reps preserverade
 * från firmware-källan så replay-tester mot patterns312/*.csv kan validera
 * att vår mock producerar samma output som riktig hw.
 *
 * Phase 1 (denna PR): Jackhammer + Toggle. Övriga 3 i Phase 3 efter
 * Toggle-replay-gate är grön.
 */
import type { PatternDef } from './types';
import { ElectrodeMask } from './types';

/**
 * Snabbaste pattern, bara biphasic-flip mellan AC och BD.
 * 2 elcons, MAX pulse pace, 200 reps.
 * Minsta möjliga test-pattern — failure-isolation gate.
 */
export const Jackhammer: PatternDef = {
  name: 'Jackhammer',
  elcons: [
    [ElectrodeMask.AC, ElectrodeMask.BD],
    [ElectrodeMask.BD, ElectrodeMask.AC],
  ],
  paceMicros: 7000, // MAX_PULSE_PACE_µs i firmware (snabbaste tillåtna)
  nrOfSteps: 3,
  nrOfReps: 200,
};

/**
 * Klassiskt toggle mellan A-B och C-D par.
 * 6 elcons (4 unika efter dedup), 25ms pace, 300 reps.
 * Phase 2 replay-gate (matchas mot patterns312/Toggle.csv).
 */
export const Toggle: PatternDef = {
  name: 'Toggle',
  elcons: [
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.C, ElectrodeMask.D],
    [ElectrodeMask.B, ElectrodeMask.A],
    [ElectrodeMask.B, ElectrodeMask.A],
    [ElectrodeMask.D, ElectrodeMask.C],
  ],
  paceMicros: 25_000,
  nrOfSteps: 5,
  nrOfReps: 300,
};

/**
 * Komplexare 4-elcon-sekvens som korstogglar kanaler.
 * 4 elcons, 20ms pace, 200 reps. Phase 3.
 */
export const CrossToggle: PatternDef = {
  name: 'CrossToggle',
  elcons: [
    [ElectrodeMask.A, ElectrodeMask.D],
    [ElectrodeMask.B, ElectrodeMask.C],
    [ElectrodeMask.C, ElectrodeMask.B],
    [ElectrodeMask.D, ElectrodeMask.A],
  ],
  paceMicros: 20_000,
  nrOfSteps: 5,
  nrOfReps: 200,
};

/**
 * Den mest komplexa — 18-elcon roterande pattern genom alla par.
 * Phase 3 visualization-stress-test (UI ska klara 18 rader).
 */
export const Circle: PatternDef = {
  name: 'Circle',
  elcons: [
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.B, ElectrodeMask.AC],
    [ElectrodeMask.C, ElectrodeMask.B],
    [ElectrodeMask.BD, ElectrodeMask.C],
    [ElectrodeMask.C, ElectrodeMask.D],
    [ElectrodeMask.D, ElectrodeMask.AC],
    [ElectrodeMask.A, ElectrodeMask.D],
    [ElectrodeMask.BD, ElectrodeMask.A],
    [ElectrodeMask.AC, ElectrodeMask.BD],
    [ElectrodeMask.B, ElectrodeMask.A],
    [ElectrodeMask.AC, ElectrodeMask.B],
    [ElectrodeMask.B, ElectrodeMask.C],
    [ElectrodeMask.C, ElectrodeMask.BD],
    [ElectrodeMask.D, ElectrodeMask.C],
    [ElectrodeMask.AC, ElectrodeMask.D],
    [ElectrodeMask.D, ElectrodeMask.A],
    [ElectrodeMask.A, ElectrodeMask.BD],
    [ElectrodeMask.BD, ElectrodeMask.AC],
  ],
  paceMicros: 30_000,
  nrOfSteps: 9,
  nrOfReps: 40,
};

/**
 * Snabba alternerande pulser, många reps.
 * 12 elcons, 8ms pace, 5000 reps — streaming-render-stress.
 */
export const ScratchThatItch: PatternDef = {
  name: 'Scratch that itch',
  elcons: [
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.B, ElectrodeMask.A],
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.B, ElectrodeMask.A],
    [ElectrodeMask.C, ElectrodeMask.D],
    [ElectrodeMask.D, ElectrodeMask.C],
    [ElectrodeMask.C, ElectrodeMask.D],
    [ElectrodeMask.D, ElectrodeMask.C],
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.C, ElectrodeMask.D],
    [ElectrodeMask.B, ElectrodeMask.A],
    [ElectrodeMask.D, ElectrodeMask.C],
  ],
  paceMicros: 8_000,
  nrOfSteps: 11,
  nrOfReps: 5000,
};

/** Alla inbyggda patterns. Phase 1 = first 2; resten exporteras men inte aktiva i UI än. */
export const builtinPatterns: readonly PatternDef[] = [
  Jackhammer,
  Toggle,
  CrossToggle,
  Circle,
  ScratchThatItch,
];

/** Sök pattern by name. Returns undefined if not found. */
export function getPatternByName(name: string): PatternDef | undefined {
  return builtinPatterns.find((p) => p.name === name);
}

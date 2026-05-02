/**
 * Inbyggda patterns.
 *
 * Två klasser:
 *   1. PatternDef (cycled) — direkt port från NeoDK firmware/src/patterns.c.
 *      Konstant pace + cycling elcons + ramp-up steps. Bandbredd: 5 patterns.
 *   2. RecordedPatternMeta (recorded) — ET-312-inspelningar från
 *      reference/NeoDK/patterns312/. Per-puls timing + Vprim-modulering
 *      bevarad. Bandbredd: 4 patterns. Mindre embedded i bundle, större
 *      lazy-fetchade från public/patterns312/.
 *
 * UI listar båda i PatternRunnerBar via allBuiltinPatterns.
 */
import type { AnyPattern, PatternDef, RecordedPatternMeta } from './types';
import { ElectrodeMask } from './types';
import { loadIntense, loadToggle312 } from './csv-data/embedded';
import { loadOrgasmMin, loadOrgasmMax } from './csv-data/fetched';

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

/** Alla cycled (firmware-style) patterns. */
export const builtinPatterns: readonly PatternDef[] = [
  Jackhammer,
  Toggle,
  CrossToggle,
  Circle,
  ScratchThatItch,
];

// ──────────────────────────────────────────────────────────────────────────
// Recorded patterns (ET-312 patterns312/*.csv)
// ──────────────────────────────────────────────────────────────────────────
//
// Mappning: ET-312 har två oberoende effekt-kanaler. Mappas till disjoint
// NeoDK-elcons så de kan fyra simultant utan switch-matrix-konflikt:
//   Stage 'A' → [A, B] (single+single, hardware-valid)
//   Stage 'B' → [C, D] (single+single, hardware-valid, disjoint från A)
//
// Alternativ: [A, BD] / [C, BD] (delad ground) eller [AC, BD] (alla 4) —
// kan göras per-pattern config i framtiden om vi vill experimentera.

const CHANNEL_A_DEFAULT = [ElectrodeMask.A, ElectrodeMask.B] as const;
const CHANNEL_B_DEFAULT = [ElectrodeMask.C, ElectrodeMask.D] as const;

/**
 * 312-Intense — kortast (2 KB, 47 pulser, ~1.5 sek).
 * Bra första-test för recorded-pattern-pipelinen pga snabbt play-cycle.
 */
export const Intense312: RecordedPatternMeta = {
  kind: 'recorded',
  name: '312-Intense',
  description: 'ET-312 Intense — 47 pulser, ~1.5s, embedded',
  channelAElcon: CHANNEL_A_DEFAULT,
  channelBElcon: CHANNEL_B_DEFAULT,
  load: loadIntense,
  stats: { approxPulses: 47, approxDurationSeconds: 1.5 },
};

/**
 * 312-Toggle — embedded (60 KB, 1232 pulser).
 * Motsvarar firmware-Toggle-pattern men med ET-312:s riktiga timing/Vprim.
 * Bra A/B-test mot builtin Toggle för att se skillnaden i karaktär.
 */
export const Toggle312: RecordedPatternMeta = {
  kind: 'recorded',
  name: '312-Toggle',
  description: 'ET-312 Toggle — 1232 pulser, ~30s, embedded',
  channelAElcon: CHANNEL_A_DEFAULT,
  channelBElcon: CHANNEL_B_DEFAULT,
  load: loadToggle312,
  stats: { approxPulses: 1232, approxDurationSeconds: 30 },
};

/**
 * 312-Orgasm_min — lazy-fetched (720 KB, 15453 pulser, ~6 min).
 * Vprim-modulering är kärnan i pattern. Inte porterbar till PatternDef.
 */
export const OrgasmMin312: RecordedPatternMeta = {
  kind: 'recorded',
  name: '312-Orgasm_min',
  description: 'ET-312 Orgasm_min — 15k pulser, ~6 min, lazy-fetch (720 KB)',
  channelAElcon: CHANNEL_A_DEFAULT,
  channelBElcon: CHANNEL_B_DEFAULT,
  load: loadOrgasmMin,
  stats: { approxPulses: 15453, approxDurationSeconds: 360 },
};

/**
 * 312-Orgasm_max — lazy-fetched (5.2 MB, 111082 pulser, ~45 min).
 * Längsta pattern. Vid loop används med försiktighet — gigantisk session.
 */
export const OrgasmMax312: RecordedPatternMeta = {
  kind: 'recorded',
  name: '312-Orgasm_max',
  description: 'ET-312 Orgasm_max — 111k pulser, ~45 min, lazy-fetch (5.2 MB)',
  channelAElcon: CHANNEL_A_DEFAULT,
  channelBElcon: CHANNEL_B_DEFAULT,
  load: loadOrgasmMax,
  stats: { approxPulses: 111082, approxDurationSeconds: 2700 },
};

/** Alla recorded patterns. */
export const recorded312Patterns: readonly RecordedPatternMeta[] = [
  Intense312,
  Toggle312,
  OrgasmMin312,
  OrgasmMax312,
];

/** Alla inbyggda patterns (cycled + recorded). UI iterar denna. */
export const allBuiltinPatterns: readonly AnyPattern[] = [
  ...builtinPatterns,
  ...recorded312Patterns,
];

/** Sök pattern by name (cycled eller recorded). Returns undefined if not found. */
export function getPatternByName(name: string): AnyPattern | undefined {
  return allBuiltinPatterns.find((p) => p.name === name);
}

/** Sök bara cycled pattern by name. För back-compat med tester. */
export function getCycledPatternByName(name: string): PatternDef | undefined {
  return builtinPatterns.find((p) => p.name === name);
}

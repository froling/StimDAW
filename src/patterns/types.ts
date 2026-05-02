/**
 * Pattern data model — direkt port från reference/NeoDK/firmware/src/patterns.c.
 *
 * Tre lager:
 *   ElectrodeMask  bitmask av {A=1, B=2, C=4, D=8}
 *   Elcon          [pos, neg] par av masks (disjunkt: pos & neg === 0)
 *   PatternDef     namn + elcons-array + pace + reps + steps
 *
 * Module boundaries: pure data, ingen runtime state. Konsumeras av runner,
 * validate, csv-format, builtins, samt UI-elcon-label-formatting.
 */

export type ElectrodeMask = number; // 0..15, bitmask A=1, B=2, C=4, D=8

/**
 * Disjunkt par av elektrod-masks.
 * pos = positiva sidan, neg = negativa sidan, biphasic-flippas av phase-bit.
 * INVARIANT: (pos & neg) === 0 — annars kortslutning på switch matrix.
 */
export type Elcon = readonly [pos: ElectrodeMask, neg: ElectrodeMask];

export interface PatternDef {
  /** Display name, t.ex. "Jackhammer" */
  readonly name: string;
  /** Elcon-sekvens. Längd 2-50+, varierar per pattern. */
  readonly elcons: readonly Elcon[];
  /** Tid mellan starts av konsekutiva pulser, mikrosekunder. */
  readonly paceMicros: number;
  /** Antal ramp-up steg inom pattern (firmware bumpar amp gradvis). */
  readonly nrOfSteps: number;
  /** Antal repetitioner av hela pattern-cykeln. */
  readonly nrOfReps: number;
}

// ──────────────────────────────────────────────────────────────────
// ElectrodeMask helpers
// ──────────────────────────────────────────────────────────────────

export const ElectrodeMask = {
  None: 0,
  A: 1,
  B: 2,
  C: 4,
  D: 8,
  AB: 3,
  AC: 5,
  AD: 9,
  BC: 6,
  BD: 10,
  CD: 12,
  ABC: 7,
  ABD: 11,
  ACD: 13,
  BCD: 14,
  ABCD: 15,
} as const;

const ELECTRODE_LETTERS: ReadonlyArray<[ElectrodeMask, string]> = [
  [ElectrodeMask.A, 'A'],
  [ElectrodeMask.B, 'B'],
  [ElectrodeMask.C, 'C'],
  [ElectrodeMask.D, 'D'],
];

/** Konvertera bitmask till läsbart label, t.ex. 5 → "AC", 10 → "BD", 0 → "None". */
export function maskToString(mask: ElectrodeMask): string {
  if (mask === 0) return 'None';
  let result = '';
  for (const [bit, letter] of ELECTRODE_LETTERS) {
    if ((mask & bit) !== 0) result += letter;
  }
  return result;
}

/** Format elcon som "A↔B" eller "AC↔BD". Används i UI-labels. */
export function elconToLabel(elcon: Elcon): string {
  return `${maskToString(elcon[0])}↔${maskToString(elcon[1])}`;
}

/**
 * Polaritets-explicit elcon-format för CSV-export och loggar:
 *   pos=A, neg=B  → "A>B"   (forward — vänster är pos, ström flödar →)
 *   pos=B, neg=A  → "A<B"   (reverse — alfabetiskt mindre sida alltid vänster)
 *   pos=AC,neg=BD → "AC>BD"
 *   pos=BD,neg=AC → "AC<BD"
 *
 * Konvention: vänster sida är alltid den lexikografiskt lägre elektrod-strängen
 * så att samma fysiska par alltid hamnar i samma "lane" oavsett biphasic-flip.
 * Det gör det lätt att upptäcka phase-flippade par i en lång CSV-rad.
 *
 * Edge cases:
 *   - pos=0 eller neg=0: returns "{letters}>" eller ">{letters}" (otillåtet i
 *     riktig descriptor men hanterar grace för debug)
 *   - pos=neg=0: returns "0>0" (sentinel — bör aldrig hända)
 */
export function elconToPolarityLabel(elcon: Elcon): string {
  const [pos, neg] = elcon;
  if (pos === 0 && neg === 0) return '0>0';
  const posStr = pos === 0 ? '' : maskToString(pos);
  const negStr = neg === 0 ? '' : maskToString(neg);
  if (posStr === '') return `>${negStr}`;
  if (negStr === '') return `${posStr}>`;
  // Alfabetiskt-mindre sida alltid till vänster — '>' = forward, '<' = reverse
  if (posStr <= negStr) return `${posStr}>${negStr}`;
  return `${negStr}<${posStr}`;
}

/** True om två masks är disjunkta (ingen elektrod i båda). */
export function isDisjoint(a: ElectrodeMask, b: ElectrodeMask): boolean {
  return (a & b) === 0;
}

/** Union två masks. */
export function maskUnion(a: ElectrodeMask, b: ElectrodeMask): ElectrodeMask {
  return (a | b) & 0xf;
}

/** Lista alla unika elcons som förekommer i en pattern. Bevarar förstaapparitions-ordning. */
export function uniqueElcons(elcons: readonly Elcon[]): Elcon[] {
  const seen = new Set<number>();
  const out: Elcon[] = [];
  for (const e of elcons) {
    const key = (e[0] << 4) | e[1];
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

/** Stabil ID för en elcon (för Map-keys, React-keys etc). */
export function elconId(elcon: Elcon): string {
  return `${elcon[0]}-${elcon[1]}`;
}

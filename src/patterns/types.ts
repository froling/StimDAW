/**
 * Pattern data model — direkt port från reference/NeoDK/firmware/src/patterns.c.
 *
 * Tre lager:
 *   ElectrodeMask  bitmask av {A=1, B=2, C=4, D=8}
 *   Elcon          [pos, neg] par av masks (disjunkt: pos & neg === 0)
 *   PatternDef     namn + elcons-array + pace + reps + steps
 *
 * Plus RecordedPatternMeta för ET-312 patterns312-CSV-inspelningar (per-puls
 * timing + Vprim-modulering bevarad, lazy-loaded).
 *
 * Module boundaries: pure data, ingen runtime state. Konsumeras av runner,
 * validate, csv-format, builtins, samt UI-elcon-label-formatting.
 */
import type { RecordedPulse } from './csv-format';

export type ElectrodeMask = number; // 0..15, bitmask A=1, B=2, C=4, D=8

/**
 * Disjunkt par av elektrod-masks.
 * pos = positiva sidan, neg = negativa sidan, biphasic-flippas av phase-bit.
 * INVARIANT: (pos & neg) === 0 — annars kortslutning på switch matrix.
 */
export type Elcon = readonly [pos: ElectrodeMask, neg: ElectrodeMask];

export interface PatternDef {
  /** Discriminator för AnyPattern-union. Optional för back-compat. */
  readonly kind?: 'cycled';
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

/**
 * Recorded pattern — descriptor-stream från en faktisk inspelning (t.ex.
 * patterns312/*.csv). Skiljer sig från PatternDef genom att varje puls har
 * sin egen timing + amplitude (Vprim) — kan ej uttryckas som constant-pace
 * cykling.
 *
 * Loadern är async så stora CSVs kan lazy-fetchas från public/patterns312/
 * istället för att blåsa upp bundle-storleken (Orgasm_max är 5.2 MB).
 *
 * Mappning: ET-312 har två oberoende effektkanaler (Stage 'A' och 'B' i
 * CSV). Mappas till två hardware-valid NeoDK-elcons via channelAElcon och
 * channelBElcon. Defaults [A, B] resp [C, D] — disjoint så channels kan
 * fyra simultant utan switch-matrix-konflikt.
 */
export interface RecordedPatternMeta {
  /** Discriminator för AnyPattern-union. */
  readonly kind: 'recorded';
  /** Display name, t.ex. "312-Intense" */
  readonly name: string;
  /** Kort beskrivning för tooltip/UI. */
  readonly description: string;
  /** ET-312 Stage 'A' → NeoDK elcon. Default [A, B]. */
  readonly channelAElcon: Elcon;
  /** ET-312 Stage 'B' → NeoDK elcon. Default [C, D]. */
  readonly channelBElcon: Elcon;
  /** Async loader — embedded CSV string eller fetch från public/. */
  readonly load: () => Promise<readonly RecordedPulse[]>;
  /** Estimerad pulse count + duration för UI-tooltips (utan att triggra load). */
  readonly stats: {
    readonly approxPulses: number;
    readonly approxDurationSeconds: number;
  };
}

/** Union — UI-listor och runPattern-dispatch hanterar båda. */
export type AnyPattern = PatternDef | RecordedPatternMeta;

export function isRecordedPattern(p: AnyPattern): p is RecordedPatternMeta {
  return (p as RecordedPatternMeta).kind === 'recorded';
}

/**
 * Re-exporterad så runner.ts och builtins.ts inte behöver importera från
 * csv-format separat.
 */
export type { RecordedPulse };

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

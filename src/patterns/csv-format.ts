/**
 * Parse + serialize patterns312-CSV-format för replay-validation.
 *
 * Lenient parser (per E6=B) — accepterar två header-format:
 *   "Stage","SeqNr","Timestamp","Phase","Width","Vprim"
 *   "Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]"
 *
 * VIKTIGT om topologi: patterns312/* är inspelningar från Erostek ET-312,
 * INTE från NeoDK. ET-312 har två oberoende effektkanaler ("A" och "B"), var
 * och en med sina egna +/- elektroder. NeoDK har en singel transformer +
 * 4-elektrod switch matrix där varje descriptor specar pos/neg-mask via
 * electrode_set.
 *
 * ET-312 → NeoDK-mappning (informellt): ET-312 "A" ≈ NeoDK A↔C-paret,
 * ET-312 "B" ≈ NeoDK B↔D-paret (samma fysiska elektroder, olika
 * benämningar i de två protokollen).
 *
 * Stage-kolumnen bär två semantiker:
 *   - ET-312-recordings: 'A' eller 'B' (kanal-namn)
 *   - NeoDK-exports: polaritets-explicit elektrod-label, t.ex. 'A>C',
 *     'AC<BD' — fångar switch-matrix-routingen direkt i kolumnen så
 *     formatet håller sig vid 6 kolumner.
 *
 * Konsekvens: byte-för-byte replay-jämförelse går INTE. patterns312 är
 * användbart som referens för pace/width/biphasic-cadence + seqNr-timing
 * (outside-voice #1, ±50µs/±5% tolerance), inte för channel-routing.
 */

export interface RecordedPulse {
  /**
   * Stage-kolumn — två semantiker beroende på källa:
   *   ET-312 recordings: 'A' eller 'B' (effektkanal)
   *   NeoDK exports: polaritets-label från elconToPolarityLabel,
   *     t.ex. 'A>C', 'AC<BD'
   * Lagras som string för att rymma båda fall utan typ-acrobatik.
   */
  stage: string;
  /** Sekvensnummer från firmware */
  seqNr: number;
  /** Timestamp i mikrosekunder (absolut, från firmware-start) */
  timestampMicros: number;
  /** Biphasic phase: 0 eller 1 (polaritet) */
  phase: 0 | 1;
  /** Pulse width i mikrosekunder */
  widthMicros: number;
  /** Uppmätt primärspänning i millivolt */
  vprimMv: number;
}

export class CsvParseError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(message);
    this.name = 'CsvParseError';
  }
}

const HEADER_PATTERN = /^"?Stage"?,"?SeqNr"?,"?Timestamp(?:\s*\[µs\])?"?,"?Phase"?,"?Width(?:\s*\[µs\])?"?,"?Vprim(?:\s*\[mV\])?"?$/;
/**
 * Stage-validering — accepterar:
 *   - ET-312-kanaler: exakt "A" eller "B"
 *   - NeoDK polaritets-labels: [A-D]+ med '>' eller '<' någonstans,
 *     t.ex. "A>C", "AC<BD", "A>", ">B" (edge case med tom sida)
 *   - Sentinel: "0>0" (debug)
 *
 * Rejects: bare "C", "D", "AC", "BD" (ej polaritets-syntax → ogiltigt stage)
 */
const STAGE_PATTERN = /^(?:A|B|0>0|[A-D]+[<>][A-D]*|[A-D]*[<>][A-D]+)$/;

/**
 * Parsa CSV-text till lista av RecordedPulse.
 * Tolerant mot trailing whitespace, tomma rader, båda header-format.
 */
export function parsePatterns312Csv(text: string): RecordedPulse[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  // Find header line — skip leading blank lines
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '') continue;
    if (!HEADER_PATTERN.test(trimmed)) {
      throw new CsvParseError(
        `Invalid CSV header on line ${i + 1}: ${trimmed.slice(0, 80)}`,
        i + 1,
      );
    }
    headerIdx = i;
    break;
  }
  if (headerIdx < 0) return [];

  const out: RecordedPulse[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    const parts = line.split(',');
    if (parts.length < 6) {
      throw new CsvParseError(
        `Line ${i + 1} has ${parts.length} fields, expected 6: ${line.slice(0, 80)}`,
        i + 1,
      );
    }
    const stage = parts[0]!.trim();
    if (!STAGE_PATTERN.test(stage)) {
      throw new CsvParseError(`Line ${i + 1} invalid Stage: "${stage}"`, i + 1);
    }
    const seqNr = parseIntStrict(parts[1]!, i + 1, 'SeqNr');
    const timestampMicros = parseIntStrict(parts[2]!, i + 1, 'Timestamp');
    const phase = parseIntStrict(parts[3]!, i + 1, 'Phase');
    if (phase !== 0 && phase !== 1) {
      throw new CsvParseError(`Line ${i + 1} invalid Phase: ${phase}`, i + 1);
    }
    const widthMicros = parseIntStrict(parts[4]!, i + 1, 'Width');
    const vprimMv = parseIntStrict(parts[5]!, i + 1, 'Vprim');
    out.push({ stage, seqNr, timestampMicros, phase, widthMicros, vprimMv });
  }
  return out;
}

function parseIntStrict(s: string, line: number, field: string): number {
  const trimmed = s.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new CsvParseError(`Line ${line} field "${field}" not integer: "${trimmed}"`, line);
  }
  return parseInt(trimmed, 10);
}

/**
 * Serialize pulses to patterns312-CSV-format (with units).
 * Stage-fältet kan vara ET-312-kanal ('A'/'B') eller NeoDK-polaritets-label
 * ('A>C', 'AC<BD' etc) — båda skrivs som-är till Stage-kolumnen.
 */
export function serializePatterns312Csv(pulses: readonly RecordedPulse[]): string {
  const lines: string[] = [];
  lines.push('"Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]"');
  for (const p of pulses) {
    lines.push(
      `${p.stage},${p.seqNr},${p.timestampMicros},${p.phase},${p.widthMicros},${p.vprimMv}`,
    );
  }
  return lines.join('\n') + '\n';
}

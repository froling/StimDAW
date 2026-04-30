/**
 * Parse + serialize patterns312-CSV-format för replay-validation.
 *
 * Lenient parser (per E6=B) — accepterar tre header-format:
 *   "Stage","SeqNr","Timestamp","Phase","Width","Vprim"
 *   "Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]"
 *   "Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]","Electrodes"
 *
 * VIKTIGT om topologi: patterns312/* är inspelningar från Erostek ET-312,
 * INTE från NeoDK. ET-312 har två oberoende effektkanaler ("A" och "B"), var
 * och en med sina egna +/- elektroder (kan dela gemensam minus-pol). NeoDK
 * har en singel transformer + 4-elektrod switch matrix där varje descriptor
 * specar pos/neg-mask via electrode_set — inget motsvarande "channel".
 *
 * Konsekvens: byte-för-byte replay-jämförelse går INTE. patterns312 är
 * användbart som referens för pace/width/biphasic-cadence + seqNr-timing
 * (outside-voice finding #1, ±50µs/±5% tolerance), inte för channel-routing.
 * NeoDK-export hardcodar stage='A' (singel transformer) men lägger till
 * "Electrodes"-kolumn (t.ex. "A>B", "AC<BD") som fångar switch-matrix-
 * routingen som ET-312-formatet inte har plats för.
 */

export interface RecordedPulse {
  /**
   * ET-312-kanal i inspelningar: 'A' eller 'B' = två fysiska effektkanaler.
   * NeoDK-export använder alltid 'A' eftersom topologi är singel transformer.
   */
  stage: 'A' | 'B';
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
  /**
   * Elektrod-routing per polaritets-explicit format ("A>B", "AC<BD", etc).
   * Optional eftersom ET-312-inspelningar saknar denna kolumn — sätts av
   * NeoDK-export från descriptor.electrodeSet via elconToPolarityLabel.
   */
  electrodes?: string;
}

export class CsvParseError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(message);
    this.name = 'CsvParseError';
  }
}

const HEADER_PATTERN = /^"?Stage"?,"?SeqNr"?,"?Timestamp(?:\s*\[µs\])?"?,"?Phase"?,"?Width(?:\s*\[µs\])?"?,"?Vprim(?:\s*\[mV\])?"?(?:,"?Electrodes"?)?$/;

/**
 * Parsa CSV-text till lista av RecordedPulse.
 * Tolerant mot trailing whitespace, tomma rader, alla tre header-format
 * (med eller utan Electrodes-kolumn).
 */
export function parsePatterns312Csv(text: string): RecordedPulse[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  // Find header line — skip leading blank lines
  let headerIdx = -1;
  let hasElectrodes = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '') continue;
    if (!HEADER_PATTERN.test(trimmed)) {
      throw new CsvParseError(
        `Invalid CSV header on line ${i + 1}: ${trimmed.slice(0, 80)}`,
        i + 1,
      );
    }
    hasElectrodes = /Electrodes/.test(trimmed);
    headerIdx = i;
    break;
  }
  if (headerIdx < 0) return [];

  const minFields = hasElectrodes ? 7 : 6;

  const out: RecordedPulse[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    const parts = line.split(',');
    if (parts.length < minFields) {
      throw new CsvParseError(
        `Line ${i + 1} has ${parts.length} fields, expected ${minFields}: ${line.slice(0, 80)}`,
        i + 1,
      );
    }
    const stage = parts[0]!.trim();
    if (stage !== 'A' && stage !== 'B') {
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
    const pulse: RecordedPulse = { stage, seqNr, timestampMicros, phase, widthMicros, vprimMv };
    if (hasElectrodes) {
      pulse.electrodes = parts[6]!.trim();
    }
    out.push(pulse);
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
 *
 * Om någon puls har electrodes-fält så emit:as Electrodes-kolumnen för ALLA
 * rader (saknat fält → tom sträng). Bibehåller bakåt-kompatibilitet med
 * ET-312-recordings som inte har kolumnen.
 */
export function serializePatterns312Csv(pulses: readonly RecordedPulse[]): string {
  const includeElectrodes = pulses.some((p) => p.electrodes !== undefined);
  const lines: string[] = [];
  lines.push(
    includeElectrodes
      ? '"Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]","Electrodes"'
      : '"Stage","SeqNr","Timestamp [µs]","Phase","Width [µs]","Vprim [mV]"',
  );
  for (const p of pulses) {
    const base = `${p.stage},${p.seqNr},${p.timestampMicros},${p.phase},${p.widthMicros},${p.vprimMv}`;
    lines.push(includeElectrodes ? `${base},${p.electrodes ?? ''}` : base);
  }
  return lines.join('\n') + '\n';
}

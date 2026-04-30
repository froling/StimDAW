/**
 * CSV-export — DispatchedDescriptor[] → patterns312-CSV-format.
 *
 * Expanderar varje dispatched descriptor till nrOfPulses individuella pulser
 * (en rad per puls). Sex kolumner — samma som original-formatet — men Stage-
 * kolumnen bär NeoDK polaritets-label ('A>C', 'AC<BD' etc) istället för
 * ET-312:s 'A'/'B'-kanal-namn. Same column, different semantics by source.
 *
 * Topologi-mappning: ET-312 "A" ≈ NeoDK A↔C, ET-312 "B" ≈ NeoDK B↔D. Notation:
 *   "A>C"  forward  (pos=A, neg=C)
 *   "A<C"  reverse  (pos=C, neg=A — vänster sida = alfabetiskt mindre)
 *   "AC>BD"  multi-elektrod
 *   "AC<BD"  multi-elektrod, reverse
 *
 * Per-pulse-expansion enligt PtDescriptor-spec:
 *   pulse i timestamp = startTimeMicros + Σ(j=0..i-1) (paceQuarterMs*250 + j*deltaPaceMicros)
 *   pulse i width     = pulseWidthMicros + ⌊(i × deltaPulseWidthQuarters) / 4⌋
 *
 * Vprim är en uppmätt primärspänning som mock-firmware inte simulerar.
 * Vi exporterar amplitude-byte som proxy (255-skalad till mV-domänen genom
 * VPRIM_FULL_SCALE_MV) — bra nog för visuell jämförelse, ej för strikt
 * voltage-match.
 */
import type { DispatchedDescriptor } from './firmware';
import type { RecordedPulse } from '../patterns/csv-format';
import { serializePatterns312Csv } from '../patterns/csv-format';
import { elconToPolarityLabel, type Elcon } from '../patterns/types';

/** Vprim full-scale i millivolt — approximation för export-proxy. */
const VPRIM_FULL_SCALE_MV = 3000;

/**
 * Konvertera dispatched-descriptors till patterns312-pulser.
 * SeqNr räknas globalt per puls (matchar firmware-output där varje puls får
 * stigande seq, inte per-descriptor).
 */
export function dispatchedToPulses(
  dispatched: readonly DispatchedDescriptor[],
): RecordedPulse[] {
  const out: RecordedPulse[] = [];
  let pulseSeq = 0;
  for (const d of dispatched) {
    const desc = d.descriptor;
    const phase = (desc.phase & 0x01) as 0 | 1;
    const paceMicros = desc.paceQuarterMs * 250;
    let timestampMicros = desc.startTimeMicros;
    // Stage-fältet bär polaritets-label per NeoDK-konvention. Alla pulser i
    // samma descriptor delar electrodeSet → samma label.
    const stage = elconToPolarityLabel(desc.electrodeSet as Elcon);
    for (let i = 0; i < desc.nrOfPulses; i++) {
      // Per-pulse pace ackumuleras med delta — pulse j använder
      // pace_j = paceMicros + j * deltaPaceMicros, så timestamp_i är summan
      // av föregående pulses pace.
      if (i > 0) {
        const prevPace = paceMicros + (i - 1) * desc.deltaPaceMicros;
        timestampMicros += prevPace;
      }
      const widthMicros =
        desc.pulseWidthMicros +
        Math.floor((i * desc.deltaPulseWidthQuarters) / 4);
      const vprimMv = Math.round((desc.amplitude / 255) * VPRIM_FULL_SCALE_MV);
      out.push({
        stage,
        seqNr: pulseSeq & 0xffff,
        timestampMicros,
        phase,
        widthMicros: Math.max(0, widthMicros),
        vprimMv,
      });
      pulseSeq++;
    }
  }
  return out;
}

/**
 * High-level: dispatched → patterns312-CSV-text.
 * Använder serializePatterns312Csv från patterns/csv-format så att
 * round-trip parser/serializer-kontraktet bibehålls (samma header,
 * samma kolumnordning).
 */
export function exportDispatchedAsCsv(
  dispatched: readonly DispatchedDescriptor[],
): string {
  const pulses = dispatchedToPulses(dispatched);
  return serializePatterns312Csv(pulses);
}

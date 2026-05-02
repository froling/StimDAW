/**
 * Pattern runner — host-side översättning från PatternDef till descriptor-stream.
 *
 * Module boundary: körs HOST-SIDE (i UI-process, inte mock-firmware). DAW-panelen
 * triggar via stores → runner genererar descriptors → skickas via NeoDKClient →
 * Transport → mock eller real fw. Real NeoDK och mock-firmware får exakt samma
 * descriptor-stream — pattern-running är samma kod oavsett.
 *
 * Per user constraint: nr_of_pulses lågt och fast (~4 default). Patterns består
 * av många små descriptors i sekvens snarare än få stora bursts.
 */
import type { PatternDef } from './types';
import { checkElcon } from './validate';
import type { PtDescriptor } from '../protocol/descriptor';

export interface PatternRunnerOptions {
  /** Pulser per descriptor (host konvention, lågt och fast). Default 4. */
  pulsesPerBurst?: number;
  /** Pulse width µs. Default 144 (matchar patterns312-inspelningar). */
  pulseWidthMicros?: number;
  /** Override max reps (för testing — annars använd pattern.nrOfReps). */
  maxReps?: number;
  /** Initialt sequence number (för fortsättning av pågående stream). */
  initialSequenceNumber?: number;
  /** Initial start_time_µs (offset från stream-start). */
  initialStartTimeMicros?: number;
}

export interface RequiredOptions extends Required<PatternRunnerOptions> {}

const DEFAULTS: RequiredOptions = {
  pulsesPerBurst: 4,
  pulseWidthMicros: 144,
  maxReps: -1, // -1 sentinel: använd pattern.nrOfReps
  initialSequenceNumber: 0,
  initialStartTimeMicros: 0,
};

/**
 * Generera descriptor-ström för ett helt pattern-run (alla reps × alla steps × alla elcons).
 *
 * Yields descriptors lazily — caller kan stoppa när som helst genom att bryta loop:en
 * (t.ex. STOP-knapp eller pattern-switch).
 *
 * Ramp-up: amplitude rampas linjärt från (1/nrOfSteps) till 1.0 över step-loopen.
 * Steg 0 hoppas över eftersom amp=0 betyder "behåll föregående", inte silence.
 */
export function* generatePatternDescriptors(
  pattern: PatternDef,
  options: PatternRunnerOptions = {},
): Generator<PtDescriptor, void, unknown> {
  const opts: RequiredOptions = { ...DEFAULTS, ...options };
  const reps = opts.maxReps < 0 ? pattern.nrOfReps : opts.maxReps;

  let seqNr = opts.initialSequenceNumber & 0xff;
  let startTime = opts.initialStartTimeMicros >>> 0;

  // pace_µs → pace_¼ms (clamp till u8 range)
  const paceQuarterMs = Math.max(1, Math.min(255, Math.round(pattern.paceMicros / 250)));

  // Phase polarity flippas mellan konsekutiva descriptors per elcon för biphasic
  let polarity = 0;

  for (let rep = 0; rep < reps; rep++) {
    for (let step = 1; step <= pattern.nrOfSteps; step++) {
      // Linjär amp-ramp 1/nrOfSteps .. 1.0
      const stepAmp = step / pattern.nrOfSteps;
      const amplitude = Math.max(1, Math.min(255, Math.round(stepAmp * 255)));

      for (const elcon of pattern.elcons) {
        // Validera elcon innan encoding (defense in depth)
        checkElcon(elcon, pattern.name);

        const descriptor: PtDescriptor = {
          meta: 0,
          sequenceNumber: seqNr & 0xff,
          phase: polarity & 0x01, // bit 0 = polarity, bits 2..1 = stage (NeoDK ignorerar)
          pulseWidthMicros: opts.pulseWidthMicros,
          startTimeMicros: startTime,
          electrodeSet: elcon as [number, number],
          nrOfPulses: opts.pulsesPerBurst,
          paceQuarterMs,
          amplitude,
          deltaPulseWidthQuarters: 0,
          deltaPaceMicros: 0,
        };

        yield descriptor;

        // Advance state
        seqNr = (seqNr + 1) & 0xff;
        startTime = (startTime + opts.pulsesPerBurst * pattern.paceMicros) >>> 0;
        polarity ^= 1; // flip för biphasic
      }
    }
  }
}

/** Räkna ut total antal descriptors som ett pattern-run skulle generera. */
export function countPatternDescriptors(
  pattern: PatternDef,
  options: PatternRunnerOptions = {},
): number {
  const opts: RequiredOptions = { ...DEFAULTS, ...options };
  const reps = opts.maxReps < 0 ? pattern.nrOfReps : opts.maxReps;
  return reps * pattern.nrOfSteps * pattern.elcons.length;
}

/** Räkna ut total simulerad varaktighet i mikrosekunder. */
export function patternDurationMicros(
  pattern: PatternDef,
  options: PatternRunnerOptions = {},
): number {
  const opts: RequiredOptions = { ...DEFAULTS, ...options };
  const reps = opts.maxReps < 0 ? pattern.nrOfReps : opts.maxReps;
  return reps * pattern.nrOfSteps * pattern.elcons.length * opts.pulsesPerBurst * pattern.paceMicros;
}

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
import type { Elcon, PatternDef, RecordedPulse } from './types';
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

// ──────────────────────────────────────────────────────────────────────────
// Recorded pattern playback
// ──────────────────────────────────────────────────────────────────────────

export interface RecordedRunnerOptions {
  /** ET-312 Stage 'A' → NeoDK elcon. */
  readonly channelAElcon: Elcon;
  /** ET-312 Stage 'B' → NeoDK elcon. */
  readonly channelBElcon: Elcon;
  /** Initialt sequence number (för fortsättning av pågående stream). Default 0. */
  readonly initialSequenceNumber?: number;
  /**
   * Tid-offset (µs) som adderas till alla startTime-värden. Använt för loop-
   * iterationer där iter N startar efter iter N-1:s slut.
   * Default 0 — pulser bevarar sina ursprungliga timestamps.
   */
  readonly initialStartTimeMicros?: number;
}

/**
 * Generera descriptor-stream från en recorded pattern (patterns312 CSV).
 *
 * Varje RecordedPulse → en PtDescriptor med nrOfPulses=1, dess egna timing,
 * width och amplitude. Bevarar Vprim-modulering (amp = Vprim_mV / 40,
 * matchar firmwares amp×40-formula).
 *
 * Stage-mapping:
 *   - Stage 'A' → channelAElcon (default [A, B])
 *   - Stage 'B' → channelBElcon (default [C, D])
 *
 * Timing: pulser sorteras INTE här — caller-CSV antas vara i sequence-
 * ordning (vilket patterns312 är). startTime räknas relativt FÖRSTA pulsens
 * timestamp så pattern startar vid t=0 + initialStartTimeMicros.
 *
 * Yields lazily — caller kan stoppa när som helst.
 */
export function* generateRecordedDescriptors(
  pulses: readonly RecordedPulse[],
  options: RecordedRunnerOptions,
): Generator<PtDescriptor, void, unknown> {
  if (pulses.length === 0) return;

  // Defense in depth — validera båda elcons en gång (inte per puls)
  checkElcon(options.channelAElcon, 'recorded-pattern channelA');
  checkElcon(options.channelBElcon, 'recorded-pattern channelB');

  const initialSeqNr = (options.initialSequenceNumber ?? 0) & 0xff;
  const initialStartTime = (options.initialStartTimeMicros ?? 0) >>> 0;
  const timeOrigin = pulses[0]!.timestampMicros;

  let seqNr = initialSeqNr;

  for (let i = 0; i < pulses.length; i++) {
    const pulse = pulses[i]!;
    const elcon =
      pulse.stage === 'A'
        ? options.channelAElcon
        : pulse.stage === 'B'
          ? options.channelBElcon
          : null;
    if (!elcon) {
      // Skippa stages som inte är 'A' eller 'B' (t.ex. NeoDK-export-format
      // 'A>C' — inte aktuellt för ET-312 patterns men defensive)
      continue;
    }

    // amp = Vprim_mV / 40 (matchar firmware: setPrimaryVoltage_mV(amp * 40))
    // Clamp till u8.
    const amplitude = Math.max(0, Math.min(255, Math.round(pulse.vprimMv / 40)));

    // Timing relativt första pulsens timestamp + offset
    const startTime = ((pulse.timestampMicros - timeOrigin) + initialStartTime) >>> 0;

    // Width clamp till u8 (max 200µs är säkerhets-recommended men firmware
    // tar 0..255 — låt clamp:en till 200 göras i synth-engine om vi vill
    // enforca det. Här bevarar vi inspelningens värde upp till u8-cap.)
    const pulseWidth = Math.max(1, Math.min(255, pulse.widthMicros));

    yield {
      meta: 0,
      sequenceNumber: seqNr & 0xff,
      phase: pulse.phase & 0x01,
      pulseWidthMicros: pulseWidth,
      startTimeMicros: startTime,
      electrodeSet: elcon as [number, number],
      // nrOfPulses=1 — varje CSV-rad är en distinkt puls med egen timing
      nrOfPulses: 1,
      // pace_¼ms ej meningsfullt för nrOfPulses=1, men firmware kräver >0
      // så vi sätter ett konservativt värde (matchar gap till nästa puls
      // om det finns, annars min)
      paceQuarterMs: estimatePaceTo(pulses, i),
      amplitude,
      deltaPulseWidthQuarters: 0,
      deltaPaceMicros: 0,
    };

    seqNr = (seqNr + 1) & 0xff;
  }
}

/**
 * Estimera pace_¼ms från gap till nästa puls i SAMMA stage, om den finns.
 * För nrOfPulses=1 är pace tekniskt sett "tid mellan pulser i samma burst",
 * men eftersom vi har enskilda pulser används pace inte för rendering.
 * Vi fyller ändå ett vettigt värde så firmware-validering inte rejektar.
 */
function estimatePaceTo(pulses: readonly RecordedPulse[], i: number): number {
  const current = pulses[i]!;
  for (let j = i + 1; j < pulses.length; j++) {
    if (pulses[j]!.stage === current.stage) {
      const gapMicros = pulses[j]!.timestampMicros - current.timestampMicros;
      // Konvertera µs → ¼ms (clamp till u8)
      return Math.max(1, Math.min(255, Math.round(gapMicros / 250)));
    }
  }
  // Sista pulsen i sin stage — använd default 25ms (100 ¼ms)
  return 100;
}

/**
 * Total varaktighet av en recorded pattern i mikrosekunder.
 * Returnerar 0 för tom array.
 */
export function recordedDurationMicros(pulses: readonly RecordedPulse[]): number {
  if (pulses.length === 0) return 0;
  const first = pulses[0]!.timestampMicros;
  const last = pulses[pulses.length - 1]!.timestampMicros;
  return last - first;
}

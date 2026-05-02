/**
 * Pure module. No Svelte imports, no $state, no I/O.
 *
 * Polar / radial electrode-flow frame-builder. Visualiserar strömmens
 * vandring mellan elektroder över ett kort tidsfönster (~1s) som arcs/
 * lines från + till − elektroder.
 *
 * Mental modell: 4 elektroder placerade på kardinalpunkter (N=A, E=B,
 * S=C, W=D, medurs). Per puls — för varje (T+, T−)-elektrod-par i elcon
 * — rita en linje mellan dem. Recent pulses bright, old fade out. Vid
 * Circle-pattern roterar linjerna runt panelen → man "ser" cirkeln.
 *
 * Skiljer från frame-builder.ts (envelope/waveform-panel): det här är
 * SPATIAL representation över kort tid, inte temporal envelope över 6s.
 */
import type { DispatchedDescriptor } from '../mock-firmware/firmware';
import { expandDescriptor } from './expand';
import type { VoltageSample } from './voltage-state';
import { streamTime } from './types';

/**
 * En aktiv strömväg mellan två elektroder. Polariteten (vilken som är T+ vs T−)
 * är säkerhets-mekanik (DC-skydd via biphasic alternation), INTE en upplevelse-
 * dimension — användaren känner stimen oavsett. Därför: båge är odirigerad,
 * inga "from/to"-distinktioner.
 */
export interface PolarArc {
  readonly electrodeA: 'A' | 'B' | 'C' | 'D';
  readonly electrodeB: 'A' | 'B' | 'C' | 'D';
  /** Stream-time µs när pulsen fyrade */
  readonly streamTimeMicros: number;
  /** 0..1 age-baserad fade. 1 = nyligen avfyrad, 0 = på väg ut */
  readonly ageFade: number;
  /** Pulse-width µs (2..200) — driver nod-radius när vi visualiserar */
  readonly pulseWidthMicros: number;
  /** 0..1 normaliserad amplitude — driver båge-tjocklek (linjen ÄR amp) */
  readonly amplitudeNorm: number;
  /**
   * Pace till nästa puls inom samma burst (µs). Driver båge-färg —
   * snabb pace (låg pace-µs = hög frekvens) → varm gul; långsam pace
   * (hög pace-µs = låg frekvens) → röd. Användaren ser rytmen som färg.
   */
  readonly paceMicros: number;
  /** Källa-descriptor för debug */
  readonly sourceDescriptorSeq: number;
}

/** Per-nod-aggregerade signaler för rendering — växer/lyser med aktivitet. */
export interface PolarNodeState {
  readonly electrode: 'A' | 'B' | 'C' | 'D';
  /**
   * 0..1 — pwNorm hos den YNGSTA pulsen i recency-fönstret (250ms).
   * Driver nod-radius-expansion. 0 när ingen recent puls = nod krymper
   * direkt till base när pattern stoppar.
   */
  readonly peakPwNorm: number;
  /**
   * 0..1 — recency-fade på den yngsta pulsen, linjär över NODE_RECENCY_MICROS.
   * Driver nod-fill-saturation OCH halons opacitet (pulse-takten syns som
   * att glorian flimrar i pace-rytm).
   */
  readonly activity: number;
  /**
   * Pace (µs) hos YNGSTA pulsen som träffat elektroden. Driver halons
   * FÄRG (red=slow, yellow=fast). 0 när ingen recent puls — halon
   * defaultar till neutral varm orange via CSS.
   */
  readonly paceMicros: number;
}

export interface PolarFrame {
  readonly streamNowMicros: number;
  readonly windowMicros: number;
  /** Aktiva arcs i fönstret. Sorted by streamTime ascending. */
  readonly arcs: readonly PolarArc[];
  /** Per-electrode aggregat för nod-rendering. Alltid 4 entries (A/B/C/D). */
  readonly nodes: readonly PolarNodeState[];
}

export interface BuildPolarFrameInputs {
  readonly dispatched: readonly DispatchedDescriptor[];
  readonly voltageHistory: readonly VoltageSample[];
  readonly streamOriginMicros: number | null;
  readonly streamOriginWallMicros: number | null;
  readonly streamNowMicros: number;
  /** Default 1_000_000 (1s). Kortare = snabbare animation, längre = mer trail. */
  readonly windowMicros?: number;
}

/**
 * Polar window matchas till envelope (6s) som outer cap. Den faktiska
 * visuella fade:n styrs av ARC_FADE_MICROS — kort trail (~1s) där arcs
 * är tydligt synliga. Bortom det fortsätter pulserna existera men med
 * ~0 opacity/stroke. Två-stegs design pga timing-drift mellan logical
 * stream-time (descriptor.startTime kumulativ) och wall-time
 * (frame-tick streamNow): arc-stora window absorberar drift, kort
 * fade-window styr upplevelsen.
 *
 * NOD-state använder ett ännu kortare recency-fönster (250ms) —
 * noderna representerar "är elektroden aktiv NU?".
 */
const DEFAULT_POLAR_WINDOW_MICROS = 6_000_000;
/** Visuell fade-distans — arcs >1s gamla är ~osynliga (stroke ~0, opacity ~0). */
const ARC_FADE_MICROS = 1_000_000;
/** Recency-fönster för nod-state — "live activity" decay-tail. */
const NODE_RECENCY_MICROS = 250_000;

const ELECTRODE_FROM_BIT: Record<1 | 2 | 4 | 8, 'A' | 'B' | 'C' | 'D'> = {
  1: 'A',
  2: 'B',
  4: 'C',
  8: 'D',
};

const BITS: readonly (1 | 2 | 4 | 8)[] = [1, 2, 4, 8];

export function buildPolarFrame(inputs: BuildPolarFrameInputs): PolarFrame {
  const windowMicros = inputs.windowMicros ?? DEFAULT_POLAR_WINDOW_MICROS;

  if (
    inputs.streamOriginMicros === null ||
    inputs.streamOriginWallMicros === null
  ) {
    return {
      streamNowMicros: inputs.streamNowMicros,
      windowMicros,
      arcs: [],
      nodes: emptyNodes(),
    };
  }

  // Wall-clock now, härledd från streamNow + originWall. Vi använder wall-time
  // för all ålder-beräkning eftersom logical stream-time (descriptor.startTime)
  // kan drifta bakom wall-time över långa run:ar (typ 30-80ms/s pga
  // await-overhead i runner). Med ARC_FADE_MICROS=1s blir den drift kritisk.
  // dispatch.dispatchedAtMicros sätts vid faktisk emit → drift-fri.
  const wallNow = inputs.streamOriginWallMicros + inputs.streamNowMicros;
  const wallWindowStart = wallNow - windowMicros;

  const arcs: PolarArc[] = [];
  // Per-nod tracking: youngestAge = wall-clock-ålder på SENASTE pulsen som
  // träffade elektroden. Driver activity (recency-fade) + peakPwNorm.
  // Vi använder INTE en sum-över-window-modell eftersom pulse-density
  // klampar activity till 1.0 i 4-5s post-stop. Youngest-age ger snabb
  // tail (250ms) som motsvarar "live indicator"-känslan.
  const youngestAge: Record<'A' | 'B' | 'C' | 'D', number> = {
    A: Number.POSITIVE_INFINITY,
    B: Number.POSITIVE_INFINITY,
    C: Number.POSITIVE_INFINITY,
    D: Number.POSITIVE_INFINITY,
  };
  const youngestPwNorm: Record<'A' | 'B' | 'C' | 'D', number> = {
    A: 0, B: 0, C: 0, D: 0,
  };
  const youngestPaceMicros: Record<'A' | 'B' | 'C' | 'D', number> = {
    A: 0, B: 0, C: 0, D: 0,
  };

  for (const dispatch of inputs.dispatched) {
    // Wall-time-baserad descriptor-filter: använd dispatch.dispatchedAtMicros
    // istället för descriptor.startTimeMicros (logical, drift-prone).
    if (dispatch.dispatchedAtMicros > wallNow) continue; // future
    const descriptorDuration =
      dispatch.descriptor.nrOfPulses * dispatch.descriptor.paceQuarterMs * 250;
    const dispatchEndWall = dispatch.dispatchedAtMicros + descriptorDuration;
    if (dispatchEndWall < wallWindowStart) continue; // entire burst out of window

    const descriptorStreamTime = streamTime(
      dispatch.descriptor.startTimeMicros,
      inputs.streamOriginMicros,
    );

    const pulses = expandDescriptor(
      dispatch.descriptor,
      descriptorStreamTime,
    );

    for (const pulse of pulses) {
      const [posMask, negMask] = pulse.elcon;
      if ((posMask & negMask) !== 0) continue; // short

      // Polariteten är safety, inte experience — vi behandlar arc:en som
      // odirigerad. Varje T+ × T− kombination blir en arc mellan electrodes.
      const aBits = BITS.filter((b) => (posMask & b) !== 0);
      const bBits = BITS.filter((b) => (negMask & b) !== 0);

      // Ålder i wall-time: pulse fyrar vid dispatchedAt + intra-burst-offset
      // (firmware schemalägger pulserna med paceMicros mellanrum efter
      // descriptor-mottagandet).
      const intraBurstOffset = pulse.streamTimeMicros - descriptorStreamTime;
      const pulseWallTime = dispatch.dispatchedAtMicros + intraBurstOffset;
      const age = wallNow - pulseWallTime;
      if (age < 0) continue; // future pulse
      // Skip pulser bortom fade-distansen — de är visuellt osynliga
      // ändå (ageFade=0). Sparar arc-allokering + DOM-rendering.
      if (age > ARC_FADE_MICROS) continue;
      // Kvadratisk fade över ARC_FADE_MICROS (1s). Stroke-width och
      // opacity multipliceras båda med ageFade i UI:t → arcs blir
      // snabbt tunnare OCH svagare när pattern stannar, istället för
      // att stå kvar tjocka tills grafen passerar.
      const ageLinear = clamp01(1 - age / ARC_FADE_MICROS);
      const ageFade = ageLinear * ageLinear;
      // Wire-truth: descriptor.amplitude byte (0..255) som går på protokollet.
      // Per eng-review 2026-05-02: ampNorm = wire-byte / 255, INTE Vcap-telemetri.
      const amplitudeNorm = clamp01(pulse.descriptorAmplitude / 255);
      const pwNorm = clamp01((pulse.pulseWidthMicros - 2) / 198); // 2..200 → 0..1

      for (const aBit of aBits) {
        for (const bBit of bBits) {
          const electrodeA = ELECTRODE_FROM_BIT[aBit];
          const electrodeB = ELECTRODE_FROM_BIT[bBit];
          arcs.push({
            electrodeA,
            electrodeB,
            streamTimeMicros: pulse.streamTimeMicros,
            ageFade,
            pulseWidthMicros: pulse.pulseWidthMicros,
            amplitudeNorm,
            paceMicros: pulse.paceMicros,
            sourceDescriptorSeq: pulse.sourceDescriptorSeq,
          });
          // Track youngest pulse per electrode (for live nod-state).
          // Lower age = more recent = drives the visible "active now" signal.
          for (const e of [electrodeA, electrodeB] as const) {
            if (age < youngestAge[e]) {
              youngestAge[e] = age;
              youngestPwNorm[e] = pwNorm;
              youngestPaceMicros[e] = pulse.paceMicros;
            }
          }
        }
      }
    }
  }

  // Map youngest-age per nod till activity (linear fade över recency-window)
  // + peakPwNorm (gated på recency så storleken collapsar när elektroden
  // går idle, inte stannar kvar tills sista pulsen exitar 6s-fönstret).
  const nodes: PolarNodeState[] = (['A', 'B', 'C', 'D'] as const).map((electrode) => {
    const age = youngestAge[electrode];
    const inRecency = age < NODE_RECENCY_MICROS;
    const activity = inRecency ? clamp01(1 - age / NODE_RECENCY_MICROS) : 0;
    return {
      electrode,
      peakPwNorm: inRecency ? youngestPwNorm[electrode] : 0,
      activity,
      paceMicros: inRecency ? youngestPaceMicros[electrode] : 0,
    };
  });

  return {
    streamNowMicros: inputs.streamNowMicros,
    windowMicros,
    arcs,
    nodes,
  };
}

function emptyNodes(): PolarNodeState[] {
  return (['A', 'B', 'C', 'D'] as const).map((electrode) => ({
    electrode,
    peakPwNorm: 0,
    activity: 0,
    paceMicros: 0,
  }));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

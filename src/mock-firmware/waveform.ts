/**
 * Waveform-sampler — translates dispatched descriptors till sample stream för Oscilloscope.
 *
 * Per design-review locks (2026-04-30):
 *   - 30ms sampling rate
 *   - amp trace = step-line (konstant inom descriptor)
 *   - Vcap trace = smooth line (RC follower, τ ≈ 200ms)
 *   - Future: Iprim, etc.
 *
 * Biphasic visualization (post user req 2026-05): Oscilloscope renderar
 * 0-baseline i mitten, så signed traces. Phase-bit avgör polaritet:
 *   phase=0 → positiv (uppåt)
 *   phase=1 → negativ (nedåt)
 * amp förblir magnitud (0..255) i sample; Oscilloscope multiplicerar med
 * phase-sign vid render. Vcap är dock signed redan i sample (RC-followern
 * körs på signed target) så biphasic-charge syns över decay-pauses.
 *
 * Per outside-voice #3 SINGLE CHOKEPOINT amplitude clamp:
 *   effective = min(rampPercent × descriptorAmp × ceilingPercent, 255)
 * Hardcoded MAX (255) kan ej överskridas oavsett bug i upstream-multiplier.
 */
import type { PtDescriptor } from '../protocol/descriptor';
import type { Elcon } from '../patterns/types';
import { elconId } from '../patterns/types';
import { clampAmp } from '../safety/clamp';

export interface WaveformSample {
  /** Sim-time i mikrosekunder (absolute, från SimClock-start). */
  readonly timestampMicros: number;
  /** Stabil ID för elcon (för Map-keys, UI-lookup). */
  readonly elconId: string;
  /** Elcon-pair (för UI label-formatting). */
  readonly elcon: Elcon;
  /** Effective amplitude magnitud post-clamp 0..255 (osignerad). */
  readonly amp: number;
  /** Phase-bit från aktiv descriptor: 0 = positiv polaritet, 1 = negativ. */
  readonly phase: 0 | 1;
  /**
   * Vcap voltage i signed millivolt, range -80000..+80000.
   * RC-followern är signed så target=phase-multiplied-amp; under decay
   * faller vcap från sin senaste signed nivå mot 0.
   */
  readonly vcap: number;
}

export interface SamplerInputs {
  /** RampController.getEffective() % i 0..100. */
  readonly rampPercent: number;
  /** MaxCeiling.get() % i 0..100. */
  readonly ceilingPercent: number;
}

const SAMPLE_INTERVAL_MICROS = 30_000; // 30ms
const RC_TAU_MILLIS = 200; // Vcap follower time constant
const V_CAP_MAX_MV = 80_000;
const VCAP_DECAY_THRESHOLD_MV = 10;

interface ActiveDescriptor {
  readonly descriptor: PtDescriptor;
  readonly endTimeMicros: number;
}

/**
 * Sampler maintainar per-elcon state (active descriptor + RC vcap follower).
 * Mock-firmware anropar `enqueueDescriptor(d, simNow)` när descriptor dispatchas,
 * och `sample(simNow, inputs)` periodiskt (30ms tick i sim-time) för att producera
 * WaveformSample events per elcon.
 *
 * UI subscribar via stores.svelte.ts → fyller ringbuffer per elcon.
 */
export class WaveformGenerator {
  // active descriptor per elcon (key: elconId)
  private active = new Map<string, ActiveDescriptor>();
  // Vcap RC state per elcon (key: elconId)
  private vcap = new Map<string, number>();

  /**
   * Markera att en descriptor är aktiv per simNow för dess elcon.
   * Anropas av mock-firmware när descriptor börjar processas.
   */
  enqueueDescriptor(descriptor: PtDescriptor, simNowMicros: number): void {
    const elcon: Elcon = descriptor.electrodeSet as Elcon;
    const id = elconId(elcon);
    const durationMicros = descriptor.nrOfPulses * descriptor.paceQuarterMs * 250; // ¼ms → µs
    this.active.set(id, {
      descriptor,
      endTimeMicros: simNowMicros + durationMicros,
    });
  }

  /**
   * Sampla nuvarande state vid simNow. Returnerar lista av samples — en per
   * aktiv eller decayande elcon.
   *
   * Single chokepoint amp clamp:
   *   effective = floor(descriptor.amplitude × rampPercent/100 × ceilingPercent/100)
   *   capped at 255.
   * Active=null elcons (descriptor done) får amp=0, vcap fortsätter decay
   * mot 0 från sin senaste (signed) nivå.
   */
  sample(simNowMicros: number, inputs: SamplerInputs): WaveformSample[] {
    // Cleanup: drop active descriptors som har passerat sin endTime
    for (const [id, active] of this.active) {
      if (active.endTimeMicros <= simNowMicros) {
        this.active.delete(id);
      }
    }

    const allIds = new Set<string>([...this.active.keys(), ...this.vcap.keys()]);
    const out: WaveformSample[] = [];
    const alpha = 1 - Math.exp(-30 / RC_TAU_MILLIS); // sample interval / tau

    for (const id of allIds) {
      const active = this.active.get(id);
      let elcon: Elcon;
      let amp: number;
      let phase: 0 | 1;

      if (active) {
        elcon = active.descriptor.electrodeSet as Elcon;
        amp = clampAmp(
          active.descriptor.amplitude,
          inputs.rampPercent,
          inputs.ceilingPercent,
        );
        phase = (active.descriptor.phase & 0x01) as 0 | 1;
      } else {
        // Decaying — recover elcon from id "pos-neg"
        const [posStr, negStr] = id.split('-');
        elcon = [Number(posStr), Number(negStr)] as Elcon;
        amp = 0;
        phase = 0; // amp=0 så phase påverkar inte output, default 0
      }

      // Signed RC follower on Vcap — target multiplicerad med phase-sign
      // så biphasic-charge syns. Decay (amp=0) går mot 0 oavsett phase.
      const phaseSign = phase === 0 ? 1 : -1;
      const oldVcap = this.vcap.get(id) ?? 0;
      const targetVcap = (amp / 255) * V_CAP_MAX_MV * phaseSign;
      const newVcap = oldVcap + (targetVcap - oldVcap) * alpha;

      if (Math.abs(newVcap) < VCAP_DECAY_THRESHOLD_MV && !active) {
        // Decayed under threshold (i magnitud) och ej längre aktiv — drop tracking
        this.vcap.delete(id);
      } else {
        this.vcap.set(id, newVcap);
      }

      out.push({
        timestampMicros: simNowMicros,
        elconId: id,
        elcon,
        amp,
        phase,
        vcap: newVcap,
      });
    }

    return out;
  }

  /** Clear all state — anropad av STOP. */
  reset(): void {
    this.active.clear();
    this.vcap.clear();
  }

  /** För tester/observability. */
  getActiveCount(): number {
    return this.active.size;
  }

  static get sampleIntervalMicros(): number {
    return SAMPLE_INTERVAL_MICROS;
  }
}

// clampAmp flyttad till src/safety/clamp.ts per eng-review 2.3A.
// Re-export här för bakåtkompat med befintliga imports (test/mock-firmware/waveform.test.ts).
export { clampAmp } from '../safety/clamp';

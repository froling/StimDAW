/**
 * Waveform-sampler — translates dispatched descriptors till sample stream för Oscilloscope.
 *
 * Per design-review locks (2026-04-30):
 *   - 30ms sampling rate
 *   - amp trace = step-line (konstant inom descriptor)
 *   - Vcap trace = smooth line (RC follower, τ ≈ 200ms)
 *   - Future: Iprim, etc.
 *
 * Per outside-voice #3 SINGLE CHOKEPOINT amplitude clamp:
 *   effective = min(rampPercent × descriptorAmp × ceilingPercent, 255)
 * Hardcoded MAX (255) kan ej överskridas oavsett bug i upstream-multiplier.
 */
import type { PtDescriptor } from '../protocol/descriptor';
import type { Elcon } from '../patterns/types';
import { elconId } from '../patterns/types';

export interface WaveformSample {
  /** Sim-time i mikrosekunder (absolute, från SimClock-start). */
  readonly timestampMicros: number;
  /** Stabil ID för elcon (för Map-keys, UI-lookup). */
  readonly elconId: string;
  /** Elcon-pair (för UI label-formatting). */
  readonly elcon: Elcon;
  /** Effective amplitude post-clamp 0..255. */
  readonly amp: number;
  /** Vcap voltage i millivolt 0..80000. */
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
   * Active=null elcons (descriptor done) får amp=0, vcap fortsätter decay.
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

      if (active) {
        elcon = active.descriptor.electrodeSet as Elcon;
        amp = clampAmp(
          active.descriptor.amplitude,
          inputs.rampPercent,
          inputs.ceilingPercent,
        );
      } else {
        // Decaying — recover elcon from id "pos-neg"
        const [posStr, negStr] = id.split('-');
        elcon = [Number(posStr), Number(negStr)] as Elcon;
        amp = 0;
      }

      // RC follower on Vcap
      const oldVcap = this.vcap.get(id) ?? 0;
      const targetVcap = (amp / 255) * V_CAP_MAX_MV;
      const newVcap = oldVcap + (targetVcap - oldVcap) * alpha;

      if (newVcap < VCAP_DECAY_THRESHOLD_MV && !active) {
        // Decayed below threshold and no longer active — drop tracking
        this.vcap.delete(id);
      } else {
        this.vcap.set(id, newVcap);
      }

      out.push({
        timestampMicros: simNowMicros,
        elconId: id,
        elcon,
        amp,
        vcap: Math.max(0, newVcap),
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

/**
 * Single chokepoint amp clamp per outside-voice #3.
 * effective = floor(descriptorAmp × rampPercent/100 × ceilingPercent/100)
 * capped at 255 (hardware byte max).
 *
 * Standalone funktion för att kunna unit-testa isolerat. ramp-controller
 * och max-ceiling kan ej överskrida denna gräns oavsett bugg.
 */
export function clampAmp(
  descriptorAmplitude: number,
  rampPercent: number,
  ceilingPercent: number,
): number {
  if (!Number.isFinite(descriptorAmplitude) || descriptorAmplitude <= 0) return 0;
  if (!Number.isFinite(rampPercent) || rampPercent <= 0) return 0;
  if (!Number.isFinite(ceilingPercent) || ceilingPercent <= 0) return 0;

  const rampClamped = Math.min(100, Math.max(0, rampPercent));
  const ceilingClamped = Math.min(100, Math.max(0, ceilingPercent));
  const ampClamped = Math.min(255, Math.max(0, descriptorAmplitude));

  const product = (ampClamped * rampClamped * ceilingClamped) / (100 * 100);
  return Math.min(255, Math.max(0, Math.floor(product)));
}

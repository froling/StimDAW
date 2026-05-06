/**
 * LFO signal-evaluering — pure functions over LFO-state + tid.
 *
 * Phase-modell: fri-fas (deterministisk vid t=0, alla LFOs på phase 0)
 * + konstant user-offset (lfo.phase) + decaying glide-offset från senaste
 * rate-change. Ingen ackumulerande state — phase beräknas direkt från
 * absolut tid.
 *
 * Vid rate-change (lfo eller master) seedar state-mutator en PhaseGlide
 * så signalen är continuous initialt men konvergerar mot fri-fas inom
 * glideDur (default 1s). Resultat: smooth glide tills LFOs synkar igen
 * — bästa av båda världar (no click + deterministic timing).
 *
 * Master-clock: synth.masterRate (Hz) skalar alla LFO-rates uniformt.
 * effective_Hz = lfo.rate × masterRate. LFO.rate fungerar som multiplier
 * (default 1.0 = samma takt som master).
 */
import type { LFO, LfoChain, Modulator, PhaseGlide, WaveMode } from './types';
import { isLfoChain } from './types';
import { getWaveform } from './waveforms';

const TWO_PI = Math.PI * 2;

/** Wrap radians till [0, 2π). */
function wrap2pi(rad: number): number {
  return ((rad % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Polaritets-transform applicerad post-waveform, pre-amount.
 *
 * - bipolar (eller undefined): identity, output [-1, +1]
 * - negative-boost: negativ halva × 2 → output [-2, +1]. Med depth=1 +
 *   amount=1 räcker swing för att bottnar channel även när knob.base är
 *   högt (t.ex. amp=200/255 → kan nå 0). Positiv halva oförändrad.
 * - negative-only: shift+scale till [-1, 0] via (s-1)/2. Vågformskepnad
 *   bevarad men output ≤ 0 garanterat (LFO minskar bara, ökar aldrig).
 *
 * Pure function — testbar isolerat.
 */
export function applyLfoMode(signal: number, mode: WaveMode | undefined): number {
  switch (mode) {
    case 'negative-boost':
      return signal < 0 ? signal * 2 : signal;
    case 'negative-only':
      return (signal - 1) / 2;
    case 'bipolar':
    case undefined:
    default:
      return signal;
  }
}

/**
 * Räkna ut nuvarande glide-bidrag (rad). Linjär decay till 0 över glideDur.
 * Returnerar 0 om glide saknas, har utgått, eller är i framtiden.
 */
function evaluateGlide(glide: PhaseGlide | undefined, tMicros: number): number {
  if (!glide) return 0;
  const elapsed = tMicros - glide.glideStartMicros;
  if (elapsed < 0 || elapsed >= glide.glideDurMicros) return 0;
  const progress = elapsed / glide.glideDurMicros;
  return glide.offset * (1 - progress);
}

/**
 * Beräkna LFO:s effektiva fas vid tMicros — fri-fas + glide-offset +
 * user-set konstant offset. Wrappad till [0, 2π).
 *
 * Fri-fas-modellen: phase(t) = 2π × effectiveRate × t (mod 2π). Vid t=0
 * är phase=0 oberoende av historik — predictable timing i absolut tid.
 *
 * Vid rate-change seedar state.setLfoRate (eller setMasterRate) en glide
 * som decayar från offset → 0. Under decay-tiden glidar fasen smooth från
 * gamla rates fas-trajektoria mot nya rates fri-fas.
 */
export function effectiveLfoPhase(
  lfo: LFO,
  tMicros: number,
  masterRate: number,
): number {
  const tSec = tMicros / 1_000_000;
  const rateHz = lfo.rate * masterRate;
  const freePhase = wrap2pi(TWO_PI * rateHz * tSec);
  const glide = evaluateGlide(lfo.phaseGlide, tMicros);
  return wrap2pi(freePhase + glide + lfo.phase);
}

/**
 * Beräkna LFO output (-1..+1) × amount vid tMicros. masterRate är synth-
 * level multiplier (default 1.0 om ej specifierat — för pure tester).
 *
 * @param lfo  LFO-state
 * @param tMicros  Aktuell sim-tid i mikrosekunder
 * @param masterRate  Synth.masterRate (Hz). Default 1.0 (back-compat).
 */
export function computeLfoSignal(
  lfo: LFO,
  tMicros: number,
  masterRate: number = 1,
): number {
  if (!Number.isFinite(lfo.amount) || lfo.amount <= 0) return 0;
  if (!Number.isFinite(lfo.rate)) return 0;

  const phase = effectiveLfoPhase(lfo, tMicros, masterRate);
  const wave = getWaveform(lfo.shape);
  const shaped = applyLfoMode(wave(phase), lfo.mode);
  return shaped * Math.min(1, Math.max(0, lfo.amount));
}

// ──────────────────────────────────────────────────────────────────────
// LfoChain support — slav-modulator vars phase följer source
// ──────────────────────────────────────────────────────────────────────

/**
 * Lookup modulator by id. Söker både i lfos och chains. ID-prefix
 * (`lfo-N` / `chain-N`) gör det förutsägbart men vi söker linjärt för
 * enkelhet — modulator-arrayer är typiskt små (<10).
 */
export function lookupModulator(
  id: string,
  lfos: readonly LFO[],
  chains: readonly LfoChain[],
): Modulator | undefined {
  const lfo = lfos.find((l) => l.id === id);
  if (lfo) return lfo;
  return chains.find((c) => c.id === id);
}

/**
 * Beräkna en chains effektiva fas via källans effective phase.
 *
 *   - 'sync':      chain.phase = source.phase
 *   - 'offset':    chain.phase = source.phase + π (mod 2π)
 *   - 'alternate': chain.phase = 2 × source.phase (mod 2π) — chain hinner
 *                  spela 2 cykler under källans 1, men gating (i
 *                  computeChainSignal) släpper bara igenom källans neg-halva.
 *
 * Eftersom chain läser källans `effectiveLfoPhase`/`effectiveChainPhase`
 * inkl glide ärvs smooth-glide automatiskt — chain konvergerar mot fri-
 * fas tillsammans med källan.
 *
 * Cycle-skydd via visited-set så infinite recursion förhindras vid bug
 * i state-validering. Vid dangling source eller cycle: returnerar 0.
 */
export function effectiveChainPhase(
  chain: LfoChain,
  tMicros: number,
  masterRate: number,
  lfos: readonly LFO[],
  chains: readonly LfoChain[],
  visited: Set<string> = new Set(),
): number {
  if (visited.has(chain.id)) return 0;
  visited.add(chain.id);

  const source = lookupModulator(chain.sourceId, lfos, chains);
  if (!source) return 0;

  const sourcePhase = effectiveModulatorPhase(
    source,
    tMicros,
    masterRate,
    lfos,
    chains,
    visited,
  );

  switch (chain.trigger) {
    case 'sync':
      return sourcePhase;
    case 'offset':
      return wrap2pi(sourcePhase + Math.PI);
    case 'alternate':
      return wrap2pi(2 * sourcePhase);
    default:
      return 0;
  }
}

/**
 * Universell phase-evaluator för Modulator (LFO eller chain). Dispatch på typ.
 * Visited-set förs vidare för cycle-protection över rekursionen.
 */
export function effectiveModulatorPhase(
  modulator: Modulator,
  tMicros: number,
  masterRate: number,
  lfos: readonly LFO[],
  chains: readonly LfoChain[],
  visited: Set<string> = new Set(),
): number {
  if (isLfoChain(modulator)) {
    return effectiveChainPhase(modulator, tMicros, masterRate, lfos, chains, visited);
  }
  return effectiveLfoPhase(modulator, tMicros, masterRate);
}

/**
 * Beräkna LfoChain output (-1..+1 × amount) vid tMicros.
 *
 * Tre trigger-modes (alla räknar via effectiveChainPhase som ärver
 * källans glide):
 *
 * - 'sync': chain phase = källans phase. Layered modulation — chain
 *   spelar med en annan shape men samma takt och fas som källan.
 *
 * - 'offset': chain phase = källans phase + π. För symmetriska shapes
 *   ger matematisk invers. Båda spelar samtidigt, ingen gate.
 *
 * - 'alternate': chain phase = 2 × källans phase (2× rate), GATED till
 *   källans negativa halva. När källans signal ≥ 0 returneras 0
 *   (silent). När < 0 spelar chain med 2× rate så en hel cykel ryms
 *   inom källans negativa halva.
 *
 * Returnerar 0 vid: dangling source, amount ≤ 0, eller cycle.
 */
export function computeChainSignal(
  chain: LfoChain,
  tMicros: number,
  lfos: readonly LFO[],
  chains: readonly LfoChain[],
  masterRate: number = 1,
): number {
  if (!Number.isFinite(chain.amount) || chain.amount <= 0) return 0;
  const source = lookupModulator(chain.sourceId, lfos, chains);
  if (!source) return 0;

  // ALT: gate via källans signal-värde
  if (chain.trigger === 'alternate') {
    const sourceSignal = computeModulatorSignal(source, tMicros, lfos, chains, masterRate);
    if (sourceSignal >= 0) return 0;
  }

  const phase = effectiveChainPhase(chain, tMicros, masterRate, lfos, chains);
  const wave = getWaveform(chain.shape);
  const shaped = applyLfoMode(wave(phase), chain.mode);
  return shaped * Math.min(1, Math.max(0, chain.amount));
}

/**
 * Universell modulator-signal-evaluator. Dispatchar på modulator-typ.
 * Synth-engine.evaluateKnob använder denna istället för att direkt anropa
 * computeLfoSignal.
 */
export function computeModulatorSignal(
  modulator: Modulator,
  tMicros: number,
  lfos: readonly LFO[],
  chains: readonly LfoChain[],
  masterRate: number = 1,
): number {
  if (isLfoChain(modulator)) {
    return computeChainSignal(modulator, tMicros, lfos, chains, masterRate);
  }
  return computeLfoSignal(modulator, tMicros, masterRate);
}

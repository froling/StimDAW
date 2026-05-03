/**
 * LFO signal-evaluering — pure functions over LFO-state + tid.
 *
 * Phase ackumuleras externt (i state-mutators). Denna modul är `(lfo, t)
 * → signal` query, inte stateful tick. Det matchar Reason-modellen där
 * LFO är "always running" — du frågar "vad är värdet just nu?" snarare än
 * att stega state per sample.
 *
 * Per eng-review Hour 1: phase i radians (0..2π). Beräknas från lfo.phase
 * + ackumulerad delta sedan senast.
 */
import type { LFO, LfoChain, Modulator, WaveMode } from './types';
import { isLfoChain } from './types';
import { getWaveform } from './waveforms';

const TWO_PI = Math.PI * 2;

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
 * Beräkna LFO output (-1..+1) vid simNow. Returnerar signal × amount
 * (master gain). amount=0 → silent (0). rate=0 → DC-mode (output bara
 * from current phase utan accumulation; sine(phase) etc.).
 *
 * Per eng-review Hour 2-3: bipolar -1..+1. Cable-depth × range mappar
 * till hardware-units i synth-engine (inte här).
 *
 * @param lfo  LFO-state (rate, amount, shape, phase)
 * @param tMicros  Aktuell sim-tid i mikrosekunder. Används för att räkna
 *   ut current phase: phase + 2π × rate × (t - phaseAnchor). I praktiken
 *   kallas denna funktion av synth-engine vid varje channel-emit, så
 *   tMicros är emit-time. Vi returnerar phase-samplet vid den tiden.
 * @param phaseAnchorMicros  Tiden då lfo.phase var sant. Default 0
 *   (phase är absolut för all tid). State-mutators kan re-ankra vid
 *   rate-change för smooth transition.
 */
export function computeLfoSignal(
  lfo: LFO,
  tMicros: number,
  phaseAnchorMicros: number = 0,
): number {
  if (!Number.isFinite(lfo.amount) || lfo.amount <= 0) return 0;
  if (!Number.isFinite(lfo.rate)) return 0;

  const dtSec = (tMicros - phaseAnchorMicros) / 1_000_000;
  const phase = lfo.phase + TWO_PI * lfo.rate * dtSec;
  const wave = getWaveform(lfo.shape);
  // Apply polarity-mode på rå waveform-output, sedan scale med amount.
  const shaped = applyLfoMode(wave(phase), lfo.mode);
  return shaped * Math.min(1, Math.max(0, lfo.amount));
}

/**
 * Re-ankrera LFO phase vid rate-change så signalen är continuous.
 * Räknar fram aktuell phase vid simNow med gammal rate, sätter sedan
 * den som ny anchor → ny rate kommer användas framåt utan glitch.
 *
 * Returnerar ny LFO-state (immutable). Anropas av state-mutator
 * setLfoRate.
 */
export function reAnchorPhase(lfo: LFO, simNowMicros: number, oldAnchor: number): LFO {
  const dtSec = (simNowMicros - oldAnchor) / 1_000_000;
  const newPhase = (lfo.phase + TWO_PI * lfo.rate * dtSec) % TWO_PI;
  return { ...lfo, phase: newPhase };
}

// ──────────────────────────────────────────────────────────────────────
// LfoChain support — slav-modulator vars rate styrs av source-modulator
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
 * Beräkna effective rate (Hz) för en modulator, rekursivt.
 * För LFO: returnerar lfo.rate.
 * För LfoChain: source.effectiveRate × (trigger === 'half' ? 2 : 1).
 *
 * Cycle-skydd via visited-set så infinite recursion förhindras vid bug
 * i state-validering. Om dangling source eller cycle: returnerar 0.
 */
export function effectiveRate(
  modulator: Modulator,
  lfos: readonly LFO[],
  chains: readonly LfoChain[],
  visited: Set<string> = new Set(),
): number {
  if (visited.has(modulator.id)) return 0; // cycle protection
  visited.add(modulator.id);

  if (!isLfoChain(modulator)) {
    return Number.isFinite(modulator.rate) ? modulator.rate : 0;
  }
  // Chain — resolve source recursively
  const source = lookupModulator(modulator.sourceId, lfos, chains);
  if (!source) return 0; // dangling
  const srcRate = effectiveRate(source, lfos, chains, visited);
  return srcRate * (modulator.trigger === 'half' ? 2 : 1);
}

/**
 * Beräkna LfoChain output (-1..+1 × amount) vid simNow.
 *
 * Trigger-tempo:
 *   trigger_interval = 1 / source_effective_rate × (trigger==='half' ? 0.5 : 1)
 *
 * Phase resets vid varje trigger:
 *   phase_radians = ((t mod trigger_interval) / trigger_interval) × 2π
 *
 * Sedan: waveform(phase) → applyLfoMode → × amount.
 *
 * Returnerar 0 vid: dangling source, source rate ≤ 0, amount ≤ 0, eller
 * cycle (skyddat via visited-set i effectiveRate).
 */
export function computeChainSignal(
  chain: LfoChain,
  tMicros: number,
  lfos: readonly LFO[],
  chains: readonly LfoChain[],
): number {
  if (!Number.isFinite(chain.amount) || chain.amount <= 0) return 0;
  const source = lookupModulator(chain.sourceId, lfos, chains);
  if (!source) return 0;

  const srcRate = effectiveRate(source, lfos, chains);
  if (srcRate <= 0 || !Number.isFinite(srcRate)) return 0;

  // Source period (µs) → trigger interval
  const sourcePeriodMicros = 1_000_000 / srcRate;
  const triggerIntervalMicros =
    chain.trigger === 'half' ? sourcePeriodMicros / 2 : sourcePeriodMicros;
  if (triggerIntervalMicros <= 0) return 0;

  // Wrap t till positivt intervall (handles negativa tMicros defensivt)
  const tInInterval =
    ((tMicros % triggerIntervalMicros) + triggerIntervalMicros) % triggerIntervalMicros;
  const phaseRadians = (tInInterval / triggerIntervalMicros) * TWO_PI;

  const wave = getWaveform(chain.shape);
  const shaped = applyLfoMode(wave(phaseRadians), chain.mode);
  return shaped * Math.min(1, Math.max(0, chain.amount));
}

/**
 * Universell modulator-signal-evaluator. Dispatchar på modulator-typ.
 * Returnerar samma -1..+1 × amount × ev. mode-transform som de underliggande
 * compute-funktionerna. Synth-engine.evaluateKnob använder denna istället
 * för att direkt anropa computeLfoSignal.
 */
export function computeModulatorSignal(
  modulator: Modulator,
  tMicros: number,
  lfos: readonly LFO[],
  chains: readonly LfoChain[],
): number {
  if (isLfoChain(modulator)) {
    return computeChainSignal(modulator, tMicros, lfos, chains);
  }
  return computeLfoSignal(modulator, tMicros, modulator.phaseAnchorMicros);
}

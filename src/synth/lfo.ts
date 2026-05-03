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
import type { LFO, WaveMode } from './types';
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

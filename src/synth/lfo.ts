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
import type { LFO } from './types';
import { getWaveform } from './waveforms';

const TWO_PI = Math.PI * 2;

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
  return wave(phase) * Math.min(1, Math.max(0, lfo.amount));
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

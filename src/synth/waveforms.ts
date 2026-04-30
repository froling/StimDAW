/**
 * Pure waveform-genererande funktioner för LFOs.
 *
 * Phase i radians (0..2π) per eng-review Hour 1 decision. Output bipolar
 * -1..+1 (cable.depth × range mappar till hardware-units i synth-engine).
 *
 * Implementations är mathematical-pure (deterministic per input).
 * Inga DSP-tabeller eller anti-aliasing — LFOs är subaudio (typ 0.01-50Hz)
 * så aliasing är icke-issue. Aliasing skulle bara mattera om vi byggde
 * audio-rate-oscillatorer (γ).
 */

const TWO_PI = Math.PI * 2;

/**
 * Sine wave. Output -1..+1.
 * sine(0) = 0, sine(π/2) = 1, sine(π) = 0, sine(3π/2) = -1, sine(2π) = 0.
 */
export function sine(phaseRadians: number): number {
  return Math.sin(phaseRadians);
}

/**
 * Sawtooth (rising). Output -1..+1, monotont stigande inom cykel.
 * saw(0) = -1, saw(π) = 0, saw(2π) ≈ -1 (wrap).
 *
 * Formel: 2 × (phase / 2π) - 1, med wrap.
 */
export function saw(phaseRadians: number): number {
  const wrapped = ((phaseRadians % TWO_PI) + TWO_PI) % TWO_PI; // [0, 2π)
  return (wrapped / TWO_PI) * 2 - 1;
}

/**
 * Square wave. Output ±1.
 * square(0..π) = +1, square(π..2π) = -1.
 *
 * 50% duty cycle (klassisk square). Duty-modulering är γ.
 */
export function square(phaseRadians: number): number {
  const wrapped = ((phaseRadians % TWO_PI) + TWO_PI) % TWO_PI;
  return wrapped < Math.PI ? 1 : -1;
}

/**
 * Triangle wave. Output -1..+1, linjärt rising 0..π/2, falling π/2..3π/2,
 * rising 3π/2..2π.
 *
 * Formel: 1 - |2 × (phase/π) - 1| inom [0, π], skift för [π, 2π].
 * Smoother alternativ till saw för subtil modulering.
 */
export function triangle(phaseRadians: number): number {
  const wrapped = ((phaseRadians % TWO_PI) + TWO_PI) % TWO_PI;
  const t = wrapped / TWO_PI; // [0, 1)
  // Triangular: 0 → +1 → 0 → -1 → 0 över t=[0..0.25..0.5..0.75..1]
  if (t < 0.25) return t * 4;
  if (t < 0.75) return 2 - t * 4;
  return t * 4 - 4;
}

/** Map shape-string till waveform-funktion. Used by lfo.ts. */
export function getWaveform(
  shape: 'sine' | 'saw' | 'square' | 'triangle',
): (phase: number) => number {
  switch (shape) {
    case 'sine':
      return sine;
    case 'saw':
      return saw;
    case 'square':
      return square;
    case 'triangle':
      return triangle;
  }
}

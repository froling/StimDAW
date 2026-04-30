/**
 * Pure helpers för Knob.svelte UX.
 *
 * Per eng-review 1.4A:
 *   - Vertikal drag (DAW-standard): mus uppåt → öka, neråt → minska
 *   - Shift modifier = fine-grain (10× sensitivity)
 *   - Log-scale för pace (4 dekader: 5ms..62.5ms)
 *   - Double-click = reset till default
 *
 * Separat fil för bun-test:barhet — Svelte 5 $state-runtime är inte
 * tillgängligt i bun-test (känt från α2 csv-filename-incident).
 */

export interface KnobBounds {
  readonly min: number;
  readonly max: number;
}

export interface KnobScaleOptions {
  /** Use log-scale (för pace 5..62500µs). Default false (linear). */
  readonly log?: boolean;
}

/**
 * Map normaliserad position [0..1] → value within bounds.
 * Linear: t=0 → min, t=1 → max, t=0.5 → midpoint.
 * Log:    t=0 → min, t=1 → max, t=0.5 → geometric mean (√(min × max)).
 */
export function tToValue(
  t: number,
  bounds: KnobBounds,
  options: KnobScaleOptions = {},
): number {
  const tClamped = Math.max(0, Math.min(1, t));
  if (options.log) {
    // Log mapping kräver positive bounds — för pace gäller alltid (min=5000)
    if (bounds.min <= 0 || bounds.max <= 0) {
      // Falla tillbaka till linear för säkerhet
      return bounds.min + tClamped * (bounds.max - bounds.min);
    }
    const lnMin = Math.log(bounds.min);
    const lnMax = Math.log(bounds.max);
    return Math.exp(lnMin + tClamped * (lnMax - lnMin));
  }
  return bounds.min + tClamped * (bounds.max - bounds.min);
}

/**
 * Inverse av tToValue: value → normaliserad position [0..1].
 * Used för visuell knob-rotation (var i ringen visar pekaren?).
 */
export function valueToT(
  value: number,
  bounds: KnobBounds,
  options: KnobScaleOptions = {},
): number {
  if (options.log && bounds.min > 0 && bounds.max > 0) {
    const v = Math.max(bounds.min, Math.min(bounds.max, value));
    const lnMin = Math.log(bounds.min);
    const lnMax = Math.log(bounds.max);
    return (Math.log(v) - lnMin) / (lnMax - lnMin);
  }
  const v = Math.max(bounds.min, Math.min(bounds.max, value));
  return (v - bounds.min) / (bounds.max - bounds.min);
}

/**
 * Konvertera mouse drag-delta (pixels) till värde-delta för knob.
 *
 * Sensitivity: hur många pixlar för full-range-drag. Default 200px → 1.0 t.
 * Vertikal: upp (negative deltaY) = öka värde.
 * Shift modifier: 10× mindre känslighet (fine-grain) per eng-review 1.4A.
 *
 * Returnerar nytt värde (clampat till bounds).
 */
export function dragDeltaToValue(
  currentValue: number,
  deltaY: number,
  bounds: KnobBounds,
  options: KnobScaleOptions & {
    readonly fineGrain?: boolean;
    readonly sensitivityPixels?: number;
  } = {},
): number {
  const sens = options.sensitivityPixels ?? 200;
  const factor = options.fineGrain ? 10 : 1;
  const tDelta = -deltaY / (sens * factor); // upp = positiv
  const tCurrent = valueToT(currentValue, bounds, options);
  const tNew = Math.max(0, Math.min(1, tCurrent + tDelta));
  return tToValue(tNew, bounds, options);
}

/**
 * Format value för readout. Returns objekt med number + suffix för UI:
 *   pulse_width 144 → { display: '144', unit: 'µs' }
 *   pace 25000 → { display: '25.0', unit: 'ms' }   (för läsbarhet)
 *   amp 128 → { display: '50', unit: '%' }          (mappat till percent)
 */
export type KnobUnit = 'us' | 'ms' | 'percent' | 'hz';

export function formatKnobValue(
  value: number,
  unit: KnobUnit,
): { display: string; suffix: string } {
  switch (unit) {
    case 'us':
      return { display: Math.round(value).toString(), suffix: 'µs' };
    case 'ms':
      return { display: (value / 1000).toFixed(1), suffix: 'ms' };
    case 'percent':
      // Antagande: input är 0..255, mappar till 0..100%
      return { display: Math.round((value / 255) * 100).toString(), suffix: '%' };
    case 'hz':
      return { display: value.toFixed(2), suffix: 'Hz' };
  }
}

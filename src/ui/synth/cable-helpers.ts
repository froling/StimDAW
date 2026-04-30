/**
 * Pure helpers för cable-rendering — bezier-paths och LFO-färgpalett.
 *
 * Per design-audit F4: cable inherits LFO source color, plus textlabel
 * "L1"/"L2" mid-cable för color-blind-tillgänglighet.
 *
 * Per audit J.3 visual-identity: cables har subtil sag-curve som ekar
 * Eurorack patch-cables (control points pulled vertical 8px). Inte fysik-
 * accurate men ger "instrument"-känsla.
 */

/**
 * Bygg SVG d-string för bezier från (x1,y1) till (x2,y2) med vertical sag.
 *
 * Control points placerade på 1/3 och 2/3 av vägen, med extra y-offset
 * (sag) för "hängande cable" feel. Default sag=8px ger subtil curve.
 *
 * sag=0 ger raka linje (för testing). sag=20 ger pronounced sag.
 */
export function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sag = 8,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx1 = x1 + dx / 3;
  const cy1 = y1 + dy / 3 + sag;
  const cx2 = x1 + (dx * 2) / 3;
  const cy2 = y1 + (dy * 2) / 3 + sag;
  return `M${x1.toFixed(2)},${y1.toFixed(2)} C${cx1.toFixed(2)},${cy1.toFixed(2)} ${cx2.toFixed(2)},${cy2.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

/**
 * Beräkna mid-point på bezier (för textlabel-placering).
 * t=0.5 ger geometric center med sag inkluderad. Approx via control-point-mean.
 */
export function bezierMidpoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sag = 8,
): { x: number; y: number } {
  // Cubic bezier vid t=0.5: P = (1/8)(P0 + 3P1 + 3P2 + P3)
  // med våra control points → midX = (x1+x2)/2, midY = (y1+y2)/2 + (3/4)*sag
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2 + (3 * sag) / 4,
  };
}

/**
 * LFO-färgpalett per design-audit F4. Deterministic mapping från LFO-index
 * till färg. Fyra distinkta hues — räcker för β.0 typiska use-case (1-3 LFOs).
 *
 * Färgvalen från audit:
 *   --lfo-1: magenta (LFO 1, primary modulation source)
 *   --lfo-2: cyan
 *   --lfo-3: gul
 *   --lfo-4: grön (matchar dot-running för continuity)
 *
 * För indices > 3, wrappar (modulo). I praktiken har β.0 sällan >4 LFOs.
 */
export const LFO_COLOR_PALETTE = [
  '#dd3388', // L1 magenta
  '#22aacc', // L2 cyan
  '#ddaa22', // L3 yellow
  '#66bb66', // L4 green
] as const;

/**
 * Map lfo-index (0-baserad position i state.lfos) → hex-färg.
 * Fall-back till neutral grå för out-of-bound (defensive).
 */
export function lfoColor(lfoIndex: number): string {
  if (lfoIndex < 0) return '#888';
  return LFO_COLOR_PALETTE[lfoIndex % LFO_COLOR_PALETTE.length]!;
}

/**
 * Lookup LFO-färg via id. Returnerar färg + label ("L1", "L2", etc.) för
 * a11y-textlabel mid-cable.
 */
export function lfoColorAndLabel(
  lfos: readonly { id: string }[],
  lfoId: string,
): { color: string; label: string } {
  const index = lfos.findIndex((l) => l.id === lfoId);
  if (index < 0) return { color: '#888', label: '?' };
  return { color: lfoColor(index), label: `L${index + 1}` };
}

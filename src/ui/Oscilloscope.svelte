<script lang="ts">
  /**
   * β Oscilloscope — envelope/waveform-style.
   *
   * Per BETA_OSCILLOSCOPE.md re-design 2026-05-02:
   * Visar en SMOOTH amplitudkurva per elektrod över 6s istället för
   * diskreta puls-rektanglar. Modellerar känsla över tid:
   *   - Höjd = intensity (sum amp × pw normaliserat per bin)
   *   - Färg = vägd polaritet (varm orange ↔ kall blå, gradient genom neutral)
   *   - Bursts → höga jämna former, glesheter → låga
   *
   * Pure-render: läser app.envelopeFrame, ritar SVG. Frame-data produceras
   * av envelope-frame.ts vid 30Hz tick.
   */
  import { app } from './stores.svelte';
  import type { EnvelopeFrame, EnvelopeRow } from '../oscilloscope/envelope-frame';

  const VIEW_W = 1000;
  const ROW_H = 38;
  const ROW_GAP = 4;

  const ELECTRODES: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

  let frame = $derived<EnvelopeFrame | null>(app.envelopeFrame);

  function timeToX(streamMicros: number, f: EnvelopeFrame): number {
    const start = f.streamNowMicros - f.windowMicros;
    return ((streamMicros - start) / f.windowMicros) * VIEW_W;
  }

  function rowYTop(rowIdx: number): number {
    return rowIdx * (ROW_H + ROW_GAP);
  }

  function totalHeight(): number {
    return ELECTRODES.length * (ROW_H + ROW_GAP) - ROW_GAP;
  }

  /**
   * Bygg fylld envelope-path för en electrode-rad. Höjd = ampNorm.
   * Path stänger via baseline-loop. Smooth via quadratic-bezier.
   */
  function buildEnvelopePath(row: EnvelopeRow, yTop: number, f: EnvelopeFrame): string {
    if (row.bins.length === 0) return '';
    const yBaseline = yTop + ROW_H;
    const parts: string[] = [];
    const firstX = timeToX(row.bins[0]!.streamTimeMicros, f);
    parts.push(`M${firstX.toFixed(2)},${yBaseline.toFixed(2)}`);
    for (let i = 0; i < row.bins.length; i++) {
      const bin = row.bins[i]!;
      const x = timeToX(bin.streamTimeMicros, f);
      const y = yBaseline - bin.ampNorm * ROW_H;
      if (i === 0) {
        parts.push(`L${x.toFixed(2)},${y.toFixed(2)}`);
        continue;
      }
      const prev = row.bins[i - 1]!;
      const prevX = timeToX(prev.streamTimeMicros, f);
      const prevY = yBaseline - prev.ampNorm * ROW_H;
      const ctrlX = (prevX + x) / 2;
      parts.push(`Q${ctrlX.toFixed(2)},${prevY.toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`);
    }
    const lastX = timeToX(row.bins[row.bins.length - 1]!.streamTimeMicros, f);
    parts.push(`L${lastX.toFixed(2)},${yBaseline.toFixed(2)}`);
    parts.push(`L${firstX.toFixed(2)},${yBaseline.toFixed(2)}`);
    parts.push('Z');
    return parts.join(' ');
  }

  /**
   * Bygg "topp-linje" path som följer envelope (utan baseline-stängning).
   * Stroke-tjocklek varieras dynamiskt per bin via per-bin path-segments.
   * Här returnerar vi bara den smooth toppkurvan; stroke-width sätts via SVG-attribut.
   */
  function buildTopLine(row: EnvelopeRow, yTop: number, f: EnvelopeFrame): string {
    if (row.bins.length < 2) return '';
    const yBaseline = yTop + ROW_H;
    const parts: string[] = [];
    for (let i = 0; i < row.bins.length; i++) {
      const bin = row.bins[i]!;
      const x = timeToX(bin.streamTimeMicros, f);
      const y = yBaseline - bin.ampNorm * ROW_H;
      if (i === 0) {
        parts.push(`M${x.toFixed(2)},${y.toFixed(2)}`);
        continue;
      }
      const prev = row.bins[i - 1]!;
      const prevX = timeToX(prev.streamTimeMicros, f);
      const prevY = yBaseline - prev.ampNorm * ROW_H;
      const ctrlX = (prevX + x) / 2;
      parts.push(`Q${ctrlX.toFixed(2)},${prevY.toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return parts.join(' ');
  }

  /** Genomsnittlig pwNorm för raden — driver topp-linjens stroke-tjocklek. */
  function avgPwNorm(row: EnvelopeRow): number {
    let sum = 0;
    let count = 0;
    for (const bin of row.bins) {
      if (bin.pulseCount > 0) {
        sum += bin.pwNorm;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  /** Stroke-tjocklek baserat på pulse_width — bredare puls = tjockare topp-linje. */
  function topLineStrokeWidth(row: EnvelopeRow): number {
    return 0.8 + avgPwNorm(row) * 3.5;
  }
</script>

<section class="osc">
  <div class="osc-title-bar">
    <h2 class="osc-title">Sensation envelope</h2>
    <span class="osc-summary">
      {#if !frame}
        no source
      {:else}
        4 electrodes · {frame.binDurationMicros / 1000}ms bins
      {/if}
    </span>
  </div>

  <div class="osc-time-axis">
    <span>−6s</span>
    <span>−4s</span>
    <span>−2s</span>
    <span>now</span>
  </div>

  {#if !frame}
    <div class="osc-empty">
      <p>No active source.</p>
      <p class="hint">Pick a pattern (Patterns tab) or run the Mixer to feel pulses over time.</p>
    </div>
  {:else}
    <div class="osc-canvas">
      <svg
        viewBox="0 0 {VIEW_W} {totalHeight()}"
        preserveAspectRatio="none"
        class="osc-svg"
        data-testid="envelope-svg"
      >
        <!-- Envelope per electrode (Vcap-band borttagen — telemetri visas i Live Monitor) -->
        {#each ELECTRODES as electrode, idx (electrode)}
          {@const yTop = rowYTop(idx)}
          {@const row = frame.rows.find((r) => r.electrode === electrode)}
          <g class="envelope-row" data-testid="envelope-row" data-electrode={electrode}>
            <rect x="0" y={yTop} width={VIEW_W} height={ROW_H} class="row-bg" />
            <line
              x1="0"
              y1={yTop + ROW_H}
              x2={VIEW_W}
              y2={yTop + ROW_H}
              class="row-baseline"
            />
            {#if row}
              <path
                class="envelope-fill"
                d={buildEnvelopePath(row, yTop, frame)}
              />
              <path
                class="envelope-topline"
                d={buildTopLine(row, yTop, frame)}
                stroke-width={topLineStrokeWidth(row).toFixed(2)}
              />
            {/if}
          </g>
        {/each}

        <!-- Row labels -->
        {#each ELECTRODES as electrode, idx (electrode + '-label')}
          {@const yTop = rowYTop(idx)}
          <text
            x="6"
            y={yTop + ROW_H / 2 + 4}
            class="row-label"
            data-testid="envelope-row-label"
          >{electrode}</text>
        {/each}
      </svg>
    </div>
  {/if}

  <div class="osc-legend">
    <span class="legend-item">
      <span class="legend-swatch fill"></span> fill height ∝ amplitude
    </span>
    <span class="legend-item">
      <span class="legend-swatch line"></span> line thickness ∝ pulse_width
    </span>
    <span class="legend-hint">Density horizontally = pace (rhythm)</span>
  </div>
</section>

<style>
  .osc {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    overflow: hidden;
  }
  .osc-title-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 1.25rem;
    border-bottom: 1px solid #e5e5e5;
  }
  .osc-title {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin: 0;
  }
  .osc-summary {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #888;
  }
  .osc-time-axis {
    display: flex;
    justify-content: space-between;
    padding: 0.3rem 1.25rem;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    color: #888;
    border-bottom: 1px solid #f3f3f3;
  }
  .osc-empty {
    padding: 2rem 1.25rem;
    text-align: center;
    color: #888;
  }
  .osc-empty p { margin: 0; }
  .osc-empty .hint { font-size: 0.85rem; color: #aaa; margin-top: 0.4rem; }
  .osc-canvas { padding: 0.5rem 1.25rem; }
  .osc-svg {
    display: block;
    width: 100%;
    height: 220px;
  }
  .row-bg { fill: #fafafa; }
  .row-baseline {
    stroke: #e5e5e5;
    stroke-width: 0.4;
    vector-effect: non-scaling-stroke;
  }
  .envelope-fill {
    fill: rgba(217, 106, 61, 0.45); /* singel warm tone, semi-transparent */
    stroke: none;
  }
  .envelope-topline {
    fill: none;
    stroke: #d96a3d;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .row-label {
    font-family: ui-monospace, monospace;
    font-size: 14px;
    fill: #888;
    font-weight: 600;
    pointer-events: none;
  }
  .osc-legend {
    display: flex;
    gap: 1rem;
    padding: 0.5rem 1.25rem;
    border-top: 1px solid #f3f3f3;
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    color: #666;
    flex-wrap: wrap;
    align-items: center;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .legend-swatch {
    display: inline-block;
    width: 14px;
    height: 10px;
    border-radius: 2px;
  }
  .legend-swatch.fill { background: rgba(217, 106, 61, 0.45); }
  .legend-swatch.line {
    background: transparent;
    border-bottom: 3px solid #d96a3d;
    height: 6px;
    align-self: center;
  }
  .legend-hint {
    color: #aaa;
    margin-left: auto;
    font-style: italic;
  }
</style>

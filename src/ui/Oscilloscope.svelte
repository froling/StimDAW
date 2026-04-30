<script lang="ts">
  import { app, toggleElconVisibility, toggleTrace } from './stores.svelte';
  import { uniqueElcons, elconId, elconToLabel, type Elcon } from '../patterns/types';
  import type { WaveformSample } from '../mock-firmware/waveform';
  import {
    meanPulseWidthMicros,
    meanPaceMicros,
    pulseWidthPercent,
    pacePercent,
  } from './descriptor-timing';
  import type { DispatchedDescriptor } from '../mock-firmware/firmware';

  // Layout-konstanter — top chart (signed amp/vcap, 70% rad-höjd)
  const VIEW_W = 100;
  const VIEW_H = 40;
  const Y_PAD = 2;
  const CENTER_Y = VIEW_H / 2; // 0-baseline i mitten (post user req 2026-05)
  const HALF_H = (VIEW_H - 2 * Y_PAD) / 2;
  const WINDOW_MICROS = 6_000_000; // 6s rolling window per design lock
  const VCAP_MAX = 80_000; // mV — full-scale för vcap-magnitud

  // Timing sub-chart — 30% rad-höjd, 0-baseline botten
  const TIMING_VIEW_H = 17; // viewBox-höjd för timing sub-chart
  const TIMING_Y_PAD = 1;
  const TIMING_BAR_W = 0.6; // bredd på varje stapel (SVG units)
  const TIMING_BAR_GAP = 0.1; // gap mellan pulse-width och pace inom samma descriptor

  /**
   * Tid → x-koordinat. Senaste sample (timestamp == nowMicros) hamnar vid x=100,
   * äldre samples flyttas vänster. Samples äldre än window-start klipps bort.
   */
  function timeToX(timestampMicros: number, nowMicros: number): number {
    return (VIEW_W * (timestampMicros - (nowMicros - WINDOW_MICROS))) / WINDOW_MICROS;
  }

  /**
   * Signed value (-1..+1) → y-koordinat. 0 i mitten (CENTER_Y),
   * +1 toppen, -1 botten. Värden utanför clampas inte här — caller normaliserar.
   */
  function signedToY(signed: number): number {
    return CENTER_Y - signed * HALF_H;
  }

  /** Filtrera samples till de som är inom det rolling window. */
  function withinWindow(samples: WaveformSample[], nowMicros: number): WaveformSample[] {
    const start = nowMicros - WINDOW_MICROS;
    // Optimization: samples är monotont stigande timestamps, så vi kan bara
    // skipa from början tills vi hittar första som är ≥ start
    let firstIdx = 0;
    while (firstIdx < samples.length && samples[firstIdx]!.timestampMicros < start) firstIdx++;
    return firstIdx === 0 ? samples : samples.slice(firstIdx);
  }

  /**
   * Step-line path för amp. Tids-baserad x-positionering så grafen rullar.
   * Signed value: amp/255 multiplicerat med phase-sign (phase=0 → +, phase=1 → -)
   * så biphasic-pulser går uppåt resp nedåt från 0-baseline.
   */
  function buildAmpPath(samples: WaveformSample[], nowMicros: number): string {
    const visible = withinWindow(samples, nowMicros);
    if (visible.length === 0) return '';
    const ampSigned = (s: WaveformSample): number =>
      (s.amp / 255) * (s.phase === 0 ? 1 : -1);
    let prevX = timeToX(visible[0]!.timestampMicros, nowMicros);
    let prevY = signedToY(ampSigned(visible[0]!));
    let d = `M${prevX.toFixed(2)},${prevY.toFixed(2)}`;
    for (let i = 1; i < visible.length; i++) {
      const x = timeToX(visible[i]!.timestampMicros, nowMicros);
      const y = signedToY(ampSigned(visible[i]!));
      if (Math.abs(y - prevY) > 0.05) {
        d += ` L${x.toFixed(2)},${prevY.toFixed(2)} L${x.toFixed(2)},${y.toFixed(2)}`;
      } else {
        d += ` L${x.toFixed(2)},${y.toFixed(2)}`;
      }
      prevY = y;
    }
    return d;
  }

  /**
   * Smooth path för Vcap, samma rolling x-positionering.
   * Vcap är redan signed i sample (RC-followern multiplicerar med phase-sign),
   * vi normaliserar bara mot VCAP_MAX för -1..+1-domänen.
   */
  function buildVcapPath(samples: WaveformSample[], nowMicros: number): string {
    const visible = withinWindow(samples, nowMicros);
    if (visible.length === 0) return '';
    return visible
      .map(
        (s, i) =>
          `${i === 0 ? 'M' : 'L'}${timeToX(s.timestampMicros, nowMicros).toFixed(2)},${signedToY(s.vcap / VCAP_MAX).toFixed(2)}`,
      )
      .join(' ');
  }

  /** Senaste amp-värde i % för readout (signed: + uppåt, - nedåt). */
  function lastAmpPercent(samples: WaveformSample[]): number {
    if (samples.length === 0) return 0;
    const last = samples[samples.length - 1]!;
    const sign = last.phase === 0 ? 1 : -1;
    return Math.round((last.amp / 255) * 100) * sign;
  }

  /** Senaste vcap i V för readout (signed). */
  function lastVcapVolts(samples: WaveformSample[]): number {
    if (samples.length === 0) return 0;
    const last = samples[samples.length - 1]!;
    return Math.round(last.vcap / 1000);
  }

  /**
   * Filtrera dispatched-descriptors till de som hör till denna rad's elcon
   * OCH ligger inom 6s rolling window. Bevarar ordning (descTime stigande).
   */
  function timingBarsForRow(
    dispatched: readonly DispatchedDescriptor[],
    elcId: string,
    nowMicros: number,
  ): DispatchedDescriptor[] {
    const start = nowMicros - WINDOW_MICROS;
    const out: DispatchedDescriptor[] = [];
    for (const d of dispatched) {
      if (d.dispatchedAtMicros < start) continue;
      if (d.dispatchedAtMicros > nowMicros) break; // future = utanför window
      const id = `${d.descriptor.electrodeSet[0]}-${d.descriptor.electrodeSet[1]}`;
      if (id !== elcId) continue;
      out.push(d);
    }
    return out;
  }

  /** Procent → y-koordinat i timing sub-chart (0% botten, 100% topp). */
  function timingPercentToY(pct: number): number {
    return TIMING_VIEW_H - TIMING_Y_PAD - pct * (TIMING_VIEW_H - 2 * TIMING_Y_PAD);
  }

  /** Senaste descriptor's mean pulse_width µs för readout. */
  function lastPulseWidthMicros(bars: readonly DispatchedDescriptor[]): number {
    if (bars.length === 0) return 0;
    return Math.round(meanPulseWidthMicros(bars[bars.length - 1]!.descriptor));
  }

  /** Senaste descriptor's mean pace µs för readout. */
  function lastPaceMicros(bars: readonly DispatchedDescriptor[]): number {
    if (bars.length === 0) return 0;
    return Math.round(meanPaceMicros(bars[bars.length - 1]!.descriptor));
  }

  // Reactive: lista av rows från currentPattern + buffers + timing-bars
  type RowInfo = {
    id: string;
    elcon: Elcon;
    label: string;
    visible: boolean;
    samples: WaveformSample[];
    timingBars: DispatchedDescriptor[];
  };

  let rows = $derived.by((): RowInfo[] => {
    if (!app.currentPattern) return [];
    const now = app.waveformNowMicros;
    return uniqueElcons(app.currentPattern.elcons).map((elcon) => {
      const id = elconId(elcon);
      return {
        id,
        elcon,
        label: elconToLabel(elcon),
        visible: app.visibleElcons.has(id),
        samples: app.waveformBuffers.get(id) ?? [],
        timingBars: timingBarsForRow(app.dispatchedDescriptors, id, now),
      };
    });
  });

  let visibleCount = $derived(rows.filter((r) => r.visible).length);
  let totalCount = $derived(rows.length);
  let traceCount = $derived(app.activeTraces.size);
  let ampActive = $derived(app.activeTraces.has('amp'));
  let vcapActive = $derived(app.activeTraces.has('vcap'));
  let pulseWidthActive = $derived(app.activeTraces.has('pulse-width'));
  let paceActive = $derived(app.activeTraces.has('pace'));
  let timingActive = $derived(pulseWidthActive || paceActive);
</script>

<section class="osc">
  <div class="osc-title-bar">
    <h2 class="osc-title">Oscilloscope</h2>
    <span class="osc-channel-summary">
      {#if totalCount === 0}
        no pattern
      {:else}
        {visibleCount}/{totalCount} visible · {traceCount} {traceCount === 1 ? 'trace' : 'traces'}
      {/if}
    </span>
  </div>

  <div class="osc-legend">
    <button
      type="button"
      class="legend-item"
      class:off={!ampActive}
      onclick={() => toggleTrace('amp')}
    >
      <span class="legend-swatch" style="background:var(--trace-amp,#0066cc)"></span>
      amplitude
    </button>
    <button
      type="button"
      class="legend-item"
      class:off={!vcapActive}
      onclick={() => toggleTrace('vcap')}
    >
      <span class="legend-swatch" style="background:var(--trace-vcap,#cc6600)"></span>
      Vcap
    </button>
    <button
      type="button"
      class="legend-item"
      class:off={!pulseWidthActive}
      onclick={() => toggleTrace('pulse-width')}
      title="pulse_width µs (2..200) som % av hardware-range"
    >
      <span class="legend-swatch" style="background:var(--trace-pulse-width,#8844cc)"></span>
      pulse width
    </button>
    <button
      type="button"
      class="legend-item"
      class:off={!paceActive}
      onclick={() => toggleTrace('pace')}
      title="pace µs (5ms..62.5ms) som % av hardware-range"
    >
      <span class="legend-swatch" style="background:var(--trace-pace,#44aa44)"></span>
      pace
    </button>
    <span class="legend-future">+ add trace…</span>
  </div>

  <div class="osc-time-axis">
    <span>−6s</span>
    <span>−4s</span>
    <span>−2s</span>
    <span>now</span>
  </div>

  {#if rows.length === 0}
    <div class="osc-empty">
      <p>No pattern selected.</p>
      <p class="hint">Pick a pattern in the runner panel above to begin.</p>
    </div>
  {:else}
    <div class="osc-rows">
      {#each rows as row (row.id)}
        <div class="osc-row" class:hidden={!row.visible}>
          <button
            class="osc-eye"
            type="button"
            title={row.visible ? 'Hide channel' : 'Show channel'}
            onclick={() => toggleElconVisibility(row.id)}
          >
            {row.visible ? '●' : '○'}
          </button>
          <span class="osc-elcon">{row.label}</span>
          {#if row.visible}
            <div class="osc-charts" class:has-timing={timingActive}>
              <!-- Top chart: amp/vcap signed (70% rad-höjd) -->
              <div class="osc-chart osc-chart-signed">
                <svg viewBox="0 0 100 40" preserveAspectRatio="none">
                  <!-- ±50% guide-linjer (extra svaga) -->
                  <line class="grid-line" x1="0" y1="11" x2="100" y2="11" />
                  <line class="grid-line" x1="0" y1="29" x2="100" y2="29" />
                  <!-- 0-baseline i mitten (svag grå) — biphasic polaritet -->
                  <line class="baseline-zero" x1="0" y1="20" x2="100" y2="20" />
                  {#if vcapActive && row.samples.length > 1}
                    <path class="trace-vcap" d={buildVcapPath(row.samples, app.waveformNowMicros)} />
                  {/if}
                  {#if ampActive && row.samples.length > 0}
                    <path class="trace-amp" d={buildAmpPath(row.samples, app.waveformNowMicros)} />
                  {/if}
                </svg>
              </div>
              <!-- Bottom chart: timing (pulse_width / pace) som vertikala staplar
                   per dispatched descriptor. 0 längst ner, 100% längst upp.
                   Hardware-range: pw 2..200µs, pace 5..62.5ms. -->
              {#if timingActive}
                <div class="osc-chart osc-chart-timing">
                  <svg viewBox="0 0 100 {TIMING_VIEW_H}" preserveAspectRatio="none">
                    <line
                      class="baseline-zero"
                      x1="0"
                      y1={TIMING_VIEW_H - TIMING_Y_PAD}
                      x2="100"
                      y2={TIMING_VIEW_H - TIMING_Y_PAD}
                    />
                    {#each row.timingBars as bar (bar.dispatchedAtMicros + '-' + bar.descriptor.sequenceNumber)}
                      {@const barX = timeToX(bar.dispatchedAtMicros, app.waveformNowMicros)}
                      {@const pwY = timingPercentToY(pulseWidthPercent(meanPulseWidthMicros(bar.descriptor)))}
                      {@const paY = timingPercentToY(pacePercent(meanPaceMicros(bar.descriptor)))}
                      {@const yBase = TIMING_VIEW_H - TIMING_Y_PAD}
                      {#if pulseWidthActive}
                        <rect
                          class="bar-pulse-width"
                          x={(barX - TIMING_BAR_W - TIMING_BAR_GAP / 2).toFixed(2)}
                          y={pwY.toFixed(2)}
                          width={TIMING_BAR_W}
                          height={(yBase - pwY).toFixed(2)}
                        />
                      {/if}
                      {#if paceActive}
                        <rect
                          class="bar-pace"
                          x={(barX + TIMING_BAR_GAP / 2).toFixed(2)}
                          y={paY.toFixed(2)}
                          width={TIMING_BAR_W}
                          height={(yBase - paY).toFixed(2)}
                        />
                      {/if}
                    {/each}
                  </svg>
                </div>
              {/if}
            </div>
            <span class="osc-readout">
              {#if ampActive}
                <span class="osc-readout-amp">{lastAmpPercent(row.samples)}%</span>
              {/if}
              {#if vcapActive}
                <span class="osc-readout-vcap">{lastVcapVolts(row.samples)}V</span>
              {/if}
              {#if pulseWidthActive}
                <span class="osc-readout-pw">{lastPulseWidthMicros(row.timingBars)}µs</span>
              {/if}
              {#if paceActive}
                <span class="osc-readout-pa"
                  >{(lastPaceMicros(row.timingBars) / 1000).toFixed(1)}ms</span
                >
              {/if}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  /* ──────────────────────────────────────────────────────────────────
     Design tokens — single source-of-truth för Oscilloscope-dimensioner
     och färger. Scope:ade till .osc (komponent-lokala) snarare än :root.
     Ändra här → påverkar både desktop och mobile-breakpoint nedan.
     ────────────────────────────────────────────────────────────────── */
  .osc {
    /* Trace colors */
    --trace-amp: #0066cc;
    --trace-vcap: #cc6600;
    --trace-pulse-width: #8844cc;
    --trace-pace: #44aa44;
    --trace-iprim: #008866;

    /* Chart heights — desktop */
    --osc-chart-signed-h: 42px;
    --osc-chart-timing-h: 16px;
    --osc-chart-gap: 2px;

    /* Row layout — desktop */
    --osc-row-h: 76px;
    --osc-row-h-hidden: 24px;
    --osc-eye-col: 32px;
    --osc-label-col: 130px;
    --osc-readout-col: 80px;
    --osc-row-padding-x: 1rem;
    --osc-row-gap: 0.85rem;

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
  .osc-channel-summary {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #888;
  }

  .osc-legend {
    display: flex;
    gap: 1.25rem;
    padding: 0.5rem 1.25rem;
    border-bottom: 1px solid #f3f3f3;
    background: #fcfcfc;
    font-size: 0.78rem;
    font-family: ui-monospace, monospace;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: #555;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font: inherit;
  }
  .legend-item.off {
    color: #bbb;
    text-decoration: line-through;
  }
  .legend-swatch {
    display: inline-block;
    width: 14px;
    height: 2px;
    border-radius: 1px;
  }
  .legend-future {
    color: #aaa;
    font-style: italic;
  }

  .osc-time-axis {
    display: flex;
    justify-content: space-between;
    /* Padding-left aligns time-axis labels med chart-X start (efter eye-col +
       label-col + row-padding + row-gap). Single source-of-truth via vars
       så desktop/mobile hålls i sync. */
    padding: 0.3rem 1rem 0.3rem
      calc(
        var(--osc-eye-col) + var(--osc-label-col) + var(--osc-row-padding-x) +
          var(--osc-row-gap)
      );
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
  .osc-empty p {
    margin: 0;
  }
  .osc-empty .hint {
    font-size: 0.85rem;
    color: #aaa;
    margin-top: 0.4rem;
  }

  .osc-rows {
    padding: 0.4rem 0;
  }
  .osc-row {
    display: grid;
    grid-template-columns:
      var(--osc-eye-col) var(--osc-label-col) 1fr var(--osc-readout-col);
    align-items: center;
    /* Konstant rad-höjd även när timing sub-chart toggles av — undviker att
       raderna hoppar runt vid legend-toggle. Charts-containern krymper inom
       raden via .has-timing class. */
    height: var(--osc-row-h);
    padding: 0 var(--osc-row-padding-x);
    gap: var(--osc-row-gap);
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
  }
  .osc-row.hidden {
    grid-template-columns: var(--osc-eye-col) var(--osc-label-col) 1fr;
    height: var(--osc-row-h-hidden);
    opacity: 0.45;
  }
  .osc-row.hidden .osc-elcon {
    color: #aaa;
    font-style: italic;
  }

  .osc-eye {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    color: var(--trace-amp);
    background: none;
    padding: 0;
    user-select: none;
    font-size: 0.7rem;
  }
  .osc-eye:hover {
    background: #f3f3f3;
    border-color: #e5e5e5;
  }
  .osc-row.hidden .osc-eye {
    color: #ccc;
  }

  .osc-elcon {
    color: #333;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .osc-charts {
    display: flex;
    flex-direction: column;
    gap: var(--osc-chart-gap);
    /* Explicit pixel-höjd KRÄVS — align-items: center på grid-raden gör att
       children inte stretchas till cell-höjd, och utan explicit height
       kollapsar containern till 0 vilket får svg:erna att stretch:a över
       hela 1fr-bredden enligt viewBox aspect-ratio (= enorma charts). */
    height: var(--osc-chart-signed-h);
  }
  .osc-charts.has-timing {
    /* Signed + gap + timing — beräknas från single-source vars */
    height: calc(
      var(--osc-chart-signed-h) + var(--osc-chart-gap) +
        var(--osc-chart-timing-h)
    );
  }
  .osc-chart {
    background: #fafafa;
    border-radius: 3px;
    overflow: hidden;
    position: relative;
    flex-shrink: 0;
  }
  .osc-chart-signed {
    height: var(--osc-chart-signed-h);
  }
  .osc-chart-timing {
    height: var(--osc-chart-timing-h);
  }
  .osc-chart svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .grid-line {
    stroke: #eef0f2;
    stroke-width: 0.3;
    vector-effect: non-scaling-stroke;
  }
  .baseline-zero {
    stroke: #c8c8c8;
    stroke-width: 0.6;
    vector-effect: non-scaling-stroke;
  }
  .trace-amp {
    stroke: var(--trace-amp);
    stroke-width: 1.4;
    fill: none;
    vector-effect: non-scaling-stroke;
  }
  .trace-vcap {
    stroke: var(--trace-vcap);
    stroke-width: 1.2;
    fill: none;
    stroke-opacity: 0.85;
    vector-effect: non-scaling-stroke;
  }
  .bar-pulse-width {
    fill: var(--trace-pulse-width);
    fill-opacity: 0.85;
  }
  .bar-pace {
    fill: var(--trace-pace);
    fill-opacity: 0.85;
  }

  .osc-readout {
    text-align: right;
    font-size: 0.78rem;
    color: #444;
    line-height: 1.3;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .osc-readout-amp {
    color: var(--trace-amp);
    font-weight: 600;
  }
  .osc-readout-vcap {
    color: var(--trace-vcap);
    font-size: 0.7rem;
    font-weight: 600;
  }
  .osc-readout-pw {
    color: var(--trace-pulse-width);
    font-size: 0.7rem;
    font-weight: 600;
  }
  .osc-readout-pa {
    color: var(--trace-pace);
    font-size: 0.7rem;
    font-weight: 600;
  }

  /* Mobile breakpoint — bara override CSS vars, övriga selectors plockar
     upp dem automatiskt (ingen duplicerad layout-logik). */
  @media (max-width: 720px) {
    .osc {
      --osc-eye-col: 24px;
      --osc-label-col: 100px;
      --osc-readout-col: 60px;
      --osc-row-h: 70px;
    }
  }
</style>

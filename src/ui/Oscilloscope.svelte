<script lang="ts">
  import { app, toggleElconVisibility, toggleTrace } from './stores.svelte';
  import { uniqueElcons, elconId, elconToLabel, type Elcon } from '../patterns/types';
  import type { WaveformSample } from '../mock-firmware/waveform';

  // Layout-konstanter (matchar approved.html)
  const VIEW_W = 100;
  const VIEW_H = 40;
  const Y_PAD = 2;

  /**
   * Step-line path för amp (horisontella + vertikala segment).
   * Per design-review lock: amp är konstant inom descriptor — step-line teknisk korrekt.
   */
  function buildAmpPath(samples: WaveformSample[]): string {
    if (samples.length < 1) return '';
    const xStep = VIEW_W / Math.max(1, samples.length - 1);
    const valueToY = (v: number): number => VIEW_H - Y_PAD - (v / 255) * (VIEW_H - 2 * Y_PAD);
    let prevY = valueToY(samples[0]!.amp);
    let d = `M0,${prevY.toFixed(2)}`;
    for (let i = 1; i < samples.length; i++) {
      const x = (i * xStep).toFixed(2);
      const y = valueToY(samples[i]!.amp);
      if (Math.abs(y - prevY) > 0.05) {
        d += ` L${x},${prevY.toFixed(2)} L${x},${y.toFixed(2)}`;
      } else {
        d += ` L${x},${y.toFixed(2)}`;
      }
      prevY = y;
    }
    return d;
  }

  /** Smooth path för Vcap (kontinuerlig RC-kurva, normaliserad mot 80V max). */
  function buildVcapPath(samples: WaveformSample[]): string {
    if (samples.length < 1) return '';
    const xStep = VIEW_W / Math.max(1, samples.length - 1);
    const VCAP_MAX = 80_000;
    const valueToY = (v: number): number => VIEW_H - Y_PAD - (v / VCAP_MAX) * (VIEW_H - 2 * Y_PAD);
    return samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'}${(i * xStep).toFixed(2)},${valueToY(s.vcap).toFixed(2)}`)
      .join(' ');
  }

  /** Senaste amp-värde i % för readout. */
  function lastAmpPercent(samples: WaveformSample[]): number {
    if (samples.length === 0) return 0;
    const last = samples[samples.length - 1]!;
    return Math.round((last.amp / 255) * 100);
  }

  /** Senaste vcap i V för readout. */
  function lastVcapVolts(samples: WaveformSample[]): number {
    if (samples.length === 0) return 0;
    const last = samples[samples.length - 1]!;
    return Math.round(last.vcap / 1000);
  }

  // Reactive: lista av rows från currentPattern + buffers
  type RowInfo = {
    id: string;
    elcon: Elcon;
    label: string;
    visible: boolean;
    samples: WaveformSample[];
  };

  let rows = $derived.by((): RowInfo[] => {
    if (!app.currentPattern) return [];
    return uniqueElcons(app.currentPattern.elcons).map((elcon) => {
      const id = elconId(elcon);
      return {
        id,
        elcon,
        label: elconToLabel(elcon),
        visible: app.visibleElcons.has(id),
        samples: app.waveformBuffers.get(id) ?? [],
      };
    });
  });

  let visibleCount = $derived(rows.filter((r) => r.visible).length);
  let totalCount = $derived(rows.length);
  let traceCount = $derived(app.activeTraces.size);
  let ampActive = $derived(app.activeTraces.has('amp'));
  let vcapActive = $derived(app.activeTraces.has('vcap'));
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
            <div class="osc-chart">
              <svg viewBox="0 0 100 40" preserveAspectRatio="none">
                <line class="grid-line" x1="0" y1="20" x2="100" y2="20" />
                <line class="grid-line" x1="0" y1="10" x2="100" y2="10" />
                <line class="grid-line" x1="0" y1="30" x2="100" y2="30" />
                {#if vcapActive && row.samples.length > 1}
                  <path class="trace-vcap" d={buildVcapPath(row.samples)} />
                {/if}
                {#if ampActive && row.samples.length > 0}
                  <path class="trace-amp" d={buildAmpPath(row.samples)} />
                {/if}
              </svg>
            </div>
            <span class="osc-readout">
              {#if ampActive}
                <span class="osc-readout-amp">{lastAmpPercent(row.samples)}%</span>
              {/if}
              {#if vcapActive}
                <span class="osc-readout-vcap">{lastVcapVolts(row.samples)}V</span>
              {/if}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  :global(:root) {
    --trace-amp: #0066cc;
    --trace-vcap: #cc6600;
    --trace-iprim: #008866;
  }

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
    padding: 0.3rem 1rem 0.3rem calc(32px + 130px + 1rem + 0.85rem);
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
    grid-template-columns: 32px 130px 1fr 80px;
    align-items: center;
    height: 56px;
    padding: 0 1rem;
    gap: 0.85rem;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
  }
  .osc-row.hidden {
    grid-template-columns: 32px 130px 1fr;
    height: 24px;
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

  .osc-chart {
    height: 44px;
    background: #fafafa;
    border-radius: 3px;
    overflow: hidden;
    position: relative;
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

  @media (max-width: 720px) {
    .osc-row {
      grid-template-columns: 24px 100px 1fr 60px;
      height: 52px;
    }
    .osc-row.hidden {
      grid-template-columns: 24px 100px 1fr;
    }
    .osc-time-axis {
      padding-left: calc(24px + 100px + 1rem + 0.85rem);
    }
  }
</style>

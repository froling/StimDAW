<script lang="ts">
  /**
   * Polar electrode-flow viz. 4 elektroder på kardinalpunkter (N=A, E=B,
   * S=C, W=D, medurs).
   *
   * Encoding (post-experience-redesign):
   * - Bågens stroke-tjocklek = AMPLITUDE (linjen ÄR amp)
   * - Bågens opacitet = recency (åldersfade)
   * - Nod-radius = BASE × (1 + peak pulse_width-norm) — större cirkel vid mer energi
   * - Nod-fill saturation = aktivitets-volym (mer pulser → intensivare orange)
   * - Singel warm färg, INGEN polaritets-encoding (biphasic är säkerhet, inte upplevelse)
   */
  import { app } from './stores.svelte';
  import type { PolarArc, PolarFrame, PolarNodeState } from '../oscilloscope/polar-frame';

  const VIEW_SIZE = 280;
  const CENTER = VIEW_SIZE / 2;
  const ELECTRODE_RADIUS = VIEW_SIZE * 0.36;
  const NODE_BASE_RADIUS = 12;
  /** Hur mycket noden växer vid full pulse_width. Base 12, full pw → ~22px radius. */
  const NODE_PW_GROWTH = 10;
  /** Bågens max-stroke-width vid amp_norm=1. */
  const ARC_MAX_STROKE = 6.5;
  /** Bågens min-stroke (vid amp_norm=0). */
  const ARC_MIN_STROKE = 0.5;
  /**
   * Pace-färg-domän (µs). Hög pace = långsam rytm = röd.
   * Låg pace = snabb rytm = gul. Linjär interp däremellan.
   * Gränser täcker det praktiska området (~7ms..200ms) — clampar utanför.
   */
  const PACE_FAST_MICROS = 7_000;   // ~143 Hz, fastest practical
  const PACE_SLOW_MICROS = 200_000; // 5 Hz, slowest typical
  const COLOR_FAST: [number, number, number] = [240, 200, 60];  // gul
  const COLOR_SLOW: [number, number, number] = [200, 60, 50];   // röd

  const ELECTRODE_POSITIONS: Record<'A' | 'B' | 'C' | 'D', { x: number; y: number; label: string }> = {
    A: { x: CENTER, y: CENTER - ELECTRODE_RADIUS, label: 'A' },
    B: { x: CENTER + ELECTRODE_RADIUS, y: CENTER, label: 'B' },
    C: { x: CENTER, y: CENTER + ELECTRODE_RADIUS, label: 'C' },
    D: { x: CENTER - ELECTRODE_RADIUS, y: CENTER, label: 'D' },
  };

  let frame = $derived<PolarFrame | null>(app.polarFrame);
  let arcs = $derived<readonly PolarArc[]>(frame?.arcs ?? []);
  let nodes = $derived<readonly PolarNodeState[]>(frame?.nodes ?? []);
  let arcCount = $derived(arcs.length);

  function arcPath(a: 'A' | 'B' | 'C' | 'D', b: 'A' | 'B' | 'C' | 'D'): string {
    if (a === b) return '';
    const f = ELECTRODE_POSITIONS[a];
    const t = ELECTRODE_POSITIONS[b];
    const midX = (f.x + t.x) / 2;
    const midY = (f.y + t.y) / 2;
    const dx = midX - CENTER;
    const dy = midY - CENTER;
    const len = Math.sqrt(dx * dx + dy * dy);
    const bowFactor = len < 1 ? 0.3 : 0.15;
    const ctrlX = midX + dx * bowFactor + (len < 1 ? -dy * 0.3 : 0);
    const ctrlY = midY + dy * bowFactor + (len < 1 ? dx * 0.3 : 0);
    return `M${f.x.toFixed(1)},${f.y.toFixed(1)} Q${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
  }

  /**
   * Stroke-width = sqrt(amp) × ageFade.
   *
   * SQRT-mappning ger perceptuellt mer responsiv tjocklek vid låga
   * amp-värden — där mixern faktiskt opererar (intensity × ceiling kan
   * komprimera bytes till 0..30 även vid hög AMP-knob). Linjär 0..255
   * → 0.5..6.5 lät små bytes försvinna i MIN-stroke. SQRT lyfter dem.
   */
  function arcStrokeWidth(arc: PolarArc): number {
    const sqrtAmp = Math.sqrt(arc.amplitudeNorm);
    const ampW = ARC_MIN_STROKE + sqrtAmp * (ARC_MAX_STROKE - ARC_MIN_STROKE);
    return ampW * arc.ageFade;
  }

  /** Båge-opacitet = recency. */
  function arcOpacity(arc: PolarArc): number {
    return arc.ageFade;
  }

  /**
   * Halons FÄRG = lerp mellan röd (slow pace) och gul (fast pace).
   * Frekvens = 1/pace, så lägre pace-µs = högre Hz = gulare.
   * Logaritmisk interp eftersom rytm-rate känns logaritmiskt
   * (oktav-känsla snarare än linjär Hz). Halons OPACITET pulsar i
   * pace-takt via activity (recency-fade per pulse) — det är där
   * användaren ser rytmen.
   */
  function haloColor(electrode: 'A' | 'B' | 'C' | 'D'): string {
    const n = nodeFor(electrode);
    const pace = n?.paceMicros ?? 0;
    if (pace <= 0) return 'rgb(217,106,61)'; // idle = neutral varm orange
    const p = Math.max(PACE_FAST_MICROS, Math.min(PACE_SLOW_MICROS, pace));
    const logFast = Math.log(PACE_FAST_MICROS);
    const logSlow = Math.log(PACE_SLOW_MICROS);
    const t = (Math.log(p) - logFast) / (logSlow - logFast);
    const r = Math.round(COLOR_FAST[0] + (COLOR_SLOW[0] - COLOR_FAST[0]) * t);
    const g = Math.round(COLOR_FAST[1] + (COLOR_SLOW[1] - COLOR_FAST[1]) * t);
    const b = Math.round(COLOR_FAST[2] + (COLOR_SLOW[2] - COLOR_FAST[2]) * t);
    return `rgb(${r},${g},${b})`;
  }

  function nodeFor(electrode: 'A' | 'B' | 'C' | 'D'): PolarNodeState | undefined {
    return nodes.find((n) => n.electrode === electrode);
  }

  /** Nod-radius växer med peak pulse_width — energi → större cirkel. */
  function nodeRadius(electrode: 'A' | 'B' | 'C' | 'D'): number {
    const n = nodeFor(electrode);
    if (!n) return NODE_BASE_RADIUS;
    return NODE_BASE_RADIUS + n.peakPwNorm * NODE_PW_GROWTH;
  }

  /** Nod-fill — mer aktivitet ger mer mättat varmt orange, idle är vitt. */
  function nodeFillColor(electrode: 'A' | 'B' | 'C' | 'D'): string {
    const n = nodeFor(electrode);
    const a = n?.activity ?? 0;
    // Lerp från vit (255,255,255) → varm orange (217,106,61)
    const r = Math.round(255 + (217 - 255) * a);
    const g = Math.round(255 + (106 - 255) * a);
    const b = Math.round(255 + (61 - 255) * a);
    return `rgb(${r},${g},${b})`;
  }

  /** Mjuk halo runt aktiv nod, sized by aktivitet. */
  function nodeHaloOpacity(electrode: 'A' | 'B' | 'C' | 'D'): number {
    const n = nodeFor(electrode);
    return (n?.activity ?? 0) * 0.5;
  }
</script>

<section class="polar">
  <div class="polar-title-bar">
    <h2 class="polar-title">Electrode flow</h2>
    <span class="polar-summary">
      {#if !frame}
        no source
      {:else if arcCount === 0}
        idle
      {:else}
        {arcCount} arcs · live trail · recency-fade
      {/if}
    </span>
  </div>

  <div class="polar-canvas">
    <svg
      viewBox="0 0 {VIEW_SIZE} {VIEW_SIZE}"
      preserveAspectRatio="xMidYMid meet"
      class="polar-svg"
      data-testid="polar-svg"
    >
      <!-- Background ring (electrode-layout) -->
      <circle cx={CENTER} cy={CENTER} r={ELECTRODE_RADIUS} class="polar-ring" />

      <!-- Cross-hairs (grannskap) -->
      <line x1={CENTER} y1={CENTER - ELECTRODE_RADIUS} x2={CENTER + ELECTRODE_RADIUS} y2={CENTER} class="polar-grid" />
      <line x1={CENTER + ELECTRODE_RADIUS} y1={CENTER} x2={CENTER} y2={CENTER + ELECTRODE_RADIUS} class="polar-grid" />
      <line x1={CENTER} y1={CENTER + ELECTRODE_RADIUS} x2={CENTER - ELECTRODE_RADIUS} y2={CENTER} class="polar-grid" />
      <line x1={CENTER - ELECTRODE_RADIUS} y1={CENTER} x2={CENTER} y2={CENTER - ELECTRODE_RADIUS} class="polar-grid" />

      <!-- Active arcs (oldest → newest så nyaste hamnar ovanpå) -->
      {#each [...arcs].sort((a, b) => a.ageFade - b.ageFade) as arc (arc.streamTimeMicros + '-' + arc.electrodeA + '-' + arc.electrodeB + '-' + arc.sourceDescriptorSeq)}
        <path
          class="arc-flow"
          d={arcPath(arc.electrodeA, arc.electrodeB)}
          stroke-width={arcStrokeWidth(arc).toFixed(2)}
          opacity={arcOpacity(arc).toFixed(3)}
        />
      {/each}

      <!-- Electrode nodes ovanpå arcs -->
      {#each Object.entries(ELECTRODE_POSITIONS) as [electrode, pos] (electrode)}
        {@const e = electrode as 'A' | 'B' | 'C' | 'D'}
        {@const r = nodeRadius(e)}
        <!-- Halo-glow under noden — fyll-färg från pace (red=slow, yellow=fast),
             opacitet pulsar med activity (varje puls → flash, fade) -->
        <circle
          class="electrode-halo"
          cx={pos.x}
          cy={pos.y}
          r={r + 8}
          fill={haloColor(e)}
          opacity={nodeHaloOpacity(e).toFixed(3)}
        />
        <!-- Själva noden — fyll skiftar från vit till varm orange med aktivitet -->
        <circle
          class="electrode-node"
          cx={pos.x}
          cy={pos.y}
          r={r.toFixed(2)}
          fill={nodeFillColor(e)}
        />
        <text
          x={pos.x}
          y={pos.y + 5}
          class="electrode-label"
          text-anchor="middle"
        >{pos.label}</text>
      {/each}
    </svg>
  </div>

  <div class="polar-legend">
    <span class="legend-item">
      <span class="legend-line"></span> arc thickness ∝ amplitude
    </span>
    <span class="legend-item">
      <span class="legend-circle"></span> node size ∝ pulse_width
    </span>
    <span class="legend-item">
      <span class="legend-fill"></span> node fill ∝ activity
    </span>
    <span class="legend-item">
      <span class="legend-pace"></span> halo color ∝ pace (red=slow, yellow=fast)
    </span>
  </div>
</section>

<style>
  .polar {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    overflow: hidden;
  }
  .polar-title-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 1.25rem;
    border-bottom: 1px solid #e5e5e5;
  }
  .polar-title {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin: 0;
  }
  .polar-summary {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #888;
  }
  .polar-canvas {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1rem 0;
    background: #fafafa;
  }
  .polar-svg {
    width: 280px;
    height: 280px;
  }
  .polar-ring {
    fill: none;
    stroke: #e5e5e5;
    stroke-width: 1;
    stroke-dasharray: 2 2;
  }
  .polar-grid {
    stroke: #ececec;
    stroke-width: 0.5;
  }
  .arc-flow {
    fill: none;
    stroke: #d96a3d; /* singel warm color — amp styr tjocklek, pace flyttat till halo */
    stroke-linecap: round;
  }
  .electrode-halo {
    /* fill sätts inline per nod — pace-färg lerp red → yellow */
    pointer-events: none;
    filter: blur(4px);
  }
  .electrode-node {
    /* fill set per element via aktivitets-lerp */
    stroke: #333;
    stroke-width: 1.5;
    transition: r 0.12s ease-out, fill 0.18s ease-out;
  }
  .electrode-label {
    font-family: ui-monospace, monospace;
    font-size: 14px;
    font-weight: 700;
    fill: #333;
    pointer-events: none;
  }
  .polar-legend {
    display: flex;
    gap: 1.25rem;
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
    gap: 0.4rem;
  }
  .legend-line {
    display: inline-block;
    width: 18px;
    height: 0;
    border-top: 3px solid #d96a3d;
  }
  .legend-pace {
    display: inline-block;
    width: 18px;
    height: 3px;
    background: linear-gradient(to right, rgb(200, 60, 50), rgb(240, 200, 60));
    border-radius: 1px;
  }
  .legend-circle {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid #333;
    background: #fff;
  }
  .legend-fill {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #d96a3d;
    border: 1.5px solid #333;
  }
</style>

<script lang="ts">
  import Knob from './Knob.svelte';
  import { synth, setLfoRate, setLfoAmount, setLfoShape, setLfoMode, removeLfo } from './synth-store.svelte';
  import { elconToLabel } from '../../patterns/types';
  import type { LFO, WaveMode, WaveShape } from '../../synth/types';

  type Props = {
    lfo: LFO;
    /** Färg-tilldelning för cables från denna LFO (visuell särskillnad). */
    color?: string;
  };

  let { lfo, color = '#8844cc' }: Props = $props();

  // LFO rate som multiplier mot master.masterRate (Hz). Effective Hz = rate × master.
  // 0.1× till 10× — täcker 2 dekader, samma logaritmiska skala som master.
  const RATE_BOUNDS = { min: 0.1, max: 10 } as const;
  const AMOUNT_BOUNDS = { min: 0, max: 1 } as const;

  const SHAPES: WaveShape[] = ['sine', 'saw', 'saw-down', 'square', 'triangle'];
  const SHAPE_GLYPHS: Record<WaveShape, string> = {
    sine: '∿',
    saw: '◢',
    'saw-down': '◣',
    square: '⊓',
    triangle: '△',
  };
  const SHAPE_LABELS: Record<WaveShape, string> = {
    sine: 'sine',
    saw: 'saw up',
    'saw-down': 'saw down',
    square: 'square',
    triangle: 'triangle',
  };

  // Polaritets-mode: bipolar (default) | negative-boost | negative-only
  type ModeOption = { value: WaveMode; glyph: string; label: string; tooltip: string };
  const MODES: ModeOption[] = [
    {
      value: 'bipolar',
      glyph: '↕',
      label: 'BI',
      tooltip: 'Bipolar — symmetrisk swing kring knob.base (default)',
    },
    {
      value: 'negative-boost',
      glyph: '↡',
      label: '−2',
      tooltip: 'Boost negative — dubblar negativ halva. Channel kan bottna även med högt knob-base. Positiv halva oförändrad.',
    },
    {
      value: 'negative-only',
      glyph: '↓',
      label: '−',
      tooltip: 'Negative only — LFO minskar bara channel, ökar aldrig. Vågformsskepnad bevarad i [-1, 0]-range.',
    },
  ];

  // Default 'bipolar' om mode saknas (back-compat med pre-existing LFOs)
  let currentMode = $derived(lfo.mode ?? 'bipolar');

  /**
   * Lista cables som utgår från denna LFO — visas under OUT-port så user
   * ser var modulationen går. Format: "AC↔BD AMP" per target. Multipla
   * targets renderas på egen rad så texten kan utöka.
   */
  function knobShort(knobName: 'pulseWidth' | 'pace' | 'amplitude'): string {
    return knobName === 'pulseWidth' ? 'PW' : knobName === 'pace' ? 'PACE' : 'AMP';
  }
  let outTargets = $derived.by(() => {
    return synth.current.cables
      .filter((c) => c.sourceLfoId === lfo.id)
      .map((c) => {
        const ch = synth.current.channels.find((x) => x.id === c.destChannelId);
        const elconStr = ch ? elconToLabel(ch.elcon) : '?';
        return { id: c.id, label: `${elconStr} ${knobShort(c.destKnobName)}` };
      });
  });

  function setRate(rate: number): void {
    setLfoRate(lfo.id, rate);
  }

  function setAmount(amount: number): void {
    setLfoAmount(lfo.id, amount);
  }

  function pickShape(shape: WaveShape): void {
    setLfoShape(lfo.id, shape);
  }

  function pickMode(mode: WaveMode): void {
    setLfoMode(lfo.id, mode);
  }

  function onRemove(): void {
    if (confirm('Remove this LFO and its cables?')) {
      removeLfo(lfo.id);
    }
  }
</script>

<div
  class="lfo-module"
  style="--lfo-color: {color};"
  data-testid="lfo-module"
  data-lfo-id={lfo.id}
>
  <div class="lfo-header">
    <span class="lfo-id" style="color: {color};">{lfo.id}</span>
    <button
      class="remove-btn"
      onclick={onRemove}
      title="Remove LFO + cables"
      aria-label="Remove LFO"
    >×</button>
  </div>

  <div class="shape-picker" role="radiogroup" aria-label="Waveform shape">
    {#each SHAPES as shape}
      <button
        class="shape-btn"
        class:active={lfo.shape === shape}
        onclick={() => pickShape(shape)}
        title={SHAPE_LABELS[shape]}
        aria-label={SHAPE_LABELS[shape]}
        role="radio"
        aria-checked={lfo.shape === shape}
      >
        {SHAPE_GLYPHS[shape]}
      </button>
    {/each}
  </div>

  <div class="mode-picker" role="radiogroup" aria-label="Polarity mode">
    {#each MODES as opt}
      <button
        class="mode-btn"
        class:active={currentMode === opt.value}
        onclick={() => pickMode(opt.value)}
        title={opt.tooltip}
        aria-label={opt.value}
        role="radio"
        aria-checked={currentMode === opt.value}
        data-testid="lfo-mode-btn"
        data-mode={opt.value}
      >
        <span class="mode-glyph">{opt.glyph}</span>
        <span class="mode-label">{opt.label}</span>
      </button>
    {/each}
  </div>

  <div class="knobs">
    <Knob
      value={lfo.rate}
      bounds={RATE_BOUNDS}
      log={true}
      defaultValue={1}
      unit="multiplier"
      label="Rate"
      onChange={setRate}
      size={42}
    />
    <Knob
      value={lfo.amount}
      bounds={AMOUNT_BOUNDS}
      defaultValue={1}
      unit="fraction"
      label="Amount"
      onChange={(v) => setAmount(Math.max(0, Math.min(1, v)))}
      size={42}
    />
  </div>

  <!-- Output port — drag-startpoint för cable creation (CableLayer hook:ar) -->
  <div
    class="output-port"
    data-lfo-id={lfo.id}
    data-port-type="output"
    title="Drag to a knob to patch"
    aria-label="LFO output (drag to patch)"
  >
    <span class="port-dot" style="background: {color};"></span>
    <span class="port-label">OUT</span>
  </div>

  <!-- Cable-targets-lista under OUT (vad denna modulator påverkar). Visas
       bara när det finns minst en cable. Multipla targets på egen rad. -->
  {#if outTargets.length > 0}
    <ul class="cable-targets" aria-label="Modulator targets">
      {#each outTargets as t (t.id)}
        <li class="cable-target" style="color: {color};">→ {t.label}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .lfo-module {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    min-width: 130px;
  }

  .lfo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid #f0f0f0;
  }
  .lfo-id {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .remove-btn {
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: transparent;
    color: #aaa;
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
  }
  .remove-btn:hover {
    color: #cc0033;
  }

  .shape-picker {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: #fafafa;
    border-radius: 4px;
  }
  .shape-btn {
    flex: 1;
    background: transparent;
    border: none;
    padding: 0.25rem 0;
    cursor: pointer;
    font-size: 0.95rem;
    color: #888;
    border-radius: 3px;
    font-family: 'Symbola', system-ui, sans-serif;
  }
  .shape-btn:hover {
    background: #f0f0f0;
    color: #333;
  }
  .shape-btn.active {
    background: white;
    color: var(--lfo-color);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .mode-picker {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: #fafafa;
    border-radius: 4px;
  }
  .mode-btn {
    flex: 1;
    background: transparent;
    border: none;
    padding: 0.2rem 0;
    cursor: pointer;
    color: #888;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    font-family: ui-monospace, monospace;
  }
  .mode-btn:hover {
    background: #f0f0f0;
    color: #333;
  }
  .mode-btn.active {
    background: white;
    color: var(--lfo-color);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .mode-glyph {
    font-size: 0.85rem;
    line-height: 1;
  }
  .mode-label {
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .knobs {
    display: flex;
    justify-content: space-around;
    padding: 0.3rem 0;
  }

  .output-port {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.3rem;
    background: #fafafa;
    border-radius: 3px;
    cursor: grab;
    border: 1px dashed #d0d0d0;
    transition: border-color 0.1s, background 0.1s;
  }
  .output-port:hover {
    border-color: var(--lfo-color);
    background: white;
  }
  .output-port:active {
    cursor: grabbing;
  }
  .port-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px white, 0 0 0 3px var(--lfo-color);
  }
  .port-label {
    font-family: ui-monospace, monospace;
    font-size: 0.65rem;
    color: #666;
    letter-spacing: 0.05em;
  }

  .cable-targets {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0.1rem 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    /* Texten kan växa på höjden om cables blir många — ingen max-height */
  }
  .cable-target {
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    line-height: 1.2;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* color sätts inline från LFO-färg */
  }
</style>

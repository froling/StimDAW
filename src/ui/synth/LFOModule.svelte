<script lang="ts">
  import Knob from './Knob.svelte';
  import { setLfoRate, setLfoAmount, setLfoShape, removeLfo } from './synth-store.svelte';
  import type { LFO, WaveShape } from '../../synth/types';

  type Props = {
    lfo: LFO;
    /** Färg-tilldelning för cables från denna LFO (visuell särskillnad). */
    color?: string;
  };

  let { lfo, color = '#8844cc' }: Props = $props();

  // LFO rate-bounds: 0.01..50 Hz (logaritmisk för att täcka 4 dekader)
  const RATE_BOUNDS = { min: 0.01, max: 50 } as const;
  const AMOUNT_BOUNDS = { min: 0, max: 1 } as const;

  const SHAPES: WaveShape[] = ['sine', 'saw', 'square', 'triangle'];
  const SHAPE_GLYPHS: Record<WaveShape, string> = {
    sine: '∿',
    saw: '◢',
    square: '⊓',
    triangle: '△',
  };

  function setRate(rate: number): void {
    setLfoRate(lfo.id, rate);
  }

  function setAmount(amount: number): void {
    setLfoAmount(lfo.id, amount);
  }

  function pickShape(shape: WaveShape): void {
    setLfoShape(lfo.id, shape);
  }

  function onRemove(): void {
    if (confirm('Remove this LFO and its cables?')) {
      removeLfo(lfo.id);
    }
  }
</script>

<div class="lfo-module" style="--lfo-color: {color};">
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
        title={shape}
        aria-label={shape}
        role="radio"
        aria-checked={lfo.shape === shape}
      >
        {SHAPE_GLYPHS[shape]}
      </button>
    {/each}
  </div>

  <div class="knobs">
    <Knob
      value={lfo.rate}
      bounds={RATE_BOUNDS}
      log={true}
      defaultValue={1}
      unit="hz"
      label="Rate"
      onChange={setRate}
      size={42}
    />
    <Knob
      value={lfo.amount}
      bounds={AMOUNT_BOUNDS}
      defaultValue={1}
      unit="percent"
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
</style>

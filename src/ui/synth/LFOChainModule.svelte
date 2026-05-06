<script lang="ts">
  import Knob from './Knob.svelte';
  import {
    synth,
    setChainSource,
    setChainTrigger,
    setChainShape,
    setChainAmount,
    setChainMode,
    removeChain,
  } from './synth-store.svelte';
  import { elconToLabel } from '../../patterns/types';
  import type { ChainTrigger, LfoChain, LFO, WaveMode, WaveShape } from '../../synth/types';

  type Props = {
    chain: LfoChain;
    /** Befintliga LFOs + chains som kan väljas som source (exkl. self+descendants). */
    availableSources: ReadonlyArray<{ id: string; label: string }>;
    /** Cable-färg för chain output-port. */
    color?: string;
  };

  let { chain, availableSources, color = '#cc6600' }: Props = $props();

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

  type ModeOption = { value: WaveMode; glyph: string; label: string; tooltip: string };
  const MODES: ModeOption[] = [
    { value: 'bipolar', glyph: '↕', label: 'BI', tooltip: 'Bipolar' },
    { value: 'negative-boost', glyph: '↡', label: '−2', tooltip: 'Boost negative — dubblar negativ halva' },
    { value: 'negative-only', glyph: '↓', label: '−', tooltip: 'Negative only — LFO minskar bara' },
  ];

  type TriggerOption = { value: ChainTrigger; label: string; tooltip: string };
  const TRIGGERS: TriggerOption[] = [
    {
      value: 'sync',
      label: 'SYNC',
      tooltip: 'Sync — chain spelar i fas med source, samma rate. Layered modulation: byt shape men ärv takten.',
    },
    {
      value: 'offset',
      label: 'OFFSET',
      tooltip: 'Offset — chain spelar samma rate men 180° fas-skift. För symmetriska shapes (sine/triangle/square) ger detta matematisk invers. Båda spelar samtidigt.',
    },
    {
      value: 'alternate',
      label: 'ALT',
      tooltip: 'Alternate — chain spelar BARA när source-signal < 0 (gated). Ger äkta tid-delning: när source-vågen är "klar" tar chain över. 2× source rate under gate-on.',
    },
  ];

  let currentMode = $derived(chain.mode ?? 'bipolar');

  /** Cable-targets från denna chain (samma format som LFOModule). */
  function knobShort(knobName: 'pulseWidth' | 'pace' | 'amplitude'): string {
    return knobName === 'pulseWidth' ? 'PW' : knobName === 'pace' ? 'PACE' : 'AMP';
  }
  let outTargets = $derived.by(() => {
    return synth.current.cables
      .filter((c) => c.sourceLfoId === chain.id)
      .map((c) => {
        const ch = synth.current.channels.find((x) => x.id === c.destChannelId);
        const elconStr = ch ? elconToLabel(ch.elcon) : '?';
        return { id: c.id, label: `${elconStr} ${knobShort(c.destKnobName)}` };
      });
  });

  function pickSource(e: Event): void {
    const newId = (e.currentTarget as HTMLSelectElement).value;
    if (newId && newId !== chain.sourceId) setChainSource(chain.id, newId);
  }

  function pickTrigger(trigger: ChainTrigger): void {
    setChainTrigger(chain.id, trigger);
  }

  function pickShape(shape: WaveShape): void {
    setChainShape(chain.id, shape);
  }

  function setAmount(amount: number): void {
    setChainAmount(chain.id, Math.max(0, Math.min(1, amount)));
  }

  function pickMode(mode: WaveMode): void {
    setChainMode(chain.id, mode);
  }

  function onRemove(): void {
    if (confirm('Remove this chain and any chains that depend on it?')) {
      removeChain(chain.id);
    }
  }
</script>

<div
  class="chain-module"
  style="--chain-color: {color};"
  data-testid="chain-module"
  data-chain-id={chain.id}
>
  <div class="chain-header">
    <span class="chain-id" style="color: {color};">{chain.id}</span>
    <button
      class="remove-btn"
      onclick={onRemove}
      title="Remove chain (+ depending chains)"
      aria-label="Remove chain"
    >×</button>
  </div>

  <label class="source-row">
    <span class="source-label">SRC</span>
    <select
      class="source-select"
      value={chain.sourceId}
      onchange={pickSource}
      data-testid="chain-source-select"
    >
      {#each availableSources as src}
        <option value={src.id}>{src.label}</option>
      {/each}
      {#if availableSources.length === 0}
        <option value="" disabled>(no sources available)</option>
      {/if}
    </select>
  </label>

  <div class="trigger-picker" role="radiogroup" aria-label="Trigger boundary">
    {#each TRIGGERS as opt}
      <button
        class="trigger-btn"
        class:active={chain.trigger === opt.value}
        onclick={() => pickTrigger(opt.value)}
        title={opt.tooltip}
        aria-label={opt.value}
        role="radio"
        aria-checked={chain.trigger === opt.value}
        data-testid="chain-trigger-btn"
        data-trigger={opt.value}
      >
        {opt.label}
      </button>
    {/each}
  </div>

  <div class="shape-picker" role="radiogroup" aria-label="Waveform shape">
    {#each SHAPES as shape}
      <button
        class="shape-btn"
        class:active={chain.shape === shape}
        onclick={() => pickShape(shape)}
        title={SHAPE_LABELS[shape]}
        aria-label={SHAPE_LABELS[shape]}
        role="radio"
        aria-checked={chain.shape === shape}
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
        data-testid="chain-mode-btn"
        data-mode={opt.value}
      >
        <span class="mode-glyph">{opt.glyph}</span>
        <span class="mode-label">{opt.label}</span>
      </button>
    {/each}
  </div>

  <div class="knobs">
    <Knob
      value={chain.amount}
      bounds={AMOUNT_BOUNDS}
      defaultValue={1}
      unit="fraction"
      label="Amount"
      onChange={setAmount}
      size={42}
    />
  </div>

  <div
    class="output-port"
    data-lfo-id={chain.id}
    data-port-type="output"
    title="Drag to a knob to patch (chain output)"
    aria-label="Chain output (drag to patch)"
  >
    <span class="port-dot" style="background: {color};"></span>
    <span class="port-label">OUT</span>
  </div>

  {#if outTargets.length > 0}
    <ul class="cable-targets" aria-label="Chain targets">
      {#each outTargets as t (t.id)}
        <li class="cable-target" style="color: {color};">→ {t.label}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .chain-module {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem;
    background: white;
    /* Dashed border + chain-color ger visuell distinktion mot LFO */
    border: 1px dashed var(--chain-color);
    border-radius: 6px;
    min-width: 130px;
  }

  .chain-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid #f0f0f0;
  }
  .chain-id {
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

  .source-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
  }
  .source-label {
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .source-select {
    flex: 1;
    background: #fafafa;
    border: 1px solid #e5e5e5;
    border-radius: 3px;
    padding: 0.18rem 0.3rem;
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    color: #333;
    cursor: pointer;
    min-width: 0;
  }
  .source-select:hover {
    border-color: var(--chain-color);
  }

  .trigger-picker {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: #fafafa;
    border-radius: 4px;
  }
  .trigger-btn {
    flex: 1;
    background: transparent;
    border: none;
    padding: 0.25rem 0;
    cursor: pointer;
    font-family: ui-monospace, monospace;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: #888;
    border-radius: 3px;
  }
  .trigger-btn:hover {
    background: #f0f0f0;
    color: #333;
  }
  .trigger-btn.active {
    background: white;
    color: var(--chain-color);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .shape-picker,
  .mode-picker {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: #fafafa;
    border-radius: 4px;
  }
  .shape-btn,
  .mode-btn {
    flex: 1;
    background: transparent;
    border: none;
    padding: 0.2rem 0;
    cursor: pointer;
    color: #888;
    border-radius: 3px;
  }
  .shape-btn {
    padding: 0.25rem 0;
    font-size: 0.95rem;
    font-family: 'Symbola', system-ui, sans-serif;
  }
  .mode-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    font-family: ui-monospace, monospace;
  }
  .shape-btn:hover,
  .mode-btn:hover {
    background: #f0f0f0;
    color: #333;
  }
  .shape-btn.active,
  .mode-btn.active {
    background: white;
    color: var(--chain-color);
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
    justify-content: center;
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
    border-color: var(--chain-color);
    background: white;
  }
  .output-port:active {
    cursor: grabbing;
  }
  .port-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px white, 0 0 0 3px var(--chain-color);
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
  }
  .cable-target {
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    line-height: 1.2;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

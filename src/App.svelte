<script lang="ts">
  import { onMount } from 'svelte';
  import { connectMock, stopMixer } from './ui/stores.svelte';
  import { stopPattern } from './ui/stores.svelte';
  import { synth } from './ui/synth/synth-store.svelte';
  import ConnectionBanner from './ui/ConnectionBanner.svelte';
  import StopButton from './ui/StopButton.svelte';
  import Monitor from './ui/Monitor.svelte';
  import IntensitySlider from './ui/IntensitySlider.svelte';
  import Cli from './ui/Cli.svelte';
  import PatternRunnerBar from './ui/PatternRunnerBar.svelte';
  import Oscilloscope from './ui/Oscilloscope.svelte';
  import Mixer from './ui/Mixer.svelte';
  import { createLogger } from './log';

  const log = createLogger('app');

  /**
   * F1 source-mode tabs (audit-rec): Patterns OR Mixer i samma slot.
   * Mutex är visuell (replace), inte gray-out av disabled-state.
   */
  let activeMode = $state<'patterns' | 'mixer'>('patterns');

  function pickMode(mode: 'patterns' | 'mixer'): void {
    if (mode === activeMode) return;
    // Stoppa aktiv source vid mode-byte (1.3A safety: ingen overlap)
    if (activeMode === 'patterns') {
      stopPattern();
    } else if (activeMode === 'mixer') {
      stopMixer();
    }
    activeMode = mode;
  }

  onMount(() => {
    log.info('StimDAW β started — auto-connecting to mock');
    void connectMock();
  });
</script>

<header class="topbar">
  <div class="brand">
    <h1>StimDAW <span class="version">β</span></h1>
    <span class="subtitle">mock-driven · NeoDK-only</span>
  </div>
  <!-- F7: source-active indicator -->
  <span class="source-indicator">
    Source: <span class="source-name">{activeMode === 'mixer' ? 'Mixer' : 'Patterns'}</span>
    {#if synth.activeSource === 'mixer' || (activeMode === 'patterns')}
      <span class="source-dot"></span>
    {/if}
  </span>
  <StopButton />
</header>

<main>
  <ConnectionBanner />

  <div class="grid">
    <Monitor />
    <IntensitySlider />

    <!-- F1: source-mode tabs (segmented control), Mutex visuell — ej disabled-state -->
    <div class="col-span-2 source-tabs" role="tablist" aria-label="Signal source" data-testid="source-tabs">
      <button
        role="tab"
        aria-selected={activeMode === 'patterns'}
        class="source-tab"
        class:active={activeMode === 'patterns'}
        onclick={() => pickMode('patterns')}
        data-testid="source-tab-patterns"
      >Patterns</button>
      <button
        role="tab"
        aria-selected={activeMode === 'mixer'}
        class="source-tab"
        class:active={activeMode === 'mixer'}
        onclick={() => pickMode('mixer')}
        data-testid="source-tab-mixer"
      >Mixer</button>
    </div>

    <div class="col-span-2">
      {#if activeMode === 'patterns'}
        <PatternRunnerBar />
      {:else}
        <Mixer />
      {/if}
    </div>

    <div class="col-span-2">
      <Oscilloscope />
    </div>
    <div class="col-span-2">
      <Cli />
    </div>
  </div>
</main>

<style>
  :global(body) {
    background: #f5f5f7;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    background: white;
    border-bottom: 1px solid #e5e5e5;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .source-indicator {
    margin-left: auto;
    margin-right: 0.5rem;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: #888;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .source-name {
    color: #333;
    font-weight: 600;
  }
  .source-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #66bb66;
    animation: source-pulse 1.5s ease-in-out infinite;
  }
  @keyframes source-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .source-tabs {
    display: inline-flex;
    background: #ececec;
    border-radius: 8px;
    padding: 3px;
    width: fit-content;
    gap: 2px;
  }
  .source-tab {
    padding: 0.4rem 1rem;
    border: none;
    background: transparent;
    border-radius: 6px;
    cursor: pointer;
    font-family: system-ui, sans-serif;
    font-size: 0.8rem;
    color: #666;
    font-weight: 500;
    transition: background 0.15s, color 0.15s;
  }
  .source-tab:hover {
    color: #333;
  }
  .source-tab.active {
    background: white;
    color: #0066cc;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-family:
      system-ui,
      sans-serif;
  }
  .version {
    color: #888;
    font-weight: 400;
    font-size: 0.7em;
  }
  .subtitle {
    color: #888;
    font-size: 0.85rem;
  }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .col-span-2 {
    grid-column: 1 / -1;
  }
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>

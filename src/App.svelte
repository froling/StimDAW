<script lang="ts">
  import { onMount } from 'svelte';
  import { connectMock, stopMixer } from './ui/stores.svelte';
  import { stopPattern } from './ui/stores.svelte';
  import { synth } from './ui/synth/synth-store.svelte';
  import ConnectionBanner from './ui/ConnectionBanner.svelte';
  import StopButton from './ui/StopButton.svelte';
  import MonitorBar from './ui/MonitorBar.svelte';
  import Cli from './ui/Cli.svelte';
  import PatternRunnerBar from './ui/PatternRunnerBar.svelte';
  import Oscilloscope from './ui/Oscilloscope.svelte';
  import PolarFlow from './ui/PolarFlow.svelte';
  import Mixer from './ui/Mixer.svelte';
  import { createLogger } from './log';

  const log = createLogger('app');

  /**
   * Source-mode tabs: Patterns OR Mixer i samma slot. Mutex är visuell.
   */
  let activeMode = $state<'patterns' | 'mixer'>('mixer');

  function pickMode(mode: 'patterns' | 'mixer'): void {
    if (mode === activeMode) return;
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

  <!-- Compact telemetri-bar inline i topbar — ersätter gamla 3-radiga
       Monitor-panelen. Tone-coded numerics (gult/rött vid threshold). -->
  <MonitorBar />

  <span class="source-indicator">
    <span class="source-name">{activeMode === 'mixer' ? 'Mixer' : 'Patterns'}</span>
    {#if synth.activeSource === 'mixer' || (activeMode === 'patterns')}
      <span class="source-dot"></span>
    {/if}
  </span>
  <StopButton />
</header>

<main>
  <ConnectionBanner />

  <div class="source-tabs" role="tablist" aria-label="Signal source" data-testid="source-tabs">
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

  <div class="source-panel">
    {#if activeMode === 'patterns'}
      <PatternRunnerBar />
    {:else}
      <Mixer />
    {/if}
  </div>

  <PolarFlow />
  <Oscilloscope />
  <Cli />
</main>

<style>
  :global(body) {
    background: #f5f5f7;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.7rem 1.5rem;
    background: white;
    border-bottom: 1px solid #e5e5e5;
    position: sticky;
    top: 0;
    z-index: 10;
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-shrink: 0;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
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
    font-size: 0.78rem;
  }
  .source-indicator {
    margin-left: auto;
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
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
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .source-panel {
    /* Tar all bredd av main, hyser PatternRunnerBar eller Mixer */
  }
  @media (max-width: 720px) {
    .topbar {
      padding: 0.6rem 1rem;
      gap: 0.75rem;
    }
    .subtitle {
      display: none;
    }
  }
</style>

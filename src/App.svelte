<script lang="ts">
  import { onMount } from 'svelte';
  import { connectMock } from './ui/stores.svelte';
  import ConnectionBanner from './ui/ConnectionBanner.svelte';
  import StopButton from './ui/StopButton.svelte';
  import Monitor from './ui/Monitor.svelte';
  import IntensitySlider from './ui/IntensitySlider.svelte';
  import Cli from './ui/Cli.svelte';
  import PatternRunnerBar from './ui/PatternRunnerBar.svelte';
  import Oscilloscope from './ui/Oscilloscope.svelte';
  import { createLogger } from './log';

  const log = createLogger('app');

  onMount(() => {
    log.info('StimDAW α started — auto-connecting to mock');
    void connectMock();
  });
</script>

<header class="topbar">
  <div class="brand">
    <h1>StimDAW <span class="version">α</span></h1>
    <span class="subtitle">mock-driven · NeoDK-only</span>
  </div>
  <StopButton />
</header>

<main>
  <ConnectionBanner />

  <div class="grid">
    <Monitor />
    <IntensitySlider />
    <div class="col-span-2">
      <PatternRunnerBar />
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
    padding: 1rem 1.5rem;
    background: white;
    border-bottom: 1px solid #e5e5e5;
    position: sticky;
    top: 0;
    z-index: 10;
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

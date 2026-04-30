<script lang="ts">
  import { app, runPattern, stopPattern, exportDispatchedCsv } from './stores.svelte';
  import { builtinPatterns } from '../patterns/builtins';

  // Temp control panel — DAW kommer ersätta detta i β.
  // Per design-locks: control-elementen tillhör INTE Oscilloscope-panelen,
  // de bor här i en separat panel.
</script>

<section class="runner">
  <div class="runner-header">
    <h2>Pattern runner</h2>
    <span class="status">
      {#if app.isRunningPattern}
        <span class="dot running"></span> running
        {#if app.currentPattern}
          <span class="pattern-name">— {app.currentPattern.name}</span>
        {/if}
      {:else}
        <span class="dot idle"></span> idle
      {/if}
    </span>
  </div>

  <div class="quick">
    {#each builtinPatterns as p}
      <button
        type="button"
        class="run-btn"
        onclick={() => runPattern(p.name)}
        disabled={app.connection === 'disconnected' || app.isRunningPattern}
        title="Run {p.name} ({p.elcons.length} elcons, pace {Math.round(p.paceMicros / 1000)}ms)"
      >
        {p.name}
      </button>
    {/each}
    <label
      class="loop-toggle"
      title="Repetera valt pattern tills Stop pattern trycks. Loop-läge bypassar 5-rep-cap."
    >
      <input type="checkbox" bind:checked={app.loopPattern} />
      Loop
    </label>
    <button
      type="button"
      class="export-btn"
      onclick={exportDispatchedCsv}
      disabled={app.dispatchedDescriptors.length === 0}
      title="Export dispatched descriptors as patterns312-CSV"
    >
      Export CSV
      {#if app.dispatchedDescriptors.length > 0}
        <span class="export-count">({app.dispatchedDescriptors.length})</span>
      {/if}
    </button>
    <button
      type="button"
      class="stop-btn"
      onclick={stopPattern}
      disabled={!app.isRunningPattern}
    >
      Stop pattern
    </button>
  </div>

  <p class="footnote">
    Temp panel — DAW (β) kommer ersätta. One-shot kappas till 5 reps i α2;
    Loop kör pattern.nrOfReps fullt och repeterar tills Stop. CSV-export =
    host-sanning (vad runner skickade), inte firmware-sidans dispatch.
  </p>
</section>

<style>
  .runner {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 1rem 1.25rem;
  }
  .runner-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.75rem;
  }
  h2 {
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
    margin: 0;
  }
  .status {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #888;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.idle {
    background: #ccc;
  }
  .dot.running {
    background: #66bb66;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .pattern-name {
    color: #333;
    font-weight: 500;
  }

  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }
  .run-btn {
    padding: 0.4rem 0.85rem;
    border: 1px solid #d0d0d0;
    background: #fafafa;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    font-family: system-ui, sans-serif;
  }
  .run-btn:hover:not(:disabled) {
    background: #f0f0f0;
    border-color: #0066cc;
    color: #0066cc;
  }
  .run-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .stop-btn {
    padding: 0.4rem 0.85rem;
    border: 1px solid #cc0033;
    background: white;
    color: #cc0033;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .stop-btn:hover:not(:disabled) {
    background: #cc0033;
    color: white;
  }
  .stop-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .export-btn {
    padding: 0.4rem 0.85rem;
    border: 1px solid #d0d0d0;
    background: white;
    color: #555;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    font-family: system-ui, sans-serif;
    margin-left: auto;
  }
  .export-btn:hover:not(:disabled) {
    border-color: #0066cc;
    color: #0066cc;
  }
  .export-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .export-count {
    color: #888;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    margin-left: 0.2rem;
  }
  .loop-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    color: #555;
    user-select: none;
    font-family: system-ui, sans-serif;
  }
  .loop-toggle:hover {
    color: #0066cc;
  }
  .loop-toggle input[type="checkbox"] {
    margin: 0;
    cursor: pointer;
  }

  .footnote {
    margin: 0.4rem 0 0;
    color: #aaa;
    font-size: 0.75rem;
  }
</style>

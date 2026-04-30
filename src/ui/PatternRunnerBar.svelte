<script lang="ts">
  import { app, runPattern, stopPattern } from './stores.svelte';
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
    Temp panel — DAW (β) kommer ersätta. Patterns kappas till 5 reps i α2 för dev-tempo.
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
    margin-left: auto;
  }
  .stop-btn:hover:not(:disabled) {
    background: #cc0033;
    color: white;
  }
  .stop-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .footnote {
    margin: 0.4rem 0 0;
    color: #aaa;
    font-size: 0.75rem;
  }
</style>

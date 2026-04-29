<script lang="ts">
  import { app, setDesiredIntensity, setCeiling } from './stores.svelte';

  let showCeilingEdit = $state(false);
  let ceilingDraft = $state(0);

  function onSlider(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    setDesiredIntensity(v);
  }

  function openCeilingEdit(): void {
    ceilingDraft = app.ceiling;
    showCeilingEdit = true;
  }

  function applyCeiling(): void {
    setCeiling(ceilingDraft);
    showCeilingEdit = false;
  }

  let showEffective = $derived(app.effectiveIntensity !== app.desiredIntensity);
</script>

<section class="intensity">
  <h2>
    Intensity
    <button class="edit-cap" onclick={openCeilingEdit} title="Configure max ceiling">
      cap: {app.ceiling}%
    </button>
  </h2>

  <div class="bar">
    <div class="track">
      <div class="fill desired" style:width="{(app.desiredIntensity / app.ceiling) * 100}%"></div>
      {#if showEffective}
        <div class="fill effective" style:width="{(app.effectiveIntensity / app.ceiling) * 100}%"></div>
      {/if}
    </div>
    <div class="readouts">
      <span class="desired-label">Desired: {app.desiredIntensity}%</span>
      {#if showEffective}
        <span class="effective-label">Output: {app.effectiveIntensity}%</span>
      {/if}
    </div>
  </div>

  <input
    type="range"
    min="0"
    max={app.ceiling}
    step="1"
    value={app.desiredIntensity}
    oninput={onSlider}
    disabled={app.connection === 'disconnected'}
  />

  {#if showCeilingEdit}
    <div class="ceiling-edit">
      <label>
        Max ceiling (%):
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          bind:value={ceilingDraft}
        />
      </label>
      <button onclick={applyCeiling}>Apply</button>
      <button class="cancel" onclick={() => (showCeilingEdit = false)}>Cancel</button>
    </div>
  {/if}
</section>

<style>
  .intensity {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 1rem 1.25rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .edit-cap {
    border: 1px solid #d0d0d0;
    background: #fafafa;
    border-radius: 4px;
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    color: #555;
    cursor: pointer;
    text-transform: none;
    letter-spacing: 0;
  }
  .bar {
    margin: 0.5rem 0 1rem;
  }
  .track {
    position: relative;
    height: 18px;
    background: #f0f0f0;
    border-radius: 9px;
    overflow: hidden;
  }
  .fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    border-radius: 9px;
    transition: width 0.1s ease;
  }
  .fill.desired {
    background: rgba(0, 102, 204, 0.3);
  }
  .fill.effective {
    background: #cc6600;
  }
  .readouts {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: #555;
    display: flex;
    gap: 1rem;
  }
  .effective-label {
    color: #cc6600;
    font-weight: 600;
  }
  input[type='range'] {
    width: 100%;
  }
  .ceiling-edit {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid #f0f0f0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #555;
  }
  .ceiling-edit input[type='number'] {
    width: 4rem;
    margin-left: 0.5rem;
    padding: 0.25rem 0.4rem;
    border: 1px solid #d0d0d0;
    border-radius: 3px;
  }
  .ceiling-edit button {
    padding: 0.3rem 0.7rem;
    border: 1px solid #0066cc;
    background: #0066cc;
    color: white;
    border-radius: 3px;
    cursor: pointer;
  }
  .ceiling-edit button.cancel {
    border-color: #aaa;
    background: #fafafa;
    color: #555;
  }
</style>

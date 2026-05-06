<script lang="ts">
  /**
   * Master-strip — vertikal master-fader till höger om de 9 channel-strips.
   * DAW-konvention. Ersätter standalone IntensitySlider-panelen.
   *
   * Kontroller:
   * - Vertikal fader för app.desiredIntensity (0..ceiling, percent)
   * - Ceiling-cap edit (samma som tidigare IntensitySlider — säkerhetsgräns
   *   som master-fader inte kan överstiga)
   * - Effective-readout (post-ramp) under fader
   *
   * Bound till SAMMA app-state som tidigare IntensitySlider — bara visuell
   * refactor, ingen ändring i ramp/safety-paths.
   */
  import VerticalFader from './VerticalFader.svelte';
  import { app, setDesiredIntensity, setCeiling } from '../stores.svelte';

  let showCeilingEdit = $state(false);
  let ceilingDraft = $state(0);

  function onMasterChange(v: number): void {
    // Clamp till [0, ceiling] (master kan inte överstiga ceiling-safety)
    const clamped = Math.max(0, Math.min(app.ceiling, Math.round(v)));
    setDesiredIntensity(clamped);
  }

  function openCeilingEdit(): void {
    ceilingDraft = app.ceiling;
    showCeilingEdit = true;
  }

  function applyCeiling(): void {
    setCeiling(ceilingDraft);
    showCeilingEdit = false;
  }

  let isDisabled = $derived(app.connection === 'disconnected');
  let masterBounds = $derived({ min: 0, max: app.ceiling });
  let showEffective = $derived(app.effectiveIntensity !== app.desiredIntensity);
</script>

<div class="master-strip" data-testid="master-strip">
  <div class="master-header">
    <span class="master-label">MASTER</span>
    <button
      class="cap-btn"
      onclick={openCeilingEdit}
      title="Configure max ceiling (safety cap)"
      data-testid="master-cap-btn"
    >cap {app.ceiling}%</button>
  </div>

  <div class="fader-area">
    <VerticalFader
      value={app.desiredIntensity}
      bounds={masterBounds}
      defaultValue={0}
      unit="hz"
      label="GAIN"
      onChange={onMasterChange}
      disabled={isDisabled}
      height={150}
      width={36}
    />
  </div>

  <div class="readouts">
    <div class="readout">
      <span class="readout-label">DESIRED</span>
      <span class="readout-value">{app.desiredIntensity}%</span>
    </div>
    {#if showEffective}
      <div class="readout effective" title="Post-ramp output (current actual intensity sent till box)">
        <span class="readout-label">OUT</span>
        <span class="readout-value">{app.effectiveIntensity}%</span>
      </div>
    {/if}
  </div>

  {#if showCeilingEdit}
    <div class="ceiling-edit" role="dialog" aria-label="Configure ceiling">
      <label>
        Ceiling %
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          bind:value={ceilingDraft}
          data-testid="master-ceiling-input"
        />
      </label>
      <div class="ceiling-actions">
        <button onclick={applyCeiling} data-testid="master-ceiling-apply">Apply</button>
        <button class="cancel" onclick={() => (showCeilingEdit = false)}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .master-strip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.5rem;
    background: #fafafa;
    border: 1px solid #d0d0d0;
    border-radius: 6px;
    min-width: 100px;
    /* Distinkt från channel-strips: samma höjd ungefär men tyngre border */
    border-left: 3px solid #cc0033;
  }
  .master-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
  }
  .master-label {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 700;
    color: #cc0033;
    letter-spacing: 0.08em;
  }
  .cap-btn {
    border: 1px solid #d0d0d0;
    background: white;
    border-radius: 3px;
    padding: 0.15rem 0.4rem;
    font-family: ui-monospace, monospace;
    font-size: 0.65rem;
    color: #555;
    cursor: pointer;
  }
  .cap-btn:hover {
    border-color: #cc0033;
    color: #cc0033;
  }

  .fader-area {
    padding: 0.3rem 0;
  }

  .readouts {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    width: 100%;
  }
  .readout {
    display: flex;
    justify-content: space-between;
    width: 100%;
    color: #555;
  }
  .readout-label {
    color: #888;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    align-self: center;
  }
  .readout-value {
    font-weight: 600;
    color: #333;
    font-variant-numeric: tabular-nums;
  }
  .readout.effective .readout-value {
    color: #cc6600;
  }

  .ceiling-edit {
    position: absolute;
    margin-top: 100%;
    background: white;
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    padding: 0.5rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.78rem;
  }
  .ceiling-edit label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: #555;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
  }
  .ceiling-edit input[type='number'] {
    width: 5rem;
    padding: 0.25rem 0.4rem;
    border: 1px solid #d0d0d0;
    border-radius: 3px;
  }
  .ceiling-actions {
    display: flex;
    gap: 0.3rem;
  }
  .ceiling-edit button {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: 1px solid #cc0033;
    background: #cc0033;
    color: white;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.75rem;
  }
  .ceiling-edit button.cancel {
    border-color: #aaa;
    background: #fafafa;
    color: #555;
  }
</style>

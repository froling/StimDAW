<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    synth,
    addChannel,
    addLfo,
    setActiveSource,
  } from './synth/synth-store.svelte';
  import MixerChannel from './synth/MixerChannel.svelte';
  import LFOModule from './synth/LFOModule.svelte';
  import CableLayer from './synth/CableLayer.svelte';
  import { lfoColor } from './synth/cable-helpers';
  import { ElectrodeMask, elconId, type Elcon } from '../patterns/types';
  import type { MixerChannel as ChannelT } from '../synth/types';
  import { app, startMixer, stopMixer, setLogDescriptors } from './stores.svelte';

  /**
   * Top-level Mixer-panel — komponerar MixerChannels + LFOs + CableLayer.
   *
   * Per design-audit F2: seed-state vid första mount (ingen kallstart).
   * 1 channel AC↔BD + 1 LFO sine 0.5Hz — användaren ser något, kan dra
   * cable till en knob och se modulering omedelbart i Oscilloscope.
   *
   * Per audit F1: Mixer mountas via App.svelte source-tabs (mutex),
   * ej parallellt med PatternRunnerBar.
   */

  let containerEl = $state<HTMLElement | null>(null);

  /**
   * F2 seed-state: 1 channel + 1 LFO vid FÖRSTA mount om allt är tomt.
   * onMount istället för $effect så seed inte re-fires om user senare
   * raderar allt manuellt (surprising UX att defaults plötsligt återkommer).
   */
  onMount(() => {
    if (synth.current.channels.length === 0 && synth.current.lfos.length === 0) {
      addChannel([ElectrodeMask.A, ElectrodeMask.C]);
      addLfo('sine');
    }
  });

  /** Mode-mutex (1.3A): markera mixer som aktiv vid mount, stäng av vid unmount. */
  $effect(() => {
    setActiveSource('mixer');
    return () => {
      setActiveSource('idle');
    };
  });

  /**
   * Auto-add nya channel-elcons till app.visibleElcons så Oscilloscope
   * visar rows omedelbart när channels läggs till. User toggle-off
   * persisterar (vi addar bara, tar aldrig bort). untrack() runt
   * visibleElcons-läs så $effect inte triggrar om sig själv.
   */
  $effect(() => {
    const channels = synth.current.channels; // tracked
    untrack(() => {
      const next = new Set(app.visibleElcons);
      let changed = false;
      for (const ch of channels) {
        const id = elconId(ch.elcon);
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (changed) app.visibleElcons = next;
    });
  });

  /** Beräkna modColors för en channel — vilka av dess knobs är modulerade,
   *  och i vilken LFO-färg. Per audit F4. */
  function getModColors(
    ch: ChannelT,
  ): { pulseWidth?: string; pace?: string; amplitude?: string } {
    const result: { pulseWidth?: string; pace?: string; amplitude?: string } = {};
    for (const knobName of ['pulseWidth', 'pace', 'amplitude'] as const) {
      const cableId = ch.knobs[knobName].modCableId;
      if (!cableId) continue;
      const cable = synth.current.cables.find((c) => c.id === cableId);
      if (!cable) continue;
      const lfoIdx = synth.current.lfos.findIndex((l) => l.id === cable.sourceLfoId);
      if (lfoIdx >= 0) {
        result[knobName] = lfoColor(lfoIdx);
      }
    }
    return result;
  }

  function onAddChannel(): void {
    // Default ny channel — användaren kan picka elcon i en framtida picker (β.1)
    // För β.0: cykla genom A>B, A>C, A>D, B>C, B>D, C>D
    const used = new Set(
      synth.current.channels.map((c) => `${c.elcon[0]}-${c.elcon[1]}`),
    );
    const candidates: Elcon[] = [
      [ElectrodeMask.A, ElectrodeMask.B],
      [ElectrodeMask.A, ElectrodeMask.C],
      [ElectrodeMask.A, ElectrodeMask.D],
      [ElectrodeMask.B, ElectrodeMask.C],
      [ElectrodeMask.B, ElectrodeMask.D],
      [ElectrodeMask.C, ElectrodeMask.D],
    ];
    const next = candidates.find((e) => !used.has(`${e[0]}-${e[1]}`));
    if (next) {
      addChannel(next);
    } else {
      // All 6 disjoint A-D pairs used — bara lägg till en duplikat (allowed per Hour 4-5)
      addChannel([ElectrodeMask.A, ElectrodeMask.B]);
    }
  }

  function onAddLfo(): void {
    // Cycle shapes så successive LFOs blir distinkta
    const shapes = ['sine', 'saw', 'square', 'triangle'] as const;
    const idx = synth.current.lfos.length % shapes.length;
    addLfo(shapes[idx]!);
  }

  let isRunning = $derived(app.isMixerRunning);

  function onRun(): void {
    startMixer();
  }
  function onStop(): void {
    stopMixer();
  }
</script>

<section class="mixer" bind:this={containerEl} data-testid="mixer-panel">
  <div class="mixer-header">
    <h2 class="mixer-title">Mixer</h2>
    <span class="status">
      {#if isRunning}
        <span class="dot running"></span> running
      {:else}
        <span class="dot idle"></span> idle
      {/if}
    </span>
    <div class="mixer-controls">
      <label
        class="log-toggle"
        title="Logga varje descriptor till browser-konsolen ('synth-emit' prefix) + summary i CLI-panelen var 1s"
      >
        <input
          type="checkbox"
          checked={app.logDescriptors}
          onchange={(e) => setLogDescriptors((e.currentTarget as HTMLInputElement).checked)}
          data-testid="mixer-log-toggle"
        />
        Log descriptors
      </label>
      <button
        type="button"
        class="run-btn"
        onclick={onRun}
        disabled={app.connection === 'disconnected' || isRunning}
        data-testid="mixer-run"
      >
        Run
      </button>
      <button
        type="button"
        class="stop-btn"
        onclick={onStop}
        disabled={!isRunning}
        data-testid="mixer-stop"
      >
        Stop
      </button>
    </div>
  </div>

  <div class="section channels-section">
    <div class="section-header">
      <span class="section-label">Channels</span>
    </div>
    <div class="section-content">
      {#each synth.current.channels as ch (ch.id)}
        <MixerChannel channel={ch} modColors={getModColors(ch)} />
      {/each}
      <button class="add-card" type="button" onclick={onAddChannel} data-testid="mixer-add-channel">
        <span class="plus">+</span>
        <span class="add-label">Channel</span>
      </button>
    </div>
  </div>

  <div class="section lfos-section">
    <div class="section-header">
      <span class="section-label">Modulators</span>
    </div>
    <div class="section-content">
      {#each synth.current.lfos as lfo, i (lfo.id)}
        <LFOModule {lfo} color={lfoColor(i)} />
      {/each}
      <button class="add-card" type="button" onclick={onAddLfo} data-testid="mixer-add-lfo">
        <span class="plus">+</span>
        <span class="add-label">LFO</span>
      </button>
    </div>
  </div>

  <CableLayer {containerEl} />

  <p class="footnote">
    Live source — synth-engine emits PtDescriptors event-driven per channel.
    Stop drains queue. β.0: 1 cable per knob, multi-cable + sync-modes deferred till γ.
  </p>
</section>

<style>
  .mixer {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
  }
  .mixer-header {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 1.25rem;
    border-bottom: 1px solid #e5e5e5;
  }
  .mixer-title {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin: 0;
  }
  .status {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #888;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
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
  .mixer-controls {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
  }
  .log-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    color: #666;
    cursor: pointer;
    user-select: none;
  }
  .log-toggle input {
    margin: 0;
    cursor: pointer;
  }
  .log-toggle:hover {
    color: #333;
  }
  .run-btn {
    padding: 0.35rem 0.85rem;
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
    padding: 0.35rem 0.85rem;
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

  .section {
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid #f3f3f3;
  }
  .section:last-of-type {
    border-bottom: none;
  }
  .section-header {
    margin-bottom: 0.5rem;
  }
  .section-label {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
  }
  .section-content {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: flex-start;
  }

  .add-card {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    background: transparent;
    border: 1.5px dashed #d0d0d0;
    border-radius: 6px;
    padding: 1rem 0.8rem;
    min-width: 80px;
    min-height: 100px;
    cursor: pointer;
    color: #888;
    font-family: system-ui, sans-serif;
    font-size: 0.78rem;
    transition: border-color 0.1s, color 0.1s, background 0.1s;
  }
  .add-card:hover {
    border-color: #0066cc;
    color: #0066cc;
    background: #f7faff;
  }
  .add-card .plus {
    font-size: 1.4rem;
    line-height: 1;
  }
  .add-card .add-label {
    font-size: 0.72rem;
    letter-spacing: 0.03em;
  }

  .footnote {
    margin: 0;
    padding: 0.5rem 0.85rem;
    border-top: 1px solid #f3f3f3;
    color: #aaa;
    font-size: 0.72rem;
    line-height: 1.4;
  }
</style>

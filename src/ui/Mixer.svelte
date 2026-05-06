<script lang="ts">
  import { onMount } from 'svelte';
  import {
    synth,
    addChannel,
    addLfo,
    addChain,
    setActiveSource,
    updateKnobBase,
  } from './synth/synth-store.svelte';
  import MixerChannel from './synth/MixerChannel.svelte';
  import LFOModule from './synth/LFOModule.svelte';
  import LFOChainModule from './synth/LFOChainModule.svelte';
  import CableLayer from './synth/CableLayer.svelte';
  import MasterStrip from './synth/MasterStrip.svelte';
  import { lfoColor } from './synth/cable-helpers';
  import { ElectrodeMask, type Elcon } from '../patterns/types';
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
   * Mixerbord-seed: 9 fasta channels för de hardware-valid elcon-konfigs +
   * 1 default LFO. Alla channels startar med AMP=0 (fader på noll, no-op
   * descriptors skippas av engine). Användaren lyfter fadern på de
   * channels de vill aktivera — som ett vanligt mixerbord.
   *
   * onMount istället för $effect så seed inte re-fires vid manuell
   * mute/cleanup. Om user lägger till en chain eller modifierar något
   * och sedan tömmer state (oklar future-feature), körs seed igen
   * eftersom guard kollar BÅDA tomma.
   */
  const HARDWARE_VALID_ELCONS: readonly Elcon[] = [
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.A, ElectrodeMask.D],
    [ElectrodeMask.C, ElectrodeMask.B],
    [ElectrodeMask.C, ElectrodeMask.D],
    [ElectrodeMask.A, ElectrodeMask.BD],
    [ElectrodeMask.C, ElectrodeMask.BD],
    [ElectrodeMask.AC, ElectrodeMask.B],
    [ElectrodeMask.AC, ElectrodeMask.D],
    [ElectrodeMask.AC, ElectrodeMask.BD],
  ] as const;

  onMount(() => {
    if (synth.current.channels.length === 0 && synth.current.lfos.length === 0) {
      // Seed alla 9 channels först, sätt deras AMP=0 efter (KNOB_DEFAULTS
      // ger 128 vid addChannel — vi overrider för fader-at-zero-default).
      for (const elcon of HARDWARE_VALID_ELCONS) {
        addChannel(elcon);
      }
      // AMP=0 för alla channels så de är tysta från start (engine skippar
      // emit när amp=0 efter clamp). User lyfter fadern på de de vill ha.
      for (const ch of synth.current.channels) {
        updateKnobBase(ch.id, 'amplitude', 0);
      }
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
   * β post-rewrite: Oscilloscope visar alltid 4 fasta electrode-rader
   * (A/B/C/D), inte per-elcon-rader. Ingen visibleElcons-logic behövs
   * längre — channels lägger automatiskt till pulser på de electrodes
   * de berör.
   */

  /**
   * Få modulator-color baserat på source-id (LFO eller chain).
   * LFOs använder lfoColor-paletten. Chains får en separat orange-tone
   * (#cc6600) för visuell distinktion oavsett vilken LFO-rot de hänger på.
   */
  function modulatorColor(sourceId: string): string | null {
    const lfoIdx = synth.current.lfos.findIndex((l) => l.id === sourceId);
    if (lfoIdx >= 0) return lfoColor(lfoIdx);
    const chainIdx = synth.current.chains.findIndex((c) => c.id === sourceId);
    if (chainIdx >= 0) return CHAIN_COLOR;
    return null;
  }

  /** Färg för chain output-port + cables från chain. Distinkt från LFO-paletten. */
  const CHAIN_COLOR = '#cc6600';

  /** Beräkna modColors för en channel — vilka av dess knobs är modulerade,
   *  och i vilken modulator-färg. Per audit F4 + chain-extension. */
  function getModColors(
    ch: ChannelT,
  ): { pulseWidth?: string; pace?: string; amplitude?: string } {
    const result: { pulseWidth?: string; pace?: string; amplitude?: string } = {};
    for (const knobName of ['pulseWidth', 'pace', 'amplitude'] as const) {
      const cableId = ch.knobs[knobName].modCableId;
      if (!cableId) continue;
      const cable = synth.current.cables.find((c) => c.id === cableId);
      if (!cable) continue;
      const color = modulatorColor(cable.sourceLfoId);
      if (color) result[knobName] = color;
    }
    return result;
  }

  /**
   * Bygg lista av tillgängliga sources för en given chain (LFOs + andra
   * chains exkl. self + descendants — undvik cycle vid source-pick).
   */
  function getAvailableSources(chainId: string): { id: string; label: string }[] {
    // Hitta alla descendants (transitivt) av chainId — de får INTE väljas
    // som source pga cycle.
    const forbidden = new Set<string>([chainId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of synth.current.chains) {
        if (forbidden.has(c.sourceId) && !forbidden.has(c.id)) {
          forbidden.add(c.id);
          changed = true;
        }
      }
    }
    const out: { id: string; label: string }[] = [];
    for (const lfo of synth.current.lfos) {
      out.push({ id: lfo.id, label: lfo.id });
    }
    for (const c of synth.current.chains) {
      if (forbidden.has(c.id)) continue;
      out.push({ id: c.id, label: c.id });
    }
    return out;
  }

  function onAddLfo(): void {
    // Cycle shapes så successive LFOs blir distinkta
    const shapes = ['sine', 'saw', 'square', 'triangle'] as const;
    const idx = synth.current.lfos.length % shapes.length;
    addLfo(shapes[idx]!);
  }

  /**
   * Lägg till chain. Default source = första LFO (rotmodulator). Om inga
   * LFOs finns, no-op (chain måste hänga på en rate-source).
   */
  function onAddChain(): void {
    const firstLfo = synth.current.lfos[0];
    if (!firstLfo) return;
    addChain(firstLfo.id, { trigger: 'full', shape: 'sine' });
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
      <span class="section-hint">9 fasta hardware-valid elcons · AMP fader-up släpper ström</span>
    </div>
    <div class="section-content channels-row">
      {#each synth.current.channels as ch (ch.id)}
        <MixerChannel channel={ch} modColors={getModColors(ch)} />
      {/each}
      <MasterStrip />
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
      {#each synth.current.chains as chain (chain.id)}
        <LFOChainModule
          {chain}
          availableSources={getAvailableSources(chain.id)}
          color={CHAIN_COLOR}
        />
      {/each}
      <button class="add-card" type="button" onclick={onAddLfo} data-testid="mixer-add-lfo">
        <span class="plus">+</span>
        <span class="add-label">LFO</span>
      </button>
      <button
        class="add-card add-card-chain"
        type="button"
        onclick={onAddChain}
        disabled={synth.current.lfos.length === 0}
        title={synth.current.lfos.length === 0 ? 'Add an LFO first — chain needs a rate source' : 'Add LFO Chain (slave-modulator with source-driven rate)'}
        data-testid="mixer-add-chain"
      >
        <span class="plus">+</span>
        <span class="add-label">Chain</span>
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
  .section-content.channels-row {
    /* Mixerbord-konvention: alla strips på en rad, master sist till höger.
       Wrap:ar bara på mobile (<720px) så desktop ser klassiskt mixerbord ut. */
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 0.3rem;
    align-items: stretch;
  }
  .section-hint {
    margin-left: 0.5rem;
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    color: #aaa;
    letter-spacing: 0.02em;
  }
  @media (max-width: 720px) {
    .section-content.channels-row {
      flex-wrap: wrap;
    }
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
  .add-card:hover:not(:disabled) {
    border-color: #0066cc;
    color: #0066cc;
    background: #f7faff;
  }
  .add-card:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .add-card .plus {
    font-size: 1.4rem;
    line-height: 1;
  }
  .add-card .add-label {
    font-size: 0.72rem;
    letter-spacing: 0.03em;
  }
  .add-card-chain {
    /* Chain-tint: orange istället för blå för att matcha CHAIN_COLOR */
    border-color: #e0c0a0;
  }
  .add-card-chain:hover:not(:disabled) {
    border-color: #cc6600;
    color: #cc6600;
    background: #fdf8f2;
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

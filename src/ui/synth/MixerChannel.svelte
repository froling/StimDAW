<script lang="ts">
  /**
   * Channel-strip i mixerbord-paradigm. Vertikal layout, från topp till botten:
   *   Mute-knapp (grön=on, röd=mute)
   *   Elcon-label (read-only — channels är fasta i Stage 2-mixer)
   *   PW-knob (rotary, 40px)
   *   PACE-knob (rotary, 40px)
   *   AMP-fader (vertikal, 30×150 — DAW-konvention)
   *
   * Channels är fasta i Stage 2 — ingen ElconPicker, ingen remove-knapp.
   * AMP=0 från seed → tystnad. Fader-up släpper ström.
   */
  import Knob from './Knob.svelte';
  import VerticalFader from './VerticalFader.svelte';
  import {
    updateKnobBase,
    setChannelEnabled,
  } from './synth-store.svelte';
  import { elconToLabel } from '../../patterns/types';
  import {
    PULSE_WIDTH_BOUNDS,
    PACE_BOUNDS,
    AMPLITUDE_BOUNDS,
  } from '../../protocol/hardware-bounds';
  import { KNOB_DEFAULTS, type MixerChannel } from '../../synth/types';

  type Props = {
    channel: MixerChannel;
    /** Cable-färg per knob baserat på modSource (modulator id → palette-färg). */
    modColors?: {
      pulseWidth?: string;
      pace?: string;
      amplitude?: string;
    };
  };

  let { channel, modColors = {} }: Props = $props();

  function setPulseWidth(v: number): void {
    updateKnobBase(channel.id, 'pulseWidth', v);
  }
  function setPace(v: number): void {
    updateKnobBase(channel.id, 'pace', v);
  }
  function setAmplitude(v: number): void {
    updateKnobBase(channel.id, 'amplitude', v);
  }

  function toggleEnabled(): void {
    setChannelEnabled(channel.id, !channel.enabled);
  }
</script>

<div
  class="channel-strip"
  class:muted={!channel.enabled}
  data-testid="channel-strip"
  data-channel-id={channel.id}
>
  <button
    class="mute-btn"
    class:on={channel.enabled}
    onclick={toggleEnabled}
    title={channel.enabled ? 'Mute channel' : 'Unmute channel'}
    aria-label={channel.enabled ? 'Mute channel' : 'Unmute channel'}
    aria-pressed={!channel.enabled}
    data-testid="channel-mute"
  >M</button>

  <span class="elcon-label" title="Hardware electrode pair (fixed)">
    {elconToLabel(channel.elcon)}
  </span>

  <div class="knob-row">
    <div
      class="knob-port"
      data-knob-port="true"
      data-channel-id={channel.id}
      data-knob-name="pulseWidth"
    >
      <Knob
        value={channel.knobs.pulseWidth.base}
        bounds={PULSE_WIDTH_BOUNDS}
        defaultValue={KNOB_DEFAULTS.pulseWidthMicros}
        unit="us"
        label="PW"
        modSourceId={channel.knobs.pulseWidth.modCableId}
        modColor={modColors.pulseWidth}
        onChange={setPulseWidth}
        size={40}
      />
    </div>
  </div>

  <div class="knob-row">
    <div
      class="knob-port"
      data-knob-port="true"
      data-channel-id={channel.id}
      data-knob-name="pace"
    >
      <Knob
        value={channel.knobs.pace.base}
        bounds={PACE_BOUNDS}
        log={true}
        defaultValue={KNOB_DEFAULTS.paceMicros}
        unit="ms"
        label="Pace"
        modSourceId={channel.knobs.pace.modCableId}
        modColor={modColors.pace}
        onChange={setPace}
        size={40}
      />
    </div>
  </div>

  <!-- AMP-fader är drop-target för cables, så data-knob-port här också. -->
  <div
    class="fader-port"
    data-knob-port="true"
    data-channel-id={channel.id}
    data-knob-name="amplitude"
  >
    <VerticalFader
      value={channel.knobs.amplitude.base}
      bounds={AMPLITUDE_BOUNDS}
      defaultValue={0}
      unit="percent"
      label="AMP"
      modSourceId={channel.knobs.amplitude.modCableId}
      modColor={modColors.amplitude}
      onChange={setAmplitude}
      height={140}
      width={28}
    />
  </div>
</div>

<style>
  .channel-strip {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 0.4rem 0.3rem;
    gap: 0.3rem;
    min-width: 78px;
    width: 78px;
    transition: opacity 0.15s, border-color 0.15s;
  }
  .channel-strip.muted {
    /* Muted = mer dim:ad än enabled så user ser status snabbt */
    opacity: 0.55;
    border-color: #f0d0d0;
  }
  .channel-strip:hover {
    border-color: #c0c0c0;
  }

  .mute-btn {
    /* M-knapp: grön när enabled, röd när muted */
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1.5px solid;
    background: white;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex-shrink: 0;
    transition: all 0.1s;
  }
  .mute-btn.on {
    border-color: #2a7;
    color: #2a7;
    background: #f0fff5;
  }
  .mute-btn:not(.on) {
    border-color: #cc0033;
    color: #cc0033;
    background: #fff0f3;
  }
  .mute-btn:hover {
    transform: scale(1.05);
  }

  .elcon-label {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 600;
    color: #333;
    letter-spacing: 0.02em;
    line-height: 1;
    white-space: nowrap;
  }

  .knob-row {
    display: flex;
    justify-content: center;
  }

  .knob-port {
    position: relative;
    border-radius: 6px;
    padding: 2px;
    transition: outline 0.1s, background 0.1s;
  }
  .fader-port {
    position: relative;
    padding: 2px;
    border-radius: 4px;
    transition: outline 0.1s, background 0.1s;
  }

  /* Drop-target highlights — sätts av CableLayer under drag */
  :global(.knob-port.drop-target-available),
  :global(.fader-port.drop-target-available) {
    outline: 2px dashed var(--drop-color, #888);
    outline-offset: 2px;
  }
  :global(.knob-port.drop-target-occupied),
  :global(.fader-port.drop-target-occupied) {
    outline: 2px solid var(--drop-color, #888);
    outline-offset: 2px;
    opacity: 0.6;
  }
</style>

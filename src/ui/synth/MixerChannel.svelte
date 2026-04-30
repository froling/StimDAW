<script lang="ts">
  import Knob from './Knob.svelte';
  import { updateKnobBase, setChannelEnabled, removeChannel } from './synth-store.svelte';
  import { elconToLabel } from '../../patterns/types';
  import {
    PULSE_WIDTH_BOUNDS,
    PACE_BOUNDS,
    AMPLITUDE_BOUNDS,
  } from '../../protocol/hardware-bounds';
  import { KNOB_DEFAULTS, type MixerChannel } from '../../synth/types';

  type Props = {
    channel: MixerChannel;
    /** Cable-färg per knob baserat på modSource (LFO id → palette-färg). */
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

  function onRemove(): void {
    if (confirm(`Remove channel ${elconToLabel(channel.elcon)}?`)) {
      removeChannel(channel.id);
    }
  }
</script>

<div class="channel-strip" class:disabled={!channel.enabled}>
  <div class="channel-header">
    <button
      class="enable-toggle"
      class:on={channel.enabled}
      onclick={toggleEnabled}
      title={channel.enabled ? 'Disable channel' : 'Enable channel'}
      aria-label={channel.enabled ? 'Disable channel' : 'Enable channel'}
    >
      {channel.enabled ? '●' : '○'}
    </button>
    <span class="elcon-label">{elconToLabel(channel.elcon)}</span>
    <button
      class="remove-btn"
      onclick={onRemove}
      title="Remove channel"
      aria-label="Remove channel"
    >×</button>
  </div>

  <div class="knobs">
    <Knob
      value={channel.knobs.pulseWidth.base}
      bounds={PULSE_WIDTH_BOUNDS}
      defaultValue={KNOB_DEFAULTS.pulseWidthMicros}
      unit="us"
      label="PW"
      modSourceId={channel.knobs.pulseWidth.modCableId}
      modColor={modColors.pulseWidth}
      onChange={setPulseWidth}
    />
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
    />
    <Knob
      value={channel.knobs.amplitude.base}
      bounds={AMPLITUDE_BOUNDS}
      defaultValue={KNOB_DEFAULTS.amplitude}
      unit="percent"
      label="Amp"
      modSourceId={channel.knobs.amplitude.modCableId}
      modColor={modColors.amplitude}
      onChange={setAmplitude}
    />
  </div>
</div>

<style>
  .channel-strip {
    display: flex;
    flex-direction: column;
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 0.6rem;
    gap: 0.5rem;
    min-width: 180px;
    transition: opacity 0.15s, border-color 0.15s;
  }
  .channel-strip.disabled {
    opacity: 0.4;
  }
  .channel-strip:hover {
    border-color: #c0c0c0;
  }

  .channel-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid #f0f0f0;
  }
  .enable-toggle {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid #ccc;
    background: white;
    color: #ccc;
    font-size: 0.6rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .enable-toggle.on {
    border-color: #66bb66;
    color: #66bb66;
  }
  .elcon-label {
    flex: 1;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    font-weight: 600;
    color: #333;
    letter-spacing: 0.02em;
  }
  .remove-btn {
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: transparent;
    color: #aaa;
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
  }
  .remove-btn:hover {
    color: #cc0033;
  }

  .knobs {
    display: flex;
    justify-content: space-around;
    padding: 0.3rem 0;
  }
</style>

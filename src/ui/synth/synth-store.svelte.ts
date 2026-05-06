/**
 * Svelte 5 runes-adapter över pure synth-state.
 *
 * Per eng-review 1.2A: pure data + actions bor i src/synth/state.ts (testbart
 * utan Svelte runtime). Denna modul wrappar dem som $state-rune och
 * exporterar action-funktioner som muterar via re-assignment.
 *
 * Följer samma mönster som src/ui/stores.svelte.ts (α2-shipping).
 */
import * as state from '../../synth/state';
import type { ChainTrigger, MixerState, WaveMode, WaveShape } from '../../synth/types';
import type { Elcon } from '../../patterns/types';

class SynthStore {
  /** Live state — UI-komponenter binder till denna via $derived/$effect. */
  current = $state<MixerState>(state.emptyState());
  /**
   * Mode-mutex per eng-review 1.3A: 'pattern-runner' (α2 PatternRunnerBar
   * aktiv) eller 'mixer' (β-mixer aktiv) eller 'idle'. UI disablar respektive
   * controls baserat på mode.
   */
  activeSource = $state<'idle' | 'pattern-runner' | 'mixer'>('idle');
}

export const synth = new SynthStore();

/**
 * Engine-hook injektion: stores.svelte.ts registrerar callback här efter
 * synthEngine init. Används av addChannel/setChannelEnabled-wrappers för att
 * informera engine om nya/re-enable:ade channels under aktiv run (annars
 * permanent tystnad — channels utan runtime-entry får aldrig schedule).
 *
 * Designval: callback istället för direkt SynthEngine-import för att undvika
 * cirkulär import (stores → synth-store → synth-engine → ... ).
 */
let engineHooks: { ensureChannelScheduled: (channelId: string) => void } | null = null;
export function attachEngineHooks(hooks: typeof engineHooks): void {
  engineHooks = hooks;
}

// ── Channel actions ────────────────────────────────────────────────

export function addChannel(elcon: Elcon): void {
  synth.current = state.addChannel(synth.current, elcon);
  // Notify engine om vi adderar mid-run så ny channel börjar emit:a
  const newCh = synth.current.channels[synth.current.channels.length - 1];
  if (newCh) engineHooks?.ensureChannelScheduled(newCh.id);
}

export function removeChannel(channelId: string): void {
  synth.current = state.removeChannel(synth.current, channelId);
}

export function updateKnobBase(
  channelId: string,
  knobName: 'pulseWidth' | 'pace' | 'amplitude',
  base: number,
): void {
  synth.current = state.updateKnobBase(synth.current, channelId, knobName, base);
}

export function setChannelEnabled(channelId: string, enabled: boolean): void {
  synth.current = state.setChannelEnabled(synth.current, channelId, enabled);
  // Disabled→enabled under run: re-schedule, annars channel tyst för alltid.
  if (enabled) engineHooks?.ensureChannelScheduled(channelId);
}

export function setChannelElcon(channelId: string, elcon: Elcon): void {
  synth.current = state.setChannelElcon(synth.current, channelId, elcon);
}

// ── Master clock ───────────────────────────────────────────────────

export function setMasterRate(masterRateHz: number): void {
  // Pass wall-time så alla LFOs får smooth glide under master-rate-byte.
  synth.current = state.setMasterRate(synth.current, masterRateHz, performance.now() * 1000);
}

// ── LFO actions ────────────────────────────────────────────────────

export function addLfo(shape: WaveShape = 'sine'): void {
  synth.current = state.addLfo(synth.current, shape);
}

export function removeLfo(lfoId: string): void {
  synth.current = state.removeLfo(synth.current, lfoId);
}

export function setLfoRate(lfoId: string, rate: number): void {
  // Skicka nuvarande wall-time som re-anchor så signalen är continuous över
  // rate-bytet (annars phase-glitch när user drar rate-knobben under run).
  // performance.now()*1000 = µs, samma tidsbas som RealtimeClock.
  synth.current = state.setLfoRate(synth.current, lfoId, rate, performance.now() * 1000);
}

export function setLfoAmount(lfoId: string, amount: number): void {
  synth.current = state.setLfoAmount(synth.current, lfoId, amount);
}

export function setLfoVolume(lfoId: string, volume: number): void {
  synth.current = state.setLfoVolume(synth.current, lfoId, volume);
}

export function setLfoShape(lfoId: string, shape: WaveShape): void {
  synth.current = state.setLfoShape(synth.current, lfoId, shape);
}

export function setLfoMode(lfoId: string, mode: WaveMode): void {
  synth.current = state.setLfoMode(synth.current, lfoId, mode);
}

// ── Chain actions ──────────────────────────────────────────────────

export function addChain(
  sourceId: string,
  options: {
    trigger?: ChainTrigger;
    shape?: WaveShape;
    amount?: number;
    mode?: WaveMode;
  } = {},
): void {
  synth.current = state.addChain(synth.current, sourceId, options);
  // Notify engine om vi skapar mid-run så ingen extra setup behövs
  // (chains har ingen runtime-state i engine, evaluateKnob läser direkt).
}

export function removeChain(chainId: string): void {
  synth.current = state.removeChain(synth.current, chainId);
}

export function setChainSource(chainId: string, newSourceId: string): void {
  synth.current = state.setChainSource(synth.current, chainId, newSourceId);
}

export function setChainTrigger(chainId: string, trigger: ChainTrigger): void {
  synth.current = state.setChainTrigger(synth.current, chainId, trigger);
}

export function setChainShape(chainId: string, shape: WaveShape): void {
  synth.current = state.setChainShape(synth.current, chainId, shape);
}

export function setChainAmount(chainId: string, amount: number): void {
  synth.current = state.setChainAmount(synth.current, chainId, amount);
}

export function setChainVolume(chainId: string, volume: number): void {
  synth.current = state.setChainVolume(synth.current, chainId, volume);
}

export function setChainMode(chainId: string, mode: WaveMode): void {
  synth.current = state.setChainMode(synth.current, chainId, mode);
}

// ── Cable actions ──────────────────────────────────────────────────

export function addCable(
  sourceLfoId: string,
  destChannelId: string,
  destKnobName: 'pulseWidth' | 'pace' | 'amplitude',
  depth = 0.5,
): void {
  synth.current = state.addCable(
    synth.current,
    sourceLfoId,
    destChannelId,
    destKnobName,
    depth,
  );
}

export function removeCable(cableId: string): void {
  synth.current = state.removeCable(synth.current, cableId);
}

export function setCableDepth(cableId: string, depth: number): void {
  synth.current = state.setCableDepth(synth.current, cableId, depth);
}

// ── Mode mutex (1.3A) ──────────────────────────────────────────────

export function setActiveSource(source: 'idle' | 'pattern-runner' | 'mixer'): void {
  synth.activeSource = source;
}

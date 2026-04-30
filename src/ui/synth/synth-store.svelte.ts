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
import type { MixerState, WaveShape } from '../../synth/types';
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

// ── Channel actions ────────────────────────────────────────────────

export function addChannel(elcon: Elcon): void {
  synth.current = state.addChannel(synth.current, elcon);
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
}

// ── LFO actions ────────────────────────────────────────────────────

export function addLfo(shape: WaveShape = 'sine'): void {
  synth.current = state.addLfo(synth.current, shape);
}

export function removeLfo(lfoId: string): void {
  synth.current = state.removeLfo(synth.current, lfoId);
}

export function setLfoRate(lfoId: string, rate: number): void {
  synth.current = state.setLfoRate(synth.current, lfoId, rate);
}

export function setLfoAmount(lfoId: string, amount: number): void {
  synth.current = state.setLfoAmount(synth.current, lfoId, amount);
}

export function setLfoShape(lfoId: string, shape: WaveShape): void {
  synth.current = state.setLfoShape(synth.current, lfoId, shape);
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

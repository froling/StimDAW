/**
 * Pure synth-state actions — immutable mutators returnerar nya snapshots.
 *
 * Per eng-review 1.2A: state är pure TS (ingen Svelte runtime). UI-action
 * dispatchas via Svelte adapter (synth-store.svelte.ts) som anropar dessa
 * pure-funktioner och uppdaterar `$state`-rune-bindning.
 *
 * Per eng-review 2.4A: cascade-delete invariant — cables.every(c =>
 *   lfos.some(l => l.id === c.sourceLfoId) &&
 *   channels.some(ch => ch.id === c.destChannelId)
 * ). Mutators bibehåller denna invariant automatiskt.
 *
 * Cable-replacement per eng-review 1.5A: addCable till upptaget knob
 * ersätter existing cable för samma destination (en cable per knob i β.0).
 */
import type {
  Cable,
  KnobState,
  LFO,
  MixerChannel,
  MixerState,
  WaveShape,
} from './types';
import { KNOB_DEFAULTS } from './types';
import type { Elcon } from '../patterns/types';
import { checkElcon } from '../patterns/validate';

let nextIdCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${nextIdCounter++}`;
}

/** Reset internal id-counter — test-only. */
export function _resetIdsForTesting(): void {
  nextIdCounter = 1;
}

export function emptyState(): MixerState {
  return { channels: [], lfos: [], cables: [] };
}

// ── Channels ────────────────────────────────────────────────────────

export function addChannel(state: MixerState, elcon: Elcon): MixerState {
  // Validera elcon mot hardware-buddy-pair-constraint (NeoDK switch matrix:
  // {A,C} delar T+ wiring, {B,D} delar T− wiring). Throws PatternValidationError
  // om invalid — UI ska aldrig skicka invalid, men defense-in-depth.
  checkElcon(elcon);
  const channel: MixerChannel = {
    id: nextId('ch'),
    elcon,
    knobs: {
      pulseWidth: { base: KNOB_DEFAULTS.pulseWidthMicros, modCableId: null },
      pace: { base: KNOB_DEFAULTS.paceMicros, modCableId: null },
      amplitude: { base: KNOB_DEFAULTS.amplitude, modCableId: null },
    },
    enabled: true,
  };
  return { ...state, channels: [...state.channels, channel] };
}

/**
 * Uppdatera elcon på existerande channel. Validerar mot buddy-pair-constraint.
 * UI:t (ElconPicker) använder detta när användaren togglar electrodes på/av.
 */
export function setChannelElcon(
  state: MixerState,
  channelId: string,
  elcon: Elcon,
): MixerState {
  checkElcon(elcon);
  return {
    ...state,
    channels: state.channels.map((ch) =>
      ch.id !== channelId ? ch : { ...ch, elcon },
    ),
  };
}

/**
 * Remove channel + cascade-delete cables vars destChannelId pekar på det.
 * Per eng-review 2.4A.
 */
export function removeChannel(state: MixerState, channelId: string): MixerState {
  // Cascade — bara filtrera cables; channel försvinner med sina knobs så
  // ingen modCableId kvar att rensa.
  return {
    ...state,
    channels: state.channels.filter((c) => c.id !== channelId),
    cables: state.cables.filter((c) => c.destChannelId !== channelId),
  };
}

export function updateKnobBase(
  state: MixerState,
  channelId: string,
  knobName: 'pulseWidth' | 'pace' | 'amplitude',
  base: number,
): MixerState {
  return {
    ...state,
    channels: state.channels.map((ch) =>
      ch.id !== channelId
        ? ch
        : {
            ...ch,
            knobs: {
              ...ch.knobs,
              [knobName]: { ...ch.knobs[knobName], base },
            },
          },
    ),
  };
}

export function setChannelEnabled(
  state: MixerState,
  channelId: string,
  enabled: boolean,
): MixerState {
  return {
    ...state,
    channels: state.channels.map((ch) =>
      ch.id !== channelId ? ch : { ...ch, enabled },
    ),
  };
}

// ── LFOs ────────────────────────────────────────────────────────────

export function addLfo(state: MixerState, shape: WaveShape = 'sine'): MixerState {
  const lfo: LFO = {
    id: nextId('lfo'),
    rate: 1, // 1Hz default
    amount: 1,
    shape,
    phase: 0,
  };
  return { ...state, lfos: [...state.lfos, lfo] };
}

/**
 * Remove LFO + cascade-delete cables från denna LFO. Per eng-review 2.4A.
 * Måste också rensa modCableId på knobs som pekade på de borttagna cables —
 * annars dangling reference brryter invariant.
 */
export function removeLfo(state: MixerState, lfoId: string): MixerState {
  const cablesToRemove = new Set(
    state.cables.filter((c) => c.sourceLfoId === lfoId).map((c) => c.id),
  );
  // Clear modCableId på alla knobs som pekade på borttagna cables
  const channels = state.channels.map((ch) => {
    let mutated = ch;
    for (const knobName of ['pulseWidth', 'pace', 'amplitude'] as const) {
      const knob = mutated.knobs[knobName];
      if (knob.modCableId !== null && cablesToRemove.has(knob.modCableId)) {
        mutated = {
          ...mutated,
          knobs: {
            ...mutated.knobs,
            [knobName]: { ...knob, modCableId: null },
          },
        };
      }
    }
    return mutated;
  });
  return {
    ...state,
    lfos: state.lfos.filter((l) => l.id !== lfoId),
    cables: state.cables.filter((c) => c.sourceLfoId !== lfoId),
    channels,
  };
}

export function setLfoRate(state: MixerState, lfoId: string, rate: number): MixerState {
  return {
    ...state,
    lfos: state.lfos.map((l) => (l.id !== lfoId ? l : { ...l, rate })),
  };
}

export function setLfoAmount(state: MixerState, lfoId: string, amount: number): MixerState {
  return {
    ...state,
    lfos: state.lfos.map((l) =>
      l.id !== lfoId ? l : { ...l, amount: Math.max(0, Math.min(1, amount)) },
    ),
  };
}

export function setLfoShape(state: MixerState, lfoId: string, shape: WaveShape): MixerState {
  return {
    ...state,
    lfos: state.lfos.map((l) => (l.id !== lfoId ? l : { ...l, shape })),
  };
}

// ── Cables ──────────────────────────────────────────────────────────

/**
 * Lägg till cable. Per eng-review 1.5A: en cable per knob i β.0 — om dest-
 * knob redan har cable så ersätt den (replace existing).
 *
 * Returnerar oförändrad state om source/dest inte existerar (defensive —
 * UI ska aldrig anropa med invalid refs men double-check skadar inte).
 */
export function addCable(
  state: MixerState,
  sourceLfoId: string,
  destChannelId: string,
  destKnobName: 'pulseWidth' | 'pace' | 'amplitude',
  depth: number = 0.5,
): MixerState {
  // Validate refs
  if (!state.lfos.some((l) => l.id === sourceLfoId)) return state;
  if (!state.channels.some((ch) => ch.id === destChannelId)) return state;

  // Per 1.5A: replace existing cable till samma dest-knob (en per knob)
  const filtered = state.cables.filter(
    (c) => !(c.destChannelId === destChannelId && c.destKnobName === destKnobName),
  );

  const cable: Cable = {
    id: nextId('cable'),
    sourceLfoId,
    destChannelId,
    destKnobName,
    depth: Math.max(0, Math.min(1, depth)),
  };

  // Update destination knob's modCableId
  const channels = state.channels.map((ch) => {
    if (ch.id !== destChannelId) return ch;
    return {
      ...ch,
      knobs: {
        ...ch.knobs,
        [destKnobName]: { ...ch.knobs[destKnobName], modCableId: cable.id },
      },
    };
  });

  return { ...state, cables: [...filtered, cable], channels };
}

export function removeCable(state: MixerState, cableId: string): MixerState {
  const cable = state.cables.find((c) => c.id === cableId);
  if (!cable) return state;

  // Clear destination knob's modCableId
  const channels = state.channels.map((ch) => {
    if (ch.id !== cable.destChannelId) return ch;
    return {
      ...ch,
      knobs: {
        ...ch.knobs,
        [cable.destKnobName]: {
          ...ch.knobs[cable.destKnobName],
          modCableId: null,
        },
      },
    };
  });

  return {
    ...state,
    cables: state.cables.filter((c) => c.id !== cableId),
    channels,
  };
}

export function setCableDepth(
  state: MixerState,
  cableId: string,
  depth: number,
): MixerState {
  return {
    ...state,
    cables: state.cables.map((c) =>
      c.id !== cableId ? c : { ...c, depth: Math.max(0, Math.min(1, depth)) },
    ),
  };
}

// ── Invariant validator (test helper) ───────────────────────────────

/**
 * Returnerar lista av cascade-delete-violations. Tom array = state är gilltigt.
 * Alla mutators ska bibehålla detta — om denna någonsin returnerar non-empty
 * är det en bug i en mutator.
 */
export function validateInvariants(state: MixerState): string[] {
  const issues: string[] = [];
  const lfoIds = new Set(state.lfos.map((l) => l.id));
  const channelIds = new Set(state.channels.map((ch) => ch.id));
  for (const cable of state.cables) {
    if (!lfoIds.has(cable.sourceLfoId)) {
      issues.push(`cable ${cable.id} pekar på obefintlig LFO ${cable.sourceLfoId}`);
    }
    if (!channelIds.has(cable.destChannelId)) {
      issues.push(`cable ${cable.id} pekar på obefintlig channel ${cable.destChannelId}`);
    }
  }
  // Knob modCableId references
  for (const ch of state.channels) {
    for (const knobName of ['pulseWidth', 'pace', 'amplitude'] as const) {
      const knob: KnobState = ch.knobs[knobName];
      if (knob.modCableId !== null) {
        const cable = state.cables.find((c) => c.id === knob.modCableId);
        if (!cable) {
          issues.push(
            `channel ${ch.id} knob ${knobName} pekar på obefintlig cable ${knob.modCableId}`,
          );
        }
      }
    }
  }
  return issues;
}

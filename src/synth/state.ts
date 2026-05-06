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
  ChainTrigger,
  KnobState,
  LFO,
  LfoChain,
  MixerChannel,
  MixerState,
  WaveMode,
  WaveShape,
} from './types';
import {
  KNOB_DEFAULTS,
  LFO_RATE_MIN,
  LFO_RATE_MAX,
  MASTER_RATE_MIN_HZ,
  MASTER_RATE_MAX_HZ,
  PHASE_GLIDE_DURATION_MICROS,
} from './types';
import { effectiveLfoPhase } from './lfo';
import type { Elcon } from '../patterns/types';
import { checkElcon } from '../patterns/validate';

const TWO_PI = Math.PI * 2;

let nextIdCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${nextIdCounter++}`;
}

/** Reset internal id-counter — test-only. */
export function _resetIdsForTesting(): void {
  nextIdCounter = 1;
}

export function emptyState(): MixerState {
  return { channels: [], lfos: [], chains: [], cables: [], masterRate: 1 };
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
    rate: 1, // 1.0 multiplier — samma takt som master
    amount: 1,
    // 0.5 = mittenlinje vid halv AMP-cap → maximalt symmetric headroom,
    // full ±cap/2 swing möjlig direkt från default
    volume: 0.5,
    shape,
    phase: 0,
    mode: 'bipolar',
  };
  return { ...state, lfos: [...state.lfos, lfo] };
}

/**
 * Remove LFO + transitiv cascade-delete: alla LfoChains som har denna LFO
 * som source (direkt eller indirekt via chain-kedja) raderas också, plus
 * cables till alla borttagna modulator-id (LFO + chains). Knob.modCableId
 * clears för knobs som pekade på borttagna cables.
 */
export function removeLfo(state: MixerState, lfoId: string): MixerState {
  // Hitta alla descendants i chain-grafen som har denna LFO som rot
  const descendantChains = findTransitiveDescendants(lfoId, state.chains);
  // descendantChains inkluderar lfoId själv — det är OK som lookup-key för
  // cables-filter

  const cablesToRemove = new Set(
    state.cables.filter((c) => descendantChains.has(c.sourceLfoId)).map((c) => c.id),
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
    chains: state.chains.filter((c) => !descendantChains.has(c.id)),
    cables: state.cables.filter((c) => !cablesToRemove.has(c.id)),
    channels,
  };
}

/**
 * Uppdatera LFO-rate (multiplier mot master). När `simNowMicros` ges seedas
 * en PhaseGlide så signalen är continuous över rate-bytet (ingen glitch),
 * och konvergerar mot ny fri-fas inom glideDur (default 1s). Utan simNowMicros
 * (test-kod eller före engine-start) byts rate utan glide.
 *
 * Rate clampas till LFO_RATE_MIN/MAX som multiplier (inte Hz). Faktisk Hz
 * = rate × masterRate.
 */
export function setLfoRate(
  state: MixerState,
  lfoId: string,
  rate: number,
  simNowMicros?: number,
): MixerState {
  const safeRate = Number.isFinite(rate)
    ? Math.max(LFO_RATE_MIN, Math.min(LFO_RATE_MAX, rate))
    : LFO_RATE_MIN;
  return {
    ...state,
    lfos: state.lfos.map((l) => {
      if (l.id !== lfoId) return l;
      if (simNowMicros === undefined || safeRate === l.rate) {
        return { ...l, rate: safeRate };
      }
      const glide = seedGlideForRateChange(l, safeRate, state.masterRate, simNowMicros);
      return { ...l, rate: safeRate, phaseGlide: glide };
    }),
  };
}

/**
 * Hjälpare: räkna ut PhaseGlide-state så att signalen är continuous över
 * rate-bytet (gammal phase vid simNow = ny phase vid simNow), och decayar
 * till 0 (= synk med fri-fas) inom glideDur.
 *
 * old_effective_phase(simNow) = new_free_phase(simNow) + glide_at_start + lfo.phase
 *   → glide_at_start = old_effective_phase - new_free_phase - lfo.phase
 *
 * Wrappar offset till [-π, π] för kortaste glide-väg.
 */
function seedGlideForRateChange(
  lfo: LFO,
  newRateMultiplier: number,
  masterRate: number,
  simNowMicros: number,
): { offset: number; glideStartMicros: number; glideDurMicros: number } {
  const oldPhase = effectiveLfoPhase(lfo, simNowMicros, masterRate);
  const tSec = simNowMicros / 1_000_000;
  const newRateHz = newRateMultiplier * masterRate;
  const newFreePhase = ((TWO_PI * newRateHz * tSec) % TWO_PI + TWO_PI) % TWO_PI;
  let offset = oldPhase - newFreePhase - lfo.phase;
  // Wrap till kortaste väg ∈ [-π, π]
  while (offset > Math.PI) offset -= TWO_PI;
  while (offset < -Math.PI) offset += TWO_PI;
  return {
    offset,
    glideStartMicros: simNowMicros,
    glideDurMicros: PHASE_GLIDE_DURATION_MICROS,
  };
}

/**
 * Sätt master-clock i Hz. Alla LFOs får ny PhaseGlide så signalerna förblir
 * continuous men konvergerar mot ny synk inom glideDur. Utan simNowMicros
 * byts master utan glide.
 */
export function setMasterRate(
  state: MixerState,
  masterRate: number,
  simNowMicros?: number,
): MixerState {
  const safeRate = Number.isFinite(masterRate)
    ? Math.max(MASTER_RATE_MIN_HZ, Math.min(MASTER_RATE_MAX_HZ, masterRate))
    : MASTER_RATE_MIN_HZ;
  if (simNowMicros === undefined || safeRate === state.masterRate) {
    return { ...state, masterRate: safeRate };
  }
  // Re-glide alla LFOs eftersom alla effective rates ändras synkront
  const lfos = state.lfos.map((l) => {
    const glide = seedGlideForMasterChange(l, safeRate, state.masterRate, simNowMicros);
    return { ...l, phaseGlide: glide };
  });
  return { ...state, masterRate: safeRate, lfos };
}

/**
 * Som seedGlideForRateChange men beräknar mot ändrad master istället för
 * ändrad lfo.rate. Använder gamla masterRate för old_effective_phase och
 * nya masterRate för new_free_phase.
 */
function seedGlideForMasterChange(
  lfo: LFO,
  newMasterRate: number,
  oldMasterRate: number,
  simNowMicros: number,
): { offset: number; glideStartMicros: number; glideDurMicros: number } {
  const oldPhase = effectiveLfoPhase(lfo, simNowMicros, oldMasterRate);
  const tSec = simNowMicros / 1_000_000;
  const newRateHz = lfo.rate * newMasterRate;
  const newFreePhase = ((TWO_PI * newRateHz * tSec) % TWO_PI + TWO_PI) % TWO_PI;
  let offset = oldPhase - newFreePhase - lfo.phase;
  while (offset > Math.PI) offset -= TWO_PI;
  while (offset < -Math.PI) offset += TWO_PI;
  return {
    offset,
    glideStartMicros: simNowMicros,
    glideDurMicros: PHASE_GLIDE_DURATION_MICROS,
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

/**
 * Sätt LFO bias-position (0..1). Påverkar bara AMP-cables (post-fader VCA).
 * volume=0 = mute, 0.5 = mittenlinje, 1 = top av cap (då headroom=0).
 */
export function setLfoVolume(state: MixerState, lfoId: string, volume: number): MixerState {
  return {
    ...state,
    lfos: state.lfos.map((l) =>
      l.id !== lfoId ? l : { ...l, volume: Math.max(0, Math.min(1, volume)) },
    ),
  };
}

export function setLfoShape(state: MixerState, lfoId: string, shape: WaveShape): MixerState {
  return {
    ...state,
    lfos: state.lfos.map((l) => (l.id !== lfoId ? l : { ...l, shape })),
  };
}

/** Sätt LFO polaritets-mode (bipolar / negative-boost / negative-only). */
export function setLfoMode(state: MixerState, lfoId: string, mode: WaveMode): MixerState {
  return {
    ...state,
    lfos: state.lfos.map((l) => (l.id !== lfoId ? l : { ...l, mode })),
  };
}

// ── LFO Chains ──────────────────────────────────────────────────────

/**
 * Hjälpare: hittar alla descendant chains (transitivt) för en given
 * source-modulator-id. Inkluderar source-id själv i returset.
 *
 * Använt av removeLfo + removeChain för att cascade-deletea hela
 * chain-grenar när rooten tas bort.
 */
function findTransitiveDescendants(
  rootId: string,
  chains: readonly LfoChain[],
): Set<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of chains) {
      if (!result.has(c.id) && result.has(c.sourceId)) {
        result.add(c.id);
        changed = true;
      }
    }
  }
  return result;
}

/**
 * Hjälpare: skulle en chain med `chainId` och `sourceId` skapa en cycle?
 * Walk source-grafen från sourceId; om vi någonsin når chainId = cycle.
 *
 * Vid addChain har vi inget existing chainId än — passera då en placeholder
 * som inte matchar nån befintlig chain.
 */
function wouldCreateCycle(
  chainId: string,
  sourceId: string,
  chains: readonly LfoChain[],
): boolean {
  if (sourceId === chainId) return true; // self-ref
  let current: string | null = sourceId;
  const visited = new Set<string>([chainId]);
  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
    const next: LfoChain | undefined = chains.find((c) => c.id === current);
    if (!next) return false; // reached LFO id eller dangling — no cycle
    current = next.sourceId;
  }
  return false;
}

/**
 * Lägg till en LfoChain. sourceId måste peka på existing LFO eller chain
 * och får inte skapa cycle. Defaults: trigger='full', shape='sine',
 * amount=1, mode='bipolar'.
 *
 * Returnerar oförändrad state vid invalid source eller cycle.
 */
export function addChain(
  state: MixerState,
  sourceId: string,
  options: {
    trigger?: ChainTrigger;
    shape?: WaveShape;
    amount?: number;
    volume?: number;
    mode?: WaveMode;
  } = {},
): MixerState {
  // Validate source exists (LFO eller chain)
  const sourceExists =
    state.lfos.some((l) => l.id === sourceId) ||
    state.chains.some((c) => c.id === sourceId);
  if (!sourceExists) return state;

  const newId = nextId('chain');
  if (wouldCreateCycle(newId, sourceId, state.chains)) return state;

  const chain: LfoChain = {
    id: newId,
    sourceId,
    // Default 'alternate' — primary use-case är tid-delad alternation
    // ("ena vågen klar, nästa startar"). User kan välja sync för layered
    // modulation eller offset för matematisk invers.
    trigger: options.trigger ?? 'alternate',
    shape: options.shape ?? 'sine',
    amount: options.amount ?? 1,
    volume: options.volume ?? 0.5,
    mode: options.mode ?? 'bipolar',
  };
  return { ...state, chains: [...state.chains, chain] };
}

/**
 * Remove chain + transitiv cascade-delete: alla chains som har denna chain
 * som source (direkt eller indirekt) tas också bort, samt cables till
 * alla borttagna chains. Knob.modCableId clears för knobs som pekade på
 * borttagna cables.
 */
export function removeChain(state: MixerState, chainId: string): MixerState {
  const toRemove = findTransitiveDescendants(chainId, state.chains);

  const cablesToRemove = new Set(
    state.cables.filter((c) => toRemove.has(c.sourceLfoId)).map((c) => c.id),
  );

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
    chains: state.chains.filter((c) => !toRemove.has(c.id)),
    cables: state.cables.filter((c) => !cablesToRemove.has(c.id)),
    channels,
  };
}

/**
 * Sätt source för existing chain. Validerar att ny source existerar och
 * att bytet inte skapar cycle. Returnerar oförändrad state vid ogiltigt val.
 */
export function setChainSource(
  state: MixerState,
  chainId: string,
  newSourceId: string,
): MixerState {
  const sourceExists =
    state.lfos.some((l) => l.id === newSourceId) ||
    state.chains.some((c) => c.id === newSourceId);
  if (!sourceExists) return state;
  if (wouldCreateCycle(chainId, newSourceId, state.chains)) return state;
  return {
    ...state,
    chains: state.chains.map((c) =>
      c.id !== chainId ? c : { ...c, sourceId: newSourceId },
    ),
  };
}

export function setChainTrigger(
  state: MixerState,
  chainId: string,
  trigger: ChainTrigger,
): MixerState {
  return {
    ...state,
    chains: state.chains.map((c) => (c.id !== chainId ? c : { ...c, trigger })),
  };
}

export function setChainShape(
  state: MixerState,
  chainId: string,
  shape: WaveShape,
): MixerState {
  return {
    ...state,
    chains: state.chains.map((c) => (c.id !== chainId ? c : { ...c, shape })),
  };
}

export function setChainAmount(
  state: MixerState,
  chainId: string,
  amount: number,
): MixerState {
  return {
    ...state,
    chains: state.chains.map((c) =>
      c.id !== chainId ? c : { ...c, amount: Math.max(0, Math.min(1, amount)) },
    ),
  };
}

/** Sätt chain bias-position (0..1). Samma semantik som setLfoVolume. */
export function setChainVolume(
  state: MixerState,
  chainId: string,
  volume: number,
): MixerState {
  return {
    ...state,
    chains: state.chains.map((c) =>
      c.id !== chainId ? c : { ...c, volume: Math.max(0, Math.min(1, volume)) },
    ),
  };
}

export function setChainMode(
  state: MixerState,
  chainId: string,
  mode: WaveMode,
): MixerState {
  return {
    ...state,
    chains: state.chains.map((c) => (c.id !== chainId ? c : { ...c, mode })),
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
  // Validate refs — source kan vara LFO eller LfoChain
  const sourceExists =
    state.lfos.some((l) => l.id === sourceLfoId) ||
    state.chains.some((c) => c.id === sourceLfoId);
  if (!sourceExists) return state;
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
  const chainIds = new Set(state.chains.map((c) => c.id));
  const modulatorIds = new Set([...lfoIds, ...chainIds]);
  const channelIds = new Set(state.channels.map((ch) => ch.id));

  // Cable source-refs — accepterar både LFO och chain
  for (const cable of state.cables) {
    if (!modulatorIds.has(cable.sourceLfoId)) {
      issues.push(`cable ${cable.id} pekar på obefintlig modulator ${cable.sourceLfoId}`);
    }
    if (!channelIds.has(cable.destChannelId)) {
      issues.push(`cable ${cable.id} pekar på obefintlig channel ${cable.destChannelId}`);
    }
  }

  // Chain source-refs — måste peka på LFO eller annan chain
  for (const chain of state.chains) {
    if (!modulatorIds.has(chain.sourceId)) {
      issues.push(`chain ${chain.id} pekar på obefintlig source ${chain.sourceId}`);
    }
  }

  // Chain cycle detection — walk source-grafen från varje chain
  for (const chain of state.chains) {
    const visited = new Set<string>();
    let current: string | null = chain.id;
    while (current) {
      if (visited.has(current)) {
        issues.push(`chain ${chain.id} ingår i en cycle (via ${current})`);
        break;
      }
      visited.add(current);
      const next: LfoChain | undefined = state.chains.find((c) => c.id === current);
      if (!next) break; // reached LFO eller dangling
      current = next.sourceId;
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

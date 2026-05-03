/**
 * LfoChain compute + state-mutator-tester.
 *
 * Verifierar:
 * - effectiveRate rekursiv (LFO → chain → chain)
 * - computeChainSignal: trigger='full' & 'half' phase-reset
 * - lookupModulator hittar både LFOs och chains
 * - addChain: cycle-detection + dangling source-rejection
 * - removeChain + removeLfo: transitiv cascade-delete med cables
 */
import { test, expect, beforeEach } from 'bun:test';
import {
  computeChainSignal,
  computeModulatorSignal,
  effectiveRate,
  lookupModulator,
} from '../../src/synth/lfo';
import {
  addCable,
  addChain,
  addChannel,
  addLfo,
  emptyState,
  removeChain,
  removeLfo,
  setChainSource,
  setLfoRate,
  validateInvariants,
  _resetIdsForTesting,
} from '../../src/synth/state';
import type { LfoChain } from '../../src/synth/types';
import { ElectrodeMask } from '../../src/patterns/types';

beforeEach(() => {
  _resetIdsForTesting();
});

// ── lookupModulator ─────────────────────────────────────────────────

test('lookupModulator hittar LFO via id', () => {
  let s = addLfo(emptyState());
  const id = s.lfos[0]!.id;
  const found = lookupModulator(id, s.lfos, s.chains);
  expect(found?.id).toBe(id);
});

test('lookupModulator hittar chain via id', () => {
  let s = addLfo(emptyState());
  s = addChain(s, s.lfos[0]!.id);
  const chainId = s.chains[0]!.id;
  const found = lookupModulator(chainId, s.lfos, s.chains);
  expect(found?.id).toBe(chainId);
});

test('lookupModulator returnerar undefined för okänd id', () => {
  const s = emptyState();
  expect(lookupModulator('lfo-999', s.lfos, s.chains)).toBeUndefined();
});

// ── effectiveRate ───────────────────────────────────────────────────

test('effectiveRate för LFO returnerar lfo.rate', () => {
  const s = setLfoRate(addLfo(emptyState()), 'lfo-1', 5);
  const lfo = s.lfos[0]!;
  expect(effectiveRate(lfo, s.lfos, s.chains)).toBe(5);
});

test('effectiveRate för chain (trigger=full) = source rate', () => {
  let s = addLfo(emptyState()); // 1Hz default
  s = setLfoRate(s, 'lfo-1', 2);
  s = addChain(s, 'lfo-1', { trigger: 'full' });
  const chain = s.chains[0]!;
  expect(effectiveRate(chain, s.lfos, s.chains)).toBe(2);
});

test('effectiveRate för chain (trigger=half) = source rate × 2', () => {
  let s = setLfoRate(addLfo(emptyState()), 'lfo-1', 2);
  s = addChain(s, 'lfo-1', { trigger: 'half' });
  const chain = s.chains[0]!;
  expect(effectiveRate(chain, s.lfos, s.chains)).toBe(4);
});

test('effectiveRate för nested chains: rates multipliceras', () => {
  let s = setLfoRate(addLfo(emptyState()), 'lfo-1', 1); // 1Hz
  s = addChain(s, 'lfo-1', { trigger: 'half' }); // chain-2: 2Hz
  s = addChain(s, 'chain-2', { trigger: 'half' }); // chain-3: 4Hz
  s = addChain(s, 'chain-3', { trigger: 'full' }); // chain-4: 4Hz (full inherits)
  expect(effectiveRate(s.chains[0]!, s.lfos, s.chains)).toBe(2);
  expect(effectiveRate(s.chains[1]!, s.lfos, s.chains)).toBe(4);
  expect(effectiveRate(s.chains[2]!, s.lfos, s.chains)).toBe(4);
});

test('effectiveRate returnerar 0 vid dangling source', () => {
  // Konstruera invalid chain manuellt (utan addChain-validering)
  const dangling: LfoChain = {
    id: 'chain-99',
    sourceId: 'lfo-nonexistent',
    trigger: 'full',
    shape: 'sine',
    amount: 1,
    mode: 'bipolar',
  };
  expect(effectiveRate(dangling, [], [dangling])).toBe(0);
});

// ── computeChainSignal ──────────────────────────────────────────────

test('computeChainSignal: trigger=full vid t=0 → phase=0 → sine=0', () => {
  let s = addLfo(emptyState()); // 1Hz
  s = addChain(s, 'lfo-1', { trigger: 'full', shape: 'sine' });
  const chain = s.chains[0]!;
  expect(computeChainSignal(chain, 0, s.lfos, s.chains)).toBeCloseTo(0, 6);
});

test('computeChainSignal: trigger=full @ source=1Hz, t=250ms → phase=π/2 → sine=+1', () => {
  let s = addLfo(emptyState()); // 1Hz LFO → trigger interval = 1s = 1_000_000µs
  s = addChain(s, 'lfo-1', { trigger: 'full', shape: 'sine' });
  const chain = s.chains[0]!;
  // t=250_000µs (kvart-cykel) → phase = 0.25 × 2π = π/2 → sin = +1
  expect(computeChainSignal(chain, 250_000, s.lfos, s.chains)).toBeCloseTo(1, 6);
});

test('computeChainSignal: trigger=half resets phase vid halv-cykel', () => {
  let s = addLfo(emptyState()); // 1Hz, trigger interval = 0.5s med half
  s = addChain(s, 'lfo-1', { trigger: 'half', shape: 'sine' });
  const chain = s.chains[0]!;
  // Vid t=0: phase=0 → sine=0
  expect(computeChainSignal(chain, 0, s.lfos, s.chains)).toBeCloseTo(0, 6);
  // Vid t=125ms (kvart av 0.5s) → phase=π/2 → sine=+1
  expect(computeChainSignal(chain, 125_000, s.lfos, s.chains)).toBeCloseTo(1, 6);
  // Vid t=500_000µs (= ny trigger boundary) → phase=0 igen → sine=0
  expect(computeChainSignal(chain, 500_000, s.lfos, s.chains)).toBeCloseTo(0, 6);
  // Vid t=625ms = 500ms + 125ms = phase π/2 igen → sine=+1
  expect(computeChainSignal(chain, 625_000, s.lfos, s.chains)).toBeCloseTo(1, 6);
});

test('computeChainSignal: amount skalar output', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'full', shape: 'sine', amount: 0.5 });
  const chain = s.chains[0]!;
  expect(computeChainSignal(chain, 250_000, s.lfos, s.chains)).toBeCloseTo(0.5, 6);
});

test('computeChainSignal: nested chain ärver tempo', () => {
  let s = addLfo(emptyState()); // 1Hz
  s = addChain(s, 'lfo-1', { trigger: 'half', shape: 'sine' }); // chain-2: 2Hz
  s = addChain(s, 'chain-2', { trigger: 'half', shape: 'sine' }); // chain-3: 4Hz, period 250ms
  const chain3 = s.chains[1]!;
  // chain-3 har period 250ms = 250_000µs. Kvart period = 62.5ms = 62_500µs
  expect(computeChainSignal(chain3, 62_500, s.lfos, s.chains)).toBeCloseTo(1, 6);
});

test('computeChainSignal: dangling source → 0', () => {
  const dangling: LfoChain = {
    id: 'chain-99',
    sourceId: 'lfo-nonexistent',
    trigger: 'full',
    shape: 'sine',
    amount: 1,
    mode: 'bipolar',
  };
  expect(computeChainSignal(dangling, 250_000, [], [dangling])).toBe(0);
});

test('computeChainSignal: source rate=0 → 0 (no oscillation)', () => {
  let s = addLfo(emptyState());
  // Explicitly mutera till rate=0 (skip validate-clamp för testing)
  s = { ...s, lfos: s.lfos.map((l) => ({ ...l, rate: 0 })) };
  s = addChain(s, 'lfo-1', { trigger: 'full', shape: 'sine' });
  const chain = s.chains[0]!;
  expect(computeChainSignal(chain, 250_000, s.lfos, s.chains)).toBe(0);
});

// ── computeModulatorSignal dispatcher ───────────────────────────────

test('computeModulatorSignal: dispatchar LFO till computeLfoSignal', () => {
  const s = addLfo(emptyState());
  const lfo = s.lfos[0]!;
  // sine 1Hz @ t=250ms → +1
  expect(computeModulatorSignal(lfo, 250_000, s.lfos, s.chains)).toBeCloseTo(1, 6);
});

test('computeModulatorSignal: dispatchar chain till computeChainSignal', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'full', shape: 'sine' });
  const chain = s.chains[0]!;
  expect(computeModulatorSignal(chain, 250_000, s.lfos, s.chains)).toBeCloseTo(1, 6);
});

// ── addChain validation ─────────────────────────────────────────────

test('addChain: dangling source → no-op (oförändrad state)', () => {
  const before = addLfo(emptyState());
  const after = addChain(before, 'lfo-nonexistent');
  expect(after.chains.length).toBe(0);
});

test('addChain: cycle-detection — kan inte hänga chain på sig själv post hoc', () => {
  // addChain skapar nytt id, så self-ref kan inte hända direkt.
  // Men setChainSource kan skapa cycle om vi sätter sourceId till chain self.
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1');
  const chainId = s.chains[0]!.id;
  // Försök sätta source till self → ska no-op
  const after = setChainSource(s, chainId, chainId);
  expect(after).toBe(s); // returnerar samma state via wouldCreateCycle-block
});

test('setChainSource: 2-step cycle detected (chain1.src=chain2, chain2.src=chain1)', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1'); // chain-2, source=lfo-1
  s = addChain(s, 'chain-2'); // chain-3, source=chain-2
  // Försök sätta chain-2.src = chain-3 → skulle skapa cycle: chain-2→chain-3→chain-2
  const after = setChainSource(s, 'chain-2', 'chain-3');
  expect(after).toBe(s);
});

// ── Cascade-delete ──────────────────────────────────────────────────

test('removeChain: tar bort chain + dependent chains transitivt', () => {
  let s = addLfo(emptyState()); // lfo-1
  s = addChain(s, 'lfo-1'); // chain-2
  s = addChain(s, 'chain-2'); // chain-3
  s = addChain(s, 'chain-3'); // chain-4
  // Removing chain-2 ska också ta bort chain-3 + chain-4
  s = removeChain(s, 'chain-2');
  expect(s.chains.map((c) => c.id)).toEqual([]);
});

test('removeChain: tar bort cables till alla descendant chains', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addChain(s, 'lfo-1'); // chain-3
  s = addChain(s, 'chain-3'); // chain-4
  s = addCable(s, 'chain-3', 'ch-2', 'pulseWidth');
  s = addCable(s, 'chain-4', 'ch-2', 'pace');
  expect(s.cables.length).toBe(2);
  s = removeChain(s, 'chain-3');
  expect(s.chains.length).toBe(0);
  expect(s.cables.length).toBe(0); // båda cables borttagna
  // Knob-refs rensade
  expect(s.channels[0]?.knobs.pulseWidth.modCableId).toBeNull();
  expect(s.channels[0]?.knobs.pace.modCableId).toBeNull();
});

test('removeLfo: tar bort hela chain-grenen transitivt', () => {
  let s = addLfo(emptyState()); // lfo-1
  s = addLfo(s); // lfo-2 (oberoende)
  s = addChain(s, 'lfo-1'); // chain-3
  s = addChain(s, 'chain-3'); // chain-4
  s = addChain(s, 'lfo-2'); // chain-5 (annan gren)
  // Remove lfo-1 ska ta bort chain-3 + chain-4 men INTE chain-5
  s = removeLfo(s, 'lfo-1');
  expect(s.lfos.map((l) => l.id)).toEqual(['lfo-2']);
  expect(s.chains.map((c) => c.id)).toEqual(['chain-5']);
});

test('removeLfo + cables: rensar cables till LFO + alla chain-descendants', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addChain(s, 'lfo-1'); // chain-3
  s = addCable(s, 'lfo-1', 'ch-2', 'pulseWidth');
  s = addCable(s, 'chain-3', 'ch-2', 'amplitude');
  expect(s.cables.length).toBe(2);
  s = removeLfo(s, 'lfo-1');
  expect(s.cables.length).toBe(0);
  expect(s.chains.length).toBe(0);
  expect(s.channels[0]?.knobs.pulseWidth.modCableId).toBeNull();
  expect(s.channels[0]?.knobs.amplitude.modCableId).toBeNull();
});

// ── addCable accepterar chain som source ────────────────────────────

test('addCable: chain id är giltig source', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addChain(s, 'lfo-1');
  s = addCable(s, 'chain-3', 'ch-2', 'pulseWidth');
  expect(s.cables.length).toBe(1);
  expect(s.cables[0]?.sourceLfoId).toBe('chain-3');
});

// ── validateInvariants med chains ───────────────────────────────────

test('validateInvariants: empty state ok', () => {
  expect(validateInvariants(emptyState())).toEqual([]);
});

test('validateInvariants: chain → LFO + cable → chain alla giltiga', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addChain(s, 'lfo-1');
  s = addCable(s, 'chain-3', 'ch-2', 'amplitude');
  expect(validateInvariants(s)).toEqual([]);
});

test('validateInvariants: dangling chain.sourceId flaggas', () => {
  // Konstruera invalid state direkt
  const invalid = {
    channels: [],
    lfos: [],
    chains: [{
      id: 'chain-1',
      sourceId: 'lfo-ghost',
      trigger: 'full' as const,
      shape: 'sine' as const,
      amount: 1,
      mode: 'bipolar' as const,
    }],
    cables: [],
  };
  const issues = validateInvariants(invalid);
  expect(issues.some((i) => i.includes('chain-1') && i.includes('source'))).toBe(true);
});

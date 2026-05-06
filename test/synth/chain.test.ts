/**
 * LfoChain compute + state-mutator-tester.
 *
 * Verifierar:
 * - effectiveChainPhase rekursiv (LFO → chain → chain) inkl. ALT-multiplikation
 * - computeChainSignal: trigger sync/offset/alternate semantik
 * - lookupModulator hittar både LFOs och chains
 * - addChain: cycle-detection + dangling source-rejection
 * - removeChain + removeLfo: transitiv cascade-delete med cables
 */
import { test, expect, beforeEach } from 'bun:test';
import {
  computeChainSignal,
  computeModulatorSignal,
  effectiveChainPhase,
  effectiveLfoPhase,
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

// ── effectiveChainPhase: phase-trajektoria via källan ──────────────

test('effectiveChainPhase SYNC = källans phase (samma trajectory)', () => {
  let s = addLfo(emptyState()); // 1Hz default, master=1
  s = addChain(s, 'lfo-1', { trigger: 'sync' });
  const chain = s.chains[0]!;
  // Vid t=250ms, källan har phase=π/2. SYNC chain ska ge samma.
  const sourcePhase = effectiveLfoPhase(s.lfos[0]!, 250_000, 1);
  const chainPhase = effectiveChainPhase(chain, 250_000, 1, s.lfos, s.chains);
  expect(chainPhase).toBeCloseTo(sourcePhase, 6);
  expect(chainPhase).toBeCloseTo(Math.PI / 2, 6);
});

test('effectiveChainPhase OFFSET = källans phase + π (mod 2π)', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'offset' });
  const chain = s.chains[0]!;
  // Vid t=250ms, källans phase=π/2. OFFSET chain phase = π/2 + π = 3π/2.
  expect(effectiveChainPhase(chain, 250_000, 1, s.lfos, s.chains)).toBeCloseTo(
    3 * Math.PI / 2,
    6,
  );
});

test('effectiveChainPhase ALT = 2 × källans phase (mod 2π)', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'alternate' });
  const chain = s.chains[0]!;
  // Vid t=125ms, källans phase=π/4. ALT chain phase = π/2.
  expect(effectiveChainPhase(chain, 125_000, 1, s.lfos, s.chains)).toBeCloseTo(
    Math.PI / 2,
    6,
  );
});

test('effectiveChainPhase nested: ALT-link multiplicerar phase 2× ner i kedjan', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'alternate' }); // chain-2: 2× phase
  s = addChain(s, 'chain-2', { trigger: 'alternate' }); // chain-3: 4× phase
  s = addChain(s, 'chain-3', { trigger: 'sync' }); // chain-4: SYNC ärver chain-3 (4×)
  // Vid t=62.5ms, lfo-1 phase=π/8. chain-3 phase = 4 × π/8 = π/2. chain-4 = π/2.
  expect(effectiveChainPhase(s.chains[2]!, 62_500, 1, s.lfos, s.chains)).toBeCloseTo(
    Math.PI / 2,
    6,
  );
});

test('effectiveChainPhase: dangling source → 0', () => {
  const dangling: LfoChain = {
    id: 'chain-99',
    sourceId: 'lfo-nonexistent',
    trigger: 'sync',
    shape: 'sine',
    amount: 1,
    volume: 0.5,
    mode: 'bipolar',
  };
  expect(effectiveChainPhase(dangling, 250_000, 1, [], [dangling])).toBe(0);
});

test('effectiveChainPhase: cycle-skydd via visited-set', () => {
  // Konstruera invalid state direkt med cycle (validateInvariants flaggar)
  const invalidChains: LfoChain[] = [
    { id: 'chain-1', sourceId: 'chain-2', trigger: 'sync', shape: 'sine', amount: 1, volume: 0.5, mode: 'bipolar' },
    { id: 'chain-2', sourceId: 'chain-1', trigger: 'sync', shape: 'sine', amount: 1, volume: 0.5, mode: 'bipolar' },
  ];
  // Ska terminera (inte stack-overflow) och returnera 0
  expect(effectiveChainPhase(invalidChains[0]!, 100_000, 1, [], invalidChains)).toBe(0);
});

// ── computeChainSignal: SYNC mode ───────────────────────────────────

test('computeChainSignal SYNC: t=0 → phase=0 → sine=0', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'sync', shape: 'sine' });
  const chain = s.chains[0]!;
  expect(computeChainSignal(chain, 0, s.lfos, s.chains)).toBeCloseTo(0, 6);
});

test('computeChainSignal SYNC @ source=1Hz, t=250ms → phase=π/2 → sine=+1', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'sync', shape: 'sine' });
  const chain = s.chains[0]!;
  expect(computeChainSignal(chain, 250_000, s.lfos, s.chains)).toBeCloseTo(1, 6);
});

test('computeChainSignal SYNC kontinuerligt — spelar även när source är negativ', () => {
  // SYNC har INGEN gate; chain kör hela tiden
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'sync', shape: 'sine' });
  const chain = s.chains[0]!;
  // Vid t=750ms source=-1 men chain SYNC ger sine(3π/2) = -1 (inte 0)
  expect(computeChainSignal(chain, 750_000, s.lfos, s.chains)).toBeCloseTo(-1, 6);
});

// ── computeChainSignal: OFFSET mode ─────────────────────────────────

test('computeChainSignal OFFSET = matematisk invers för sine source+chain', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'offset', shape: 'sine' });
  const chain = s.chains[0]!;
  // Sine source @ 1Hz med chain OFFSET sine → output = -source_signal
  // t=0: source=0, chain phase=π → sine(π)=0 ✓
  expect(computeChainSignal(chain, 0, s.lfos, s.chains)).toBeCloseTo(0, 6);
  // t=250ms: source=+1, chain phase=π/2+π=3π/2 → sine=-1 ✓
  expect(computeChainSignal(chain, 250_000, s.lfos, s.chains)).toBeCloseTo(-1, 6);
  // t=500ms: source=0, chain phase=π+π=2π=0 → sine=0
  expect(computeChainSignal(chain, 500_000, s.lfos, s.chains)).toBeCloseTo(0, 6);
  // t=750ms: source=-1, chain phase=3π/2+π=5π/2≡π/2 → sine=+1 (invers av source)
  expect(computeChainSignal(chain, 750_000, s.lfos, s.chains)).toBeCloseTo(1, 6);
});

// ── computeChainSignal: ALTERNATE mode ──────────────────────────────

test('computeChainSignal ALT: gated av source-sign — silent när source ≥ 0', () => {
  // Sine source @ 1Hz är positiv 0..500ms, negativ 500..1000ms
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'alternate', shape: 'square' });
  const chain = s.chains[0]!;
  // t=0: source=0 (≥0) → gate OFF → 0
  expect(computeChainSignal(chain, 0, s.lfos, s.chains)).toBe(0);
  // t=125ms: source=+0.707 → gate OFF → 0
  expect(computeChainSignal(chain, 125_000, s.lfos, s.chains)).toBe(0);
  // t=250ms: source=+1 → gate OFF → 0
  expect(computeChainSignal(chain, 250_000, s.lfos, s.chains)).toBe(0);
  // t=499ms: source≈+0.006 (>0) → gate OFF → 0
  expect(computeChainSignal(chain, 499_000, s.lfos, s.chains)).toBe(0);
});

test('computeChainSignal ALT: spelar med 2× rate under source-negativa halvan', () => {
  // Sine source 1Hz, chain ALT shape=square. Under t=500..1000ms (source<0):
  // halfPeriod=500ms → tInHalf = (t mod 500ms). Square +1 vid phase 0..π,
  // -1 vid π..2π. tInHalf < 250ms = phase < π = +1; ≥ 250ms = -1.
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'alternate', shape: 'square' });
  const chain = s.chains[0]!;
  // t=625ms: source=sin(5π/4)=-0.707 → gate ON.
  // tInHalf = 625000 mod 500000 = 125000. phase = 125000/500000 × 2π = π/2.
  // square(π/2) = +1
  expect(computeChainSignal(chain, 625_000, s.lfos, s.chains)).toBe(1);
  // t=875ms: source=sin(7π/4)=-0.707 → gate ON.
  // tInHalf = 375000. phase = 3π/2. square(3π/2) = -1
  expect(computeChainSignal(chain, 875_000, s.lfos, s.chains)).toBe(-1);
});

test('computeChainSignal ALT: alternation med saw-up source (negativ första halvan)', () => {
  // Saw-up source: signal < 0 under första halvan av cykeln (0..500ms vid 1Hz)
  let s = addLfo(emptyState());
  s = { ...s, lfos: s.lfos.map((l) => ({ ...l, shape: 'saw' as const })) };
  s = addChain(s, 'lfo-1', { trigger: 'alternate', shape: 'square' });
  const chain = s.chains[0]!;
  // t=125ms: source=saw(2π × 0.125)=saw(π/4) ≈ -0.75 (rising mot 0) → gate ON
  // tInHalf=125000. phase=π/2. square=+1
  expect(computeChainSignal(chain, 125_000, s.lfos, s.chains)).toBe(1);
  // t=750ms: source=saw(3π/2)=+0.5 → gate OFF → 0
  expect(computeChainSignal(chain, 750_000, s.lfos, s.chains)).toBe(0);
});

test('computeChainSignal ALT: amount skalar output', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'alternate', shape: 'square', amount: 0.5 });
  const chain = s.chains[0]!;
  // Under gate-on med square +1, amount=0.5 → 0.5
  expect(computeChainSignal(chain, 625_000, s.lfos, s.chains)).toBe(0.5);
});

test('computeChainSignal SYNC: amount skalar output', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'sync', shape: 'sine', amount: 0.5 });
  const chain = s.chains[0]!;
  expect(computeChainSignal(chain, 250_000, s.lfos, s.chains)).toBeCloseTo(0.5, 6);
});

test('computeChainSignal SYNC: nested chain ärver tempo (ALT-link i kedjan dubblar)', () => {
  let s = addLfo(emptyState()); // 1Hz
  s = addChain(s, 'lfo-1', { trigger: 'alternate', shape: 'sine' }); // chain-2: 2Hz
  s = addChain(s, 'chain-2', { trigger: 'sync', shape: 'square' }); // chain-3: SYNC ärver 2Hz från chain-2
  const chain3 = s.chains[1]!;
  // chain-3 SYNC har period från chain-2:s effective rate (2Hz) = 500ms
  // Vid t=125ms: tInPeriod = 125000. phase = 125000/500000 × 2π = π/2. square=+1
  expect(computeChainSignal(chain3, 125_000, s.lfos, s.chains)).toBe(1);
});

test('computeChainSignal: dangling source → 0', () => {
  const dangling: LfoChain = {
    id: 'chain-99',
    sourceId: 'lfo-nonexistent',
    trigger: 'sync',
    shape: 'sine',
    amount: 1,
    volume: 0.5,
    mode: 'bipolar',
  };
  expect(computeChainSignal(dangling, 250_000, [], [dangling])).toBe(0);
});

test('computeChainSignal: source rate=0 → 0 (no oscillation)', () => {
  let s = addLfo(emptyState());
  s = { ...s, lfos: s.lfos.map((l) => ({ ...l, rate: 0 })) };
  s = addChain(s, 'lfo-1', { trigger: 'sync', shape: 'sine' });
  const chain = s.chains[0]!;
  expect(computeChainSignal(chain, 250_000, s.lfos, s.chains)).toBe(0);
});

// ── computeModulatorSignal dispatcher ───────────────────────────────

test('computeModulatorSignal: dispatchar LFO till computeLfoSignal', () => {
  const s = addLfo(emptyState());
  const lfo = s.lfos[0]!;
  expect(computeModulatorSignal(lfo, 250_000, s.lfos, s.chains)).toBeCloseTo(1, 6);
});

test('computeModulatorSignal: dispatchar chain till computeChainSignal', () => {
  let s = addLfo(emptyState());
  s = addChain(s, 'lfo-1', { trigger: 'sync', shape: 'sine' });
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
      trigger: 'sync' as const,
      shape: 'sine' as const,
      amount: 1,
      volume: 0.5,
      mode: 'bipolar' as const,
    }],
    cables: [],
    masterRate: 1,
  };
  const issues = validateInvariants(invalid);
  expect(issues.some((i) => i.includes('chain-1') && i.includes('source'))).toBe(true);
});

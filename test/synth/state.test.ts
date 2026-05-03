import { test, expect, beforeEach } from 'bun:test';
import {
  emptyState,
  addChannel,
  removeChannel,
  setChannelElcon,
  updateKnobBase,
  setChannelEnabled,
  addLfo,
  removeLfo,
  setLfoRate,
  setLfoAmount,
  setLfoShape,
  setLfoMode,
  addCable,
  removeCable,
  setCableDepth,
  validateInvariants,
  _resetIdsForTesting,
} from '../../src/synth/state';
import { ElectrodeMask } from '../../src/patterns/types';
import { PatternValidationError } from '../../src/patterns/validate';

beforeEach(() => {
  _resetIdsForTesting();
});

test('emptyState: tom state är gilltigt', () => {
  const s = emptyState();
  expect(s.channels).toEqual([]);
  expect(s.lfos).toEqual([]);
  expect(s.cables).toEqual([]);
  expect(validateInvariants(s)).toEqual([]);
});

test('addChannel: skapar channel med default knob-värden', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  expect(s.channels.length).toBe(1);
  expect(s.channels[0]?.elcon).toEqual([1, 2]);
  expect(s.channels[0]?.knobs.pulseWidth.base).toBe(144);
  expect(s.channels[0]?.knobs.pace.base).toBe(25_000);
  expect(s.channels[0]?.knobs.amplitude.base).toBe(128);
  expect(s.channels[0]?.enabled).toBe(true);
  expect(validateInvariants(s)).toEqual([]);
});

// (lastPhase + nextEmitMicros är nu SynthEngine-internal — testas i synth-engine.test.ts)

test('addChannel: multipla channels', () => {
  let s = emptyState();
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addChannel(s, [ElectrodeMask.AC, ElectrodeMask.BD]);
  expect(s.channels.length).toBe(2);
  expect(s.channels[0]?.id).not.toBe(s.channels[1]?.id);
});

test('removeChannel: tar bort channel', () => {
  let s = addChannel(emptyState(), [ElectrodeMask.A, ElectrodeMask.B]);
  const id = s.channels[0]!.id;
  s = removeChannel(s, id);
  expect(s.channels).toEqual([]);
});

test('addChannel: throws PatternValidationError vid hardware-invalid elcon', () => {
  const s = emptyState();
  // [A, C] = båda i {A,C}-buddy-paret = invalid
  expect(() => addChannel(s, [ElectrodeMask.A, ElectrodeMask.C])).toThrow(PatternValidationError);
  // [B, D] = båda i {B,D}-buddy-paret = invalid
  expect(() => addChannel(s, [ElectrodeMask.B, ElectrodeMask.D])).toThrow(PatternValidationError);
});

test('setChannelElcon: uppdaterar elcon på existerande channel', () => {
  let s = addChannel(emptyState(), [ElectrodeMask.A, ElectrodeMask.B]);
  const id = s.channels[0]!.id;
  s = setChannelElcon(s, id, [ElectrodeMask.AC, ElectrodeMask.BD]);
  expect(s.channels[0]?.elcon).toEqual([ElectrodeMask.AC, ElectrodeMask.BD]);
});

test('setChannelElcon: bevarar knob-state när elcon ändras', () => {
  let s = addChannel(emptyState(), [ElectrodeMask.A, ElectrodeMask.B]);
  const id = s.channels[0]!.id;
  s = updateKnobBase(s, id, 'amplitude', 200);
  s = setChannelElcon(s, id, [ElectrodeMask.AC, ElectrodeMask.BD]);
  expect(s.channels[0]?.knobs.amplitude.base).toBe(200); // bevaras
  expect(s.channels[0]?.elcon).toEqual([ElectrodeMask.AC, ElectrodeMask.BD]); // ändrad
});

test('setChannelElcon: throws vid hardware-invalid elcon', () => {
  let s = addChannel(emptyState(), [ElectrodeMask.A, ElectrodeMask.B]);
  const id = s.channels[0]!.id;
  expect(() => setChannelElcon(s, id, [ElectrodeMask.A, ElectrodeMask.C])).toThrow(PatternValidationError);
  expect(() => setChannelElcon(s, id, [ElectrodeMask.B, ElectrodeMask.D])).toThrow(PatternValidationError);
  // Channel-state oförändrad efter throw
  expect(s.channels[0]?.elcon).toEqual([ElectrodeMask.A, ElectrodeMask.B]);
});

test('updateKnobBase: bara den specifika knob på den specifika channeln ändras', () => {
  let s = addChannel(emptyState(), [ElectrodeMask.A, ElectrodeMask.B]);
  s = addChannel(s, [ElectrodeMask.AC, ElectrodeMask.BD]);
  const id1 = s.channels[0]!.id;

  s = updateKnobBase(s, id1, 'pulseWidth', 100);
  expect(s.channels[0]?.knobs.pulseWidth.base).toBe(100);
  expect(s.channels[0]?.knobs.pace.base).toBe(25_000); // oförändrat
  expect(s.channels[1]?.knobs.pulseWidth.base).toBe(144); // oförändrat
});

test('setChannelEnabled: togglar enabled', () => {
  let s = addChannel(emptyState(), [ElectrodeMask.A, ElectrodeMask.B]);
  const id = s.channels[0]!.id;
  s = setChannelEnabled(s, id, false);
  expect(s.channels[0]?.enabled).toBe(false);
});

test('addLfo: defaults sine, 1Hz, full amount', () => {
  let s = addLfo(emptyState());
  expect(s.lfos.length).toBe(1);
  expect(s.lfos[0]?.shape).toBe('sine');
  expect(s.lfos[0]?.rate).toBe(1);
  expect(s.lfos[0]?.amount).toBe(1);
});

test('addLfo: med custom shape', () => {
  let s = addLfo(emptyState(), 'square');
  expect(s.lfos[0]?.shape).toBe('square');
});

test('setLfoRate / setLfoAmount / setLfoShape', () => {
  let s = addLfo(emptyState());
  const id = s.lfos[0]!.id;
  s = setLfoRate(s, id, 2.5);
  s = setLfoAmount(s, id, 0.5);
  s = setLfoShape(s, id, 'triangle');
  expect(s.lfos[0]?.rate).toBe(2.5);
  expect(s.lfos[0]?.amount).toBe(0.5);
  expect(s.lfos[0]?.shape).toBe('triangle');
});

test('setLfoRate: clamps till LFO_RATE_MIN..MAX (0.01..50 Hz)', () => {
  let s = addLfo(emptyState());
  const id = s.lfos[0]!.id;
  s = setLfoRate(s, id, 999);
  expect(s.lfos[0]?.rate).toBe(50);
  s = setLfoRate(s, id, -5);
  expect(s.lfos[0]?.rate).toBe(0.01);
  s = setLfoRate(s, id, NaN);
  expect(s.lfos[0]?.rate).toBe(0.01);
  s = setLfoRate(s, id, Infinity);
  expect(s.lfos[0]?.rate).toBe(0.01); // !isFinite → fallback till min
});

test('setLfoRate: utan simNow → bara rate-update, phase oförändrat (test/legacy path)', () => {
  let s = addLfo(emptyState());
  const id = s.lfos[0]!.id;
  s = { ...s, lfos: s.lfos.map((l) => ({ ...l, phase: Math.PI / 4, phaseAnchorMicros: 100 })) };
  s = setLfoRate(s, id, 5);
  expect(s.lfos[0]?.rate).toBe(5);
  expect(s.lfos[0]?.phase).toBeCloseTo(Math.PI / 4, 6);
  expect(s.lfos[0]?.phaseAnchorMicros).toBe(100);
});

test('setLfoRate: med simNow → re-ankrar phase så signal är continuous över rate-bytet', () => {
  // Givet en LFO vid 1Hz som varit aktiv 0.25s (kvart-cykel = π/2)
  let s = addLfo(emptyState());
  const id = s.lfos[0]!.id;
  // simNow = 250_000µs (kvart period vid 1Hz). Phase vid den tiden = 0 + 2π·1·0.25 = π/2.
  s = setLfoRate(s, id, 5, 250_000);
  expect(s.lfos[0]?.rate).toBe(5);
  expect(s.lfos[0]?.phase).toBeCloseTo(Math.PI / 2, 6);
  expect(s.lfos[0]?.phaseAnchorMicros).toBe(250_000);
  // Verifiera continuity: computeLfoSignal vid t=250_000 ska ge sin(π/2)=1
  // (samma som FÖRE rate-byte).
});

test('addLfo: defaultar mode till bipolar', () => {
  const s = addLfo(emptyState());
  expect(s.lfos[0]?.mode).toBe('bipolar');
});

test('setLfoMode: byter mellan bipolar / negative-boost / negative-only', () => {
  let s = addLfo(emptyState());
  const id = s.lfos[0]!.id;
  s = setLfoMode(s, id, 'negative-boost');
  expect(s.lfos[0]?.mode).toBe('negative-boost');
  s = setLfoMode(s, id, 'negative-only');
  expect(s.lfos[0]?.mode).toBe('negative-only');
  s = setLfoMode(s, id, 'bipolar');
  expect(s.lfos[0]?.mode).toBe('bipolar');
});

test('setLfoMode: lämnar andra LFO-fält oförändrade', () => {
  let s = addLfo(emptyState());
  const id = s.lfos[0]!.id;
  s = setLfoRate(s, id, 5);
  s = setLfoAmount(s, id, 0.7);
  s = setLfoShape(s, id, 'saw-down');
  s = setLfoMode(s, id, 'negative-boost');
  expect(s.lfos[0]?.rate).toBe(5);
  expect(s.lfos[0]?.amount).toBe(0.7);
  expect(s.lfos[0]?.shape).toBe('saw-down');
  expect(s.lfos[0]?.mode).toBe('negative-boost');
});

test('setLfoAmount: clamps till [0, 1]', () => {
  let s = addLfo(emptyState());
  const id = s.lfos[0]!.id;
  s = setLfoAmount(s, id, 5);
  expect(s.lfos[0]?.amount).toBe(1);
  s = setLfoAmount(s, id, -0.5);
  expect(s.lfos[0]?.amount).toBe(0);
});

// ── Cable handling + cascade-delete (GAP-G) ───────────────────────

test('addCable: kopplar LFO till channel-knob', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const lfoId = s.lfos[0]!.id;
  const chId = s.channels[0]!.id;
  s = addCable(s, lfoId, chId, 'pulseWidth', 0.5);
  expect(s.cables.length).toBe(1);
  expect(s.cables[0]?.sourceLfoId).toBe(lfoId);
  expect(s.cables[0]?.destChannelId).toBe(chId);
  expect(s.cables[0]?.destKnobName).toBe('pulseWidth');
  expect(s.cables[0]?.depth).toBe(0.5);
  // Knob's modCableId pekar på cable
  expect(s.channels[0]?.knobs.pulseWidth.modCableId).toBe(s.cables[0]?.id);
  expect(validateInvariants(s)).toEqual([]);
});

test('addCable: invalid LFO eller channel ref returnerar oförändrat state', () => {
  const s = emptyState();
  const after = addCable(s, 'nonexistent-lfo', 'nonexistent-ch', 'pulseWidth');
  expect(after).toBe(s); // same reference
});

test('addCable: replace existing cable till samma dest-knob (1.5A)', () => {
  let s = addLfo(emptyState()); // lfo-1
  s = addLfo(s); // lfo-2
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]); // ch-3
  const lfo1Id = s.lfos[0]!.id;
  const lfo2Id = s.lfos[1]!.id;
  const chId = s.channels[0]!.id;

  s = addCable(s, lfo1Id, chId, 'pulseWidth', 0.5);
  const cable1Id = s.cables[0]!.id;

  s = addCable(s, lfo2Id, chId, 'pulseWidth', 0.8); // replace
  expect(s.cables.length).toBe(1);
  expect(s.cables[0]?.sourceLfoId).toBe(lfo2Id);
  expect(s.cables[0]?.depth).toBe(0.8);
  expect(s.cables[0]?.id).not.toBe(cable1Id); // ny cable, ny id
  expect(s.channels[0]?.knobs.pulseWidth.modCableId).toBe(s.cables[0]?.id);
});

test('addCable: olika knob-names på samma channel kan ha separata cables', () => {
  let s = addLfo(emptyState());
  s = addLfo(s);
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const lfo1 = s.lfos[0]!.id;
  const lfo2 = s.lfos[1]!.id;
  const ch = s.channels[0]!.id;

  s = addCable(s, lfo1, ch, 'pulseWidth');
  s = addCable(s, lfo2, ch, 'pace');
  expect(s.cables.length).toBe(2);
  expect(validateInvariants(s)).toEqual([]);
});

test('removeCable: tar bort cable + clears knob.modCableId', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addCable(s, s.lfos[0]!.id, s.channels[0]!.id, 'pulseWidth');
  const cableId = s.cables[0]!.id;
  s = removeCable(s, cableId);
  expect(s.cables).toEqual([]);
  expect(s.channels[0]?.knobs.pulseWidth.modCableId).toBeNull();
  expect(validateInvariants(s)).toEqual([]);
});

test('removeLfo: cascade-deletes cables + clears destination knobs (GAP-G)', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const lfoId = s.lfos[0]!.id;
  const chId = s.channels[0]!.id;
  s = addCable(s, lfoId, chId, 'pulseWidth');
  s = addCable(s, lfoId, chId, 'pace');
  expect(s.cables.length).toBe(2);

  s = removeLfo(s, lfoId);
  expect(s.lfos).toEqual([]);
  expect(s.cables).toEqual([]);
  expect(validateInvariants(s)).toEqual([]);
});

test('removeChannel: cascade-deletes cables (GAP-G)', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  const lfoId = s.lfos[0]!.id;
  const chId = s.channels[0]!.id;
  s = addCable(s, lfoId, chId, 'pulseWidth');
  expect(s.cables.length).toBe(1);

  s = removeChannel(s, chId);
  expect(s.channels).toEqual([]);
  expect(s.cables).toEqual([]); // cascade
  expect(validateInvariants(s)).toEqual([]);
});

test('setCableDepth: clamps till [0, 1]', () => {
  let s = addLfo(emptyState());
  s = addChannel(s, [ElectrodeMask.A, ElectrodeMask.B]);
  s = addCable(s, s.lfos[0]!.id, s.channels[0]!.id, 'pulseWidth', 0.3);
  const cableId = s.cables[0]!.id;
  s = setCableDepth(s, cableId, 5);
  expect(s.cables[0]?.depth).toBe(1);
  s = setCableDepth(s, cableId, -0.5);
  expect(s.cables[0]?.depth).toBe(0);
});

test('validateInvariants: detekterar dangling cable till obefintlig LFO', () => {
  // Constructera invalid state direkt (inte via mutator)
  const invalid = {
    channels: [],
    lfos: [],
    chains: [],
    cables: [{ id: 'c1', sourceLfoId: 'ghost', destChannelId: 'ghost-ch', destKnobName: 'pulseWidth' as const, depth: 0.5 }],
  };
  const issues = validateInvariants(invalid);
  expect(issues.length).toBeGreaterThan(0);
});

test('Immutability: alla mutators returnerar nya objekt', () => {
  const s1 = emptyState();
  const s2 = addLfo(s1);
  expect(s2).not.toBe(s1);
  expect(s2.lfos).not.toBe(s1.lfos);
});

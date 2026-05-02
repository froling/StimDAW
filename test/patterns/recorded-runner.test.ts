/**
 * Tester för generateRecordedDescriptors + recordedDurationMicros.
 *
 * Pure-function-tester (ingen fetch, ingen Svelte). Använder hand-byggda
 * RecordedPulse-arrayer för att verifiera mapping + timing-bevarande.
 */
import { test, expect } from 'bun:test';
import { generateRecordedDescriptors, recordedDurationMicros } from '../../src/patterns/runner';
import type { RecordedPulse } from '../../src/patterns/csv-format';
import { ElectrodeMask } from '../../src/patterns/types';

const CHANNEL_A = [ElectrodeMask.A, ElectrodeMask.B] as const;
const CHANNEL_B = [ElectrodeMask.C, ElectrodeMask.D] as const;
const DEFAULT_OPTIONS = {
  channelAElcon: CHANNEL_A,
  channelBElcon: CHANNEL_B,
};

function makePulse(
  stage: string,
  seqNr: number,
  timestampMicros: number,
  phase: 0 | 1,
  widthMicros: number,
  vprimMv: number,
): RecordedPulse {
  return { stage, seqNr, timestampMicros, phase, widthMicros, vprimMv };
}

// ── Empty input ─────────────────────────────────────────────────────

test('empty pulses → empty descriptor stream', () => {
  const out = Array.from(generateRecordedDescriptors([], DEFAULT_OPTIONS));
  expect(out.length).toBe(0);
});

// ── Stage mapping ───────────────────────────────────────────────────

test('Stage A → channelAElcon ([A, B] default)', () => {
  const pulses = [makePulse('A', 1, 1000, 0, 144, 2400)];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out.length).toBe(1);
  expect(out[0]?.electrodeSet).toEqual([ElectrodeMask.A, ElectrodeMask.B]);
});

test('Stage B → channelBElcon ([C, D] default)', () => {
  const pulses = [makePulse('B', 1, 1000, 0, 144, 2400)];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out.length).toBe(1);
  expect(out[0]?.electrodeSet).toEqual([ElectrodeMask.C, ElectrodeMask.D]);
});

test('Custom channel mapping respekteras', () => {
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('B', 2, 2000, 0, 144, 2400),
  ];
  const out = Array.from(
    generateRecordedDescriptors(pulses, {
      channelAElcon: [ElectrodeMask.AC, ElectrodeMask.BD],
      channelBElcon: [ElectrodeMask.A, ElectrodeMask.D],
    }),
  );
  expect(out[0]?.electrodeSet).toEqual([ElectrodeMask.AC, ElectrodeMask.BD]);
  expect(out[1]?.electrodeSet).toEqual([ElectrodeMask.A, ElectrodeMask.D]);
});

test('Okänd stage skippas (defensive)', () => {
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('A>C', 2, 2000, 0, 144, 2400), // NeoDK polarity-label, ej A/B
    makePulse('B', 3, 3000, 0, 144, 2400),
  ];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out.length).toBe(2);
  expect(out[0]?.electrodeSet).toEqual([ElectrodeMask.A, ElectrodeMask.B]);
  expect(out[1]?.electrodeSet).toEqual([ElectrodeMask.C, ElectrodeMask.D]);
});

// ── Timing normalization ────────────────────────────────────────────

test('startTime normaliseras relativt första pulsens timestamp', () => {
  const pulses = [
    makePulse('A', 1, 26646450, 0, 144, 2400), // origin
    makePulse('A', 2, 26646581, 1, 144, 2400), // +131µs
    makePulse('A', 3, 26681260, 0, 144, 2400), // +34810µs
  ];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out[0]?.startTimeMicros).toBe(0);
  expect(out[1]?.startTimeMicros).toBe(131);
  expect(out[2]?.startTimeMicros).toBe(34810);
});

test('initialStartTimeMicros adderas till alla timestamps (för loop-iterations)', () => {
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('A', 2, 2000, 1, 144, 2400),
  ];
  const out = Array.from(
    generateRecordedDescriptors(pulses, {
      ...DEFAULT_OPTIONS,
      initialStartTimeMicros: 1_000_000,
    }),
  );
  expect(out[0]?.startTimeMicros).toBe(1_000_000);
  expect(out[1]?.startTimeMicros).toBe(1_001_000);
});

// ── Vprim → amp mapping ─────────────────────────────────────────────

test('amplitude = round(Vprim_mV / 40) clampad till u8', () => {
  // 2400 mV / 40 = 60
  // 2440 mV / 40 = 61
  // 10240 mV / 40 = 256 → clamp till 255
  // 0 mV → 0
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('A', 2, 2000, 0, 144, 2440),
    makePulse('A', 3, 3000, 0, 144, 10240),
    makePulse('A', 4, 4000, 0, 144, 0),
  ];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out[0]?.amplitude).toBe(60);
  expect(out[1]?.amplitude).toBe(61);
  expect(out[2]?.amplitude).toBe(255);
  expect(out[3]?.amplitude).toBe(0);
});

// ── Phase preservation ──────────────────────────────────────────────

test('phase bit 0 bevaras från CSV (biphasic)', () => {
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('A', 2, 2000, 1, 144, 2400),
  ];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out[0]?.phase).toBe(0);
  expect(out[1]?.phase).toBe(1);
});

// ── nrOfPulses lock + paceQuarterMs estimering ──────────────────────

test('nrOfPulses=1 för alla descriptors (recorded är per-puls)', () => {
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('A', 2, 2000, 1, 144, 2400),
    makePulse('A', 3, 3000, 0, 144, 2400),
  ];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  for (const d of out) {
    expect(d.nrOfPulses).toBe(1);
  }
});

test('paceQuarterMs estimeras från gap till nästa puls i samma stage', () => {
  // Gap A→A = 35000µs = 140 ¼ms (clamp till 255)
  const pulses = [
    makePulse('A', 1, 0, 0, 144, 2400),
    makePulse('A', 2, 35_000, 1, 144, 2400),
  ];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out[0]?.paceQuarterMs).toBe(140);
  // Sista pulsen i sin stage → default 100 (25ms)
  expect(out[1]?.paceQuarterMs).toBe(100);
});

// ── SeqNr ──────────────────────────────────────────────────────────

test('seqNr börjar på initialSequenceNumber och inkrementerar', () => {
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('A', 2, 2000, 1, 144, 2400),
    makePulse('A', 3, 3000, 0, 144, 2400),
  ];
  const out = Array.from(
    generateRecordedDescriptors(pulses, {
      ...DEFAULT_OPTIONS,
      initialSequenceNumber: 50,
    }),
  );
  expect(out[0]?.sequenceNumber).toBe(50);
  expect(out[1]?.sequenceNumber).toBe(51);
  expect(out[2]?.sequenceNumber).toBe(52);
});

test('seqNr wrappar vid 256', () => {
  // 5 pulser, börja på 254 → 254, 255, 0, 1, 2
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('A', 2, 2000, 0, 144, 2400),
    makePulse('A', 3, 3000, 0, 144, 2400),
    makePulse('A', 4, 4000, 0, 144, 2400),
    makePulse('A', 5, 5000, 0, 144, 2400),
  ];
  const out = Array.from(
    generateRecordedDescriptors(pulses, {
      ...DEFAULT_OPTIONS,
      initialSequenceNumber: 254,
    }),
  );
  expect(out.map((d) => d.sequenceNumber)).toEqual([254, 255, 0, 1, 2]);
});

// ── Width clamping ──────────────────────────────────────────────────

test('width clampas till 1..255 (defensive vs malformed CSV)', () => {
  const pulses = [
    makePulse('A', 1, 1000, 0, 0, 2400), // 0 → clamp till 1
    makePulse('A', 2, 2000, 0, 144, 2400), // normal
    makePulse('A', 3, 3000, 0, 500, 2400), // 500 → clamp till 255
  ];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out[0]?.pulseWidthMicros).toBe(1);
  expect(out[1]?.pulseWidthMicros).toBe(144);
  expect(out[2]?.pulseWidthMicros).toBe(255);
});

// ── recordedDurationMicros ──────────────────────────────────────────

test('recordedDurationMicros = last - first timestamp', () => {
  const pulses = [
    makePulse('A', 1, 1000, 0, 144, 2400),
    makePulse('B', 2, 1500, 0, 144, 2400),
    makePulse('A', 3, 2500, 1, 144, 2400),
  ];
  expect(recordedDurationMicros(pulses)).toBe(1500);
});

test('recordedDurationMicros på empty → 0', () => {
  expect(recordedDurationMicros([])).toBe(0);
});

// ── End-to-end mini-recording ───────────────────────────────────────

test('Mini ET-312-style recording: A/B interleave med Vprim-modulation', () => {
  // Mimicar struktur från patterns312/Toggle.csv:
  // A-pulser med biphasic-pair (phase 0+1) och varierande Vprim
  const pulses = [
    makePulse('A', 1533, 26646450, 0, 144, 2808),
    makePulse('A', 1534, 26646581, 1, 145, 2522),
    makePulse('A', 1535, 26681260, 0, 143, 2801),
    makePulse('B', 817, 26917367, 0, 145, 2337),
    makePulse('B', 818, 26917502, 1, 143, 1757),
  ];
  const out = Array.from(generateRecordedDescriptors(pulses, DEFAULT_OPTIONS));
  expect(out.length).toBe(5);
  // Alla A-pulser → channelAElcon
  expect(out[0]?.electrodeSet).toEqual([ElectrodeMask.A, ElectrodeMask.B]);
  expect(out[1]?.electrodeSet).toEqual([ElectrodeMask.A, ElectrodeMask.B]);
  expect(out[2]?.electrodeSet).toEqual([ElectrodeMask.A, ElectrodeMask.B]);
  // B-pulser → channelBElcon
  expect(out[3]?.electrodeSet).toEqual([ElectrodeMask.C, ElectrodeMask.D]);
  expect(out[4]?.electrodeSet).toEqual([ElectrodeMask.C, ElectrodeMask.D]);
  // Phase bevarad
  expect(out.map((d) => d.phase)).toEqual([0, 1, 0, 0, 1]);
  // Vprim-modulation bevarad i amplitude (Vprim/40)
  expect(out[0]?.amplitude).toBe(70); // 2808/40 = 70.2 → 70
  expect(out[1]?.amplitude).toBe(63); // 2522/40 = 63.05 → 63
  expect(out[3]?.amplitude).toBe(58); // 2337/40 = 58.4 → 58
  expect(out[4]?.amplitude).toBe(44); // 1757/40 = 43.9 → 44
  // Stream-time normaliserat: första puls vid 0
  expect(out[0]?.startTimeMicros).toBe(0);
  expect(out[1]?.startTimeMicros).toBe(131); // 26646581 - 26646450
});

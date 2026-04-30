import { test, expect } from 'bun:test';
import {
  countPatternDescriptors,
  generatePatternDescriptors,
  patternDurationMicros,
} from '../../src/patterns/runner';
import { Jackhammer, Toggle } from '../../src/patterns/builtins';

test('Jackhammer 1 rep → 6 descriptors (1 rep × 3 steps × 2 elcons)', () => {
  const descs = Array.from(generatePatternDescriptors(Jackhammer, { maxReps: 1 }));
  expect(descs.length).toBe(6);
});

test('Toggle 1 rep → 30 descriptors (1 rep × 5 steps × 6 elcons)', () => {
  const descs = Array.from(generatePatternDescriptors(Toggle, { maxReps: 1 }));
  expect(descs.length).toBe(30);
});

test('Jackhammer descriptors alternerar polarity för biphasic', () => {
  const descs = Array.from(generatePatternDescriptors(Jackhammer, { maxReps: 1 }));
  for (let i = 0; i < descs.length; i++) {
    expect(descs[i]!.phase & 0x01).toBe(i % 2);
  }
});

test('Toggle första elcons electrode_set matchar pattern-def', () => {
  const descs = Array.from(generatePatternDescriptors(Toggle, { maxReps: 1 }));
  // Toggle.elcons[0] = [A=1, B=2]
  expect(descs[0]!.electrodeSet).toEqual([1, 2]);
  // Toggle.elcons[2] = [C=4, D=8]
  expect(descs[2]!.electrodeSet).toEqual([4, 8]);
});

test('amp ramp: stigande över steps inom en rep', () => {
  const descs = Array.from(generatePatternDescriptors(Toggle, { maxReps: 1 }));
  // 5 steps × 6 elcons = 30 descriptors. Step 1 = first 6, step 2 = next 6, ...
  const step1Amp = descs[0]!.amplitude;
  const step5Amp = descs[24]!.amplitude;
  expect(step1Amp).toBeLessThan(step5Amp);
  expect(step5Amp).toBe(255); // step 5/5 = 100% → 255
  // Step 1 = 1/5 = 20% → ~51
  expect(step1Amp).toBeGreaterThan(40);
  expect(step1Amp).toBeLessThan(60);
});

test('amp aldrig 0 i ramp (0 = "keep previous", inte silence)', () => {
  for (const desc of generatePatternDescriptors(Toggle, { maxReps: 1 })) {
    expect(desc.amplitude).toBeGreaterThan(0);
  }
});

test('sequence number wraps at 256', () => {
  // Jackhammer × 50 reps × 3 steps × 2 = 300 descriptors → testar wrap
  const descs = Array.from(generatePatternDescriptors(Jackhammer, { maxReps: 50 }));
  expect(descs.length).toBe(300);
  expect(descs[0]!.sequenceNumber).toBe(0);
  expect(descs[255]!.sequenceNumber).toBe(255);
  expect(descs[256]!.sequenceNumber).toBe(0); // wraps
  expect(descs[299]!.sequenceNumber).toBe(43); // 299 mod 256 = 43
});

test('startTimeMicros ackumuleras monotont', () => {
  const descs = Array.from(generatePatternDescriptors(Jackhammer, { maxReps: 2 }));
  for (let i = 1; i < descs.length; i++) {
    expect(descs[i]!.startTimeMicros).toBeGreaterThan(descs[i - 1]!.startTimeMicros);
  }
});

test('paceMicros korrekt konverterad till paceQuarterMs', () => {
  // Jackhammer paceMicros = 7000 → 7000/250 = 28 ¼ms
  const descs = Array.from(generatePatternDescriptors(Jackhammer, { maxReps: 1 }));
  expect(descs[0]!.paceQuarterMs).toBe(28);
  // Toggle paceMicros = 25000 → 25000/250 = 100 ¼ms
  const tog = Array.from(generatePatternDescriptors(Toggle, { maxReps: 1 }));
  expect(tog[0]!.paceQuarterMs).toBe(100);
});

test('nrOfPulses default = 4 per descriptor', () => {
  for (const desc of generatePatternDescriptors(Jackhammer, { maxReps: 1 })) {
    expect(desc.nrOfPulses).toBe(4);
  }
});

test('countPatternDescriptors stämmer med generator-output', () => {
  expect(countPatternDescriptors(Jackhammer)).toBe(200 * 3 * 2);
  expect(countPatternDescriptors(Toggle)).toBe(300 * 5 * 6);
  expect(countPatternDescriptors(Jackhammer, { maxReps: 5 })).toBe(5 * 3 * 2);
});

test('patternDurationMicros korrekt beräkning', () => {
  // Jackhammer: 200 reps × 3 steps × 2 elcons × 4 pulses × 7000 µs = 33.6M µs = 33.6s
  expect(patternDurationMicros(Jackhammer)).toBe(200 * 3 * 2 * 4 * 7000);
});

test('initialSequenceNumber + initialStartTimeMicros respekteras', () => {
  const descs = Array.from(
    generatePatternDescriptors(Jackhammer, {
      maxReps: 1,
      initialSequenceNumber: 100,
      initialStartTimeMicros: 50_000,
    }),
  );
  expect(descs[0]!.sequenceNumber).toBe(100);
  expect(descs[0]!.startTimeMicros).toBe(50_000);
});

test('descriptors validateras vid encoding (disjunkt elcons)', () => {
  // Toggle och Jackhammer ska aldrig generera shortage-descriptors
  for (const desc of generatePatternDescriptors(Toggle, { maxReps: 2 })) {
    expect(desc.electrodeSet[0] & desc.electrodeSet[1]).toBe(0);
  }
});

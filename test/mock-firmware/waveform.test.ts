import { test, expect } from 'bun:test';
import { WaveformGenerator, clampAmp } from '../../src/mock-firmware/waveform';
import type { PtDescriptor } from '../../src/protocol/descriptor';

function makeDesc(amp = 128, pos = 1, neg = 2, nrOfPulses = 4, pace = 100): PtDescriptor {
  return {
    meta: 0,
    sequenceNumber: 0,
    phase: 0,
    pulseWidthMicros: 144,
    startTimeMicros: 0,
    electrodeSet: [pos, neg],
    nrOfPulses,
    paceQuarterMs: pace,
    amplitude: amp,
    deltaPulseWidthQuarters: 0,
    deltaPaceMicros: 0,
  };
}

test('clampAmp: chokepoint clamp formula', () => {
  // descriptor=128, ramp=100%, ceiling=100% → 128
  expect(clampAmp(128, 100, 100)).toBe(128);
  // descriptor=128, ramp=50% → 64
  expect(clampAmp(128, 50, 100)).toBe(64);
  // descriptor=255, ramp=100%, ceiling=50% → 127
  expect(clampAmp(255, 100, 50)).toBe(127);
  // alla maxade → 255 (cap)
  expect(clampAmp(255, 100, 100)).toBe(255);
});

test('clampAmp: kan ALDRIG överskrida 255 (single chokepoint)', () => {
  // Edge case: bug i upstream som skickar > 255
  expect(clampAmp(300, 100, 100)).toBe(255);
  expect(clampAmp(255, 200, 100)).toBe(255);
  expect(clampAmp(255, 100, 200)).toBe(255);
  expect(clampAmp(1000, 1000, 1000)).toBe(255);
});

test('clampAmp: 0 vid NaN/negative input', () => {
  expect(clampAmp(NaN, 100, 100)).toBe(0);
  expect(clampAmp(-10, 100, 100)).toBe(0);
  expect(clampAmp(100, NaN, 100)).toBe(0);
  expect(clampAmp(100, 100, NaN)).toBe(0);
  expect(clampAmp(100, -10, 100)).toBe(0);
});

test('WaveformGenerator: enqueueDescriptor + sample → event för aktiv elcon', () => {
  const g = new WaveformGenerator();
  g.enqueueDescriptor(makeDesc(128), 0);
  const samples = g.sample(15_000, { rampPercent: 100, ceilingPercent: 100 });
  expect(samples.length).toBe(1);
  expect(samples[0]?.amp).toBe(128);
  expect(samples[0]?.elconId).toBe('1-2');
});

test('WaveformGenerator: descriptor-end clearas efter sin durations', () => {
  const g = new WaveformGenerator();
  // descriptor: nr=4, pace=100 ¼ms → 4 × 100 × 250µs = 100_000µs = 100ms
  g.enqueueDescriptor(makeDesc(128, 1, 2, 4, 100), 0);
  expect(g.getActiveCount()).toBe(1);

  // Före slut: aktiv
  g.sample(50_000, { rampPercent: 100, ceilingPercent: 100 });
  expect(g.getActiveCount()).toBe(1);

  // Efter slut (>100ms): inaktiv
  g.sample(200_000, { rampPercent: 100, ceilingPercent: 100 });
  expect(g.getActiveCount()).toBe(0);
});

test('Vcap: RC follower (rises mot target när amp aktiv)', () => {
  const g = new WaveformGenerator();
  // Long descriptor: nr=100, pace=200 ¼ms → 5s aktiv (lång nog för full charge)
  g.enqueueDescriptor(makeDesc(255, 1, 2, 100, 200), 0);
  const s1 = g.sample(0, { rampPercent: 100, ceilingPercent: 100 });
  const s2 = g.sample(30_000, { rampPercent: 100, ceilingPercent: 100 });
  const s3 = g.sample(60_000, { rampPercent: 100, ceilingPercent: 100 });
  expect(s1[0]?.vcap).toBeLessThan(s2[0]?.vcap ?? 0);
  expect(s2[0]?.vcap).toBeLessThan(s3[0]?.vcap ?? 0);
  // 5s charge med α=0.139 per 30ms sample → ~167 samples → vcap närmar sig 80V
  let last = 0;
  for (let i = 0; i < 100; i++) {
    last = g.sample(90_000 + i * 30_000, { rampPercent: 100, ceilingPercent: 100 })[0]!.vcap;
  }
  expect(last).toBeGreaterThan(60_000); // approaching 80V max
});

test('Vcap: decay efter descriptor-end', () => {
  const g = new WaveformGenerator();
  g.enqueueDescriptor(makeDesc(255, 1, 2, 4, 100), 0); // 100ms duration

  // Charge up vcap
  for (let i = 0; i < 5; i++) {
    g.sample(i * 30_000, { rampPercent: 100, ceilingPercent: 100 });
  }

  // Past descriptor end (>100ms)
  const peakVcap = g.sample(150_000, { rampPercent: 100, ceilingPercent: 100 })[0]?.vcap ?? 0;
  // Decay over time
  let last = peakVcap;
  for (let i = 0; i < 30; i++) {
    const s = g.sample(180_000 + i * 30_000, { rampPercent: 100, ceilingPercent: 100 });
    if (s.length > 0) last = s[0]!.vcap;
  }
  expect(last).toBeLessThan(peakVcap);
});

test('Multiple elcons: separat Vcap-state per elcon', () => {
  const g = new WaveformGenerator();
  g.enqueueDescriptor(makeDesc(128, 1, 2), 0); // A↔B
  g.enqueueDescriptor(makeDesc(64, 4, 8), 0); // C↔D
  const samples = g.sample(15_000, { rampPercent: 100, ceilingPercent: 100 });
  expect(samples.length).toBe(2);
  const ab = samples.find((s) => s.elconId === '1-2');
  const cd = samples.find((s) => s.elconId === '4-8');
  expect(ab?.amp).toBe(128);
  expect(cd?.amp).toBe(64);
});

test('reset: clearar all state', () => {
  const g = new WaveformGenerator();
  g.enqueueDescriptor(makeDesc(128), 0);
  g.sample(15_000, { rampPercent: 100, ceilingPercent: 100 });
  g.reset();
  expect(g.getActiveCount()).toBe(0);
  const after = g.sample(30_000, { rampPercent: 100, ceilingPercent: 100 });
  expect(after.length).toBe(0);
});

test('rampPercent + ceilingPercent integration', () => {
  const g = new WaveformGenerator();
  g.enqueueDescriptor(makeDesc(255), 0);
  // ramp 50%, ceiling 100% → amp 127
  let s = g.sample(15_000, { rampPercent: 50, ceilingPercent: 100 });
  expect(s[0]?.amp).toBe(127);
  // ramp 100%, ceiling 50% → 127
  s = g.sample(45_000, { rampPercent: 100, ceilingPercent: 50 });
  expect(s[0]?.amp).toBe(127);
  // ramp 50%, ceiling 50% → ~63
  s = g.sample(75_000, { rampPercent: 50, ceilingPercent: 50 });
  expect(s[0]?.amp).toBe(63);
});

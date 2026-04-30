/**
 * Self-consistency replay-tester via validateReplay-frameworket.
 *
 * Strikt patterns312-replay är inte viable (ET-312/NeoDK topologi-mismatch
 * dokumenterad i csv-format.ts + README). Istället testar vi end-to-end
 * via NeoDK egen wire-format:
 *
 *   runner generererar descriptors → wire-format → mock dispatchar →
 *   csv-export → parse → validateReplay matchar runner-expected
 *
 * Detta validerar att hela protokoll-stacken (encode/decode/dispatch/serialize/
 * parse) bevarar timing/phase/seqNr-strukturen inom outside-voice #1 tolerance
 * (±50µs timing, ±50µs width). Regression-protection när någon ändrar i path:en.
 */
import { test, expect } from 'bun:test';
import { createInMemoryPair } from '../../src/transport/in-memory';
import { MockFirmware } from '../../src/mock-firmware/firmware';
import { NeoDKClient } from '../../src/protocol/neodk-client';
import {
  exportDispatchedAsCsv,
  dispatchedToPulses,
} from '../../src/mock-firmware/csv-export';
import { parsePatterns312Csv } from '../../src/patterns/csv-format';
import {
  validateReplay,
  formatReplayReport,
} from '../../src/patterns/replay-validate';
import { generatePatternDescriptors } from '../../src/patterns/runner';
import { Jackhammer, Toggle } from '../../src/patterns/builtins';
import type { DispatchedDescriptor } from '../../src/mock-firmware/firmware';
import type { PtDescriptor } from '../../src/protocol/descriptor';

async function flush(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(() => r()));
  await new Promise<void>((r) => queueMicrotask(() => r()));
}

/** Konvertera en descriptor-stream till "expected" dispatched-records — som om
 *  varje descriptor dispatchas exakt vid sin startTimeMicros (vilket är det
 *  event-driven mock-firmware-dispatchern gör). */
function descriptorsToExpectedDispatched(
  descriptors: readonly PtDescriptor[],
): DispatchedDescriptor[] {
  return descriptors.map((d) => ({
    descriptor: d,
    dispatchedAtMicros: d.startTimeMicros,
    queueIdx: (d.phase & 0x01) as 0 | 1,
  }));
}

test('Self-consistency: dispatchedToPulses → csv-export → parse roundtrip för Toggle', () => {
  // Pure-data roundtrip — testar att csv-format inte tappar info över Toggle's
  // 30 descriptors (1 rep × 5 steg × 6 elcons).
  const descriptors = Array.from(
    generatePatternDescriptors(Toggle, { maxReps: 1 }),
  );
  const dispatched = descriptorsToExpectedDispatched(descriptors);

  const expected = dispatchedToPulses(dispatched);
  const csv = exportDispatchedAsCsv(dispatched);
  const actual = parsePatterns312Csv(csv);

  const report = validateReplay(expected, actual);
  if (!report.matched) {
    throw new Error(formatReplayReport(report));
  }
  expect(report.matched).toBe(true);
  expect(report.totalExpected).toBe(descriptors.length * descriptors[0]!.nrOfPulses);
});

test('Self-consistency: Jackhammer roundtrip via csv-export', () => {
  const descriptors = Array.from(
    generatePatternDescriptors(Jackhammer, { maxReps: 1 }),
  );
  const dispatched = descriptorsToExpectedDispatched(descriptors);
  const expected = dispatchedToPulses(dispatched);
  const csv = exportDispatchedAsCsv(dispatched);
  const actual = parsePatterns312Csv(csv);
  const report = validateReplay(expected, actual);
  if (!report.matched) throw new Error(formatReplayReport(report));
  expect(report.matched).toBe(true);
});

test('Full wire-path: runner → NeoDKClient → mock → csv-export → parse matchar', async () => {
  // End-to-end: descriptors går genom encode/decode/transport/dispatch/serialize.
  // Validerar att INGEN bit-information försvinner längs vägen.
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  // Generera Toggle 1 rep — 30 descriptors med stigande startTimes
  const descriptors = Array.from(
    generatePatternDescriptors(Toggle, { maxReps: 1 }),
  );
  const expected = dispatchedToPulses(descriptorsToExpectedDispatched(descriptors));

  // Skicka via wire (encode → frame → transport → mock decode → enqueue)
  for (const desc of descriptors) {
    await client.writePtDescriptor(desc);
  }
  await flush();

  // Avancera SimClock förbi sista startTime — alla schemalagda events fire:ar
  const lastStart = descriptors[descriptors.length - 1]!.startTimeMicros;
  fw.getClock().advance(Math.ceil(lastStart / 1000) + 100);
  await flush();

  // Hämta dispatched + serialize → parse
  const actualDispatched = fw.getDispatchedDescriptors();
  expect(actualDispatched.length).toBe(descriptors.length);
  const csv = exportDispatchedAsCsv(actualDispatched);
  const actual = parsePatterns312Csv(csv);

  const report = validateReplay(expected, actual);
  if (!report.matched) throw new Error(formatReplayReport(report));
  expect(report.matched).toBe(true);

  await client.disconnect();
  fw.detach();
});

test('Tolerance band: simulerad jitter <50µs accepteras, >50µs fail:ar', () => {
  // Verifiera att tolerance-band:en gör replay robust mot mätbart jitter
  // (real-world hardware-spridning) men fångar systematiska bugs.
  const descriptors = Array.from(
    generatePatternDescriptors(Jackhammer, { maxReps: 1 }),
  );
  const dispatched = descriptorsToExpectedDispatched(descriptors);
  const expected = dispatchedToPulses(dispatched);

  // Simulera +30µs jitter på alla timestamps — ska accepteras
  const jittered30 = expected.map((p) => ({
    ...p,
    timestampMicros: p.timestampMicros + 30,
  }));
  expect(validateReplay(expected, jittered30).matched).toBe(true);

  // Simulera +100µs jitter — ska fail:a (utanför ±50µs)
  const jittered100 = expected.map((p) => ({
    ...p,
    timestampMicros: p.timestampMicros + 100,
  }));
  expect(validateReplay(expected, jittered100).matched).toBe(false);
});

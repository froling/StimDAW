import { test, expect } from 'bun:test';
import { createInMemoryPair } from '../../src/transport/in-memory';
import {
  MockFirmware,
  encodePtQueueFreeSpace,
  decodePtQueueFreeSpace,
} from '../../src/mock-firmware/firmware';
import { NeoDKClient } from '../../src/protocol/neodk-client';
import {
  encodeDescriptor,
  type PtDescriptor,
} from '../../src/protocol/descriptor';
import { encodeFrame } from '../../src/protocol/frame';
import {
  ATTRIBUTE_ACTION_SIZE,
  AttributeId,
  FrameType,
  NST,
  OPCode,
  PACKET_HEADER_SIZE,
} from '../../src/protocol/opcodes';
import { SLOTS_PER_QUEUE } from '../../src/mock-firmware/pt-queue';

/**
 * α2 Phase 1B end-to-end test: host skickar descriptors via NeoDKClient →
 * mock-firmware decodear, enqueue:ar och dispatchar via SimClock-tick.
 *
 * Per outside-voice findings:
 *   #1 (replay): dispatched-buffer behåller seq + timing för CSV-jämförelse
 *   #4 (disjunkts-rule): kort-slutna descriptors avvisas vid enqueue
 *   #5 (STOP-stuck-queue): drainPtQueue() rensar pending före dispatch
 */

function makeDescriptor(overrides: Partial<PtDescriptor> = {}): PtDescriptor {
  return {
    meta: 0,
    sequenceNumber: 1,
    phase: 0,
    pulseWidthMicros: 100,
    startTimeMicros: 0,
    electrodeSet: [0b0001, 0b0010], // A pos, B neg → disjoint
    nrOfPulses: 1,
    paceQuarterMs: 0,
    amplitude: 0,
    deltaPulseWidthQuarters: 0,
    deltaPaceMicros: 0,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(() => r()));
  await new Promise<void>((r) => queueMicrotask(() => r()));
}

function buildRawDatagram(payload: Uint8Array, seq: number): Uint8Array {
  return encodeFrame({
    serviceType: NST.Datagram,
    frameType: FrameType.Data,
    seq,
    payload,
  });
}

function buildAttrPacket(
  transId: number,
  opcode: number,
  attrId: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const buf = new Uint8Array(PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE + payload.length);
  let i = PACKET_HEADER_SIZE;
  buf[i++] = transId & 0xff;
  buf[i++] = (transId >> 8) & 0xff;
  buf[i++] = opcode;
  buf[i++] = 0;
  buf[i++] = attrId & 0xff;
  buf[i++] = (attrId >> 8) & 0xff;
  buf.set(payload, i);
  return buf;
}

test('descriptor flow: client.writePtDescriptor → firmware enqueues + dispatches', async () => {
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  const desc = makeDescriptor({ sequenceNumber: 42, startTimeMicros: 0 });
  await client.writePtDescriptor(desc);
  await flush();

  // Tick once so dispatcher pulls from queue
  fw.getClock().advance(10);
  await flush();

  const dispatched = fw.getDispatchedDescriptors();
  expect(dispatched.length).toBe(1);
  expect(dispatched[0]!.descriptor.sequenceNumber).toBe(42);
  expect(dispatched[0]!.queueIdx).toBe(0); // phase=0 → q0

  await client.disconnect();
  fw.detach();
});

test('descriptor flow: phase bit selects sub-queue', async () => {
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  await client.writePtDescriptor(makeDescriptor({ sequenceNumber: 1, phase: 0 }));
  await client.writePtDescriptor(makeDescriptor({ sequenceNumber: 2, phase: 1 }));
  await flush();
  fw.getClock().advance(10);
  await flush();

  const dispatched = fw.getDispatchedDescriptors();
  expect(dispatched.length).toBe(2);
  const byQueue = new Map(dispatched.map((d) => [d.queueIdx, d.descriptor.sequenceNumber]));
  expect(byQueue.get(0)).toBe(1);
  expect(byQueue.get(1)).toBe(2);

  await client.disconnect();
  fw.detach();
});

test('descriptor flow: short-circuit descriptor rejected at firmware edge', async () => {
  // OBS: NeoDKClient validerar redan i encodeDescriptor (host-side gate).
  // Här bygger vi raw bytes som bypassar host-validering för att stress-testa
  // firmware-edgen. Använder en validdescriptor som vi muterar post-encode.
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  // Encoda en valid descriptor och muta byte 8/9 till overlap
  const valid = makeDescriptor({ sequenceNumber: 99 });
  const bytes = encodeDescriptor(valid);
  bytes[8] = 0b0011; // pos = A+B
  bytes[9] = 0b0010; // neg = B → overlap (A&B & B = B)

  // Skicka som WriteRequest till PtDescriptorQueue
  const packet = buildAttrPacket(
    1,
    OPCode.WriteRequest,
    AttributeId.PtDescriptorQueue,
    bytes,
  );
  await clientTransport.open();
  await clientTransport.write(buildRawDatagram(packet, 0));
  await flush();
  fw.getClock().advance(10);
  await flush();

  // Inga dispatched descriptors — short-circuit avvisades vid enqueue
  expect(fw.getDispatchedDescriptors().length).toBe(0);
  expect(fw.getPtQueueFreeSpace()).toEqual({
    q0: SLOTS_PER_QUEUE,
    q1: SLOTS_PER_QUEUE,
  });

  fw.detach();
});

test('descriptor flow: queue overflow drops descriptor with notify', async () => {
  // Skapa 21 descriptors med startTimeMicros långt i framtiden så de
  // INTE dispatchas innan vi mätar overflow-läget.
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  // 21 descriptors för q0 (phase=0) — 21:a ska droppas (cap=20)
  for (let i = 0; i < 21; i++) {
    await client.writePtDescriptor(
      makeDescriptor({
        sequenceNumber: i,
        phase: 0,
        startTimeMicros: 1_000_000_000, // far future, undvik dispatch
      }),
    );
  }
  await flush();

  // Före dispatcher-tick: queue ska vara full
  expect(fw.getPtQueueFreeSpace()).toEqual({
    q0: 0,
    q1: SLOTS_PER_QUEUE,
  });
  expect(fw.getDispatchedDescriptors().length).toBe(0);

  await client.disconnect();
  fw.detach();
});

test('descriptor flow: drainPtQueue clears pending and notifies', async () => {
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  // Pumpa in några pending descriptors med far-future start
  for (let i = 0; i < 5; i++) {
    await client.writePtDescriptor(
      makeDescriptor({ sequenceNumber: i, startTimeMicros: 1_000_000_000 }),
    );
  }
  await flush();
  expect(fw.getPtQueueFreeSpace().q0).toBe(SLOTS_PER_QUEUE - 5);

  const dropped = fw.drainPtQueue();
  expect(dropped).toBe(5);
  expect(fw.getPtQueueFreeSpace().q0).toBe(SLOTS_PER_QUEUE);
  expect(fw.getDispatchedDescriptors().length).toBe(0);

  await client.disconnect();
  fw.detach();
});

test('descriptor flow: dispatch happens precis vid startTimeMicros (event-driven)', async () => {
  // Strikt timing-test för replay-validering: dispatch fires exakt vid
  // descriptor.startTimeMicros, inte tick-aligned. Detta var motivationen
  // bakom bytet från tick-polling till SimClock.scheduleAt-events.
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  // Tre descriptors med ojämna startTimes som INTE alignar mot någon tick-grid
  const startTimes = [1_234_000, 5_678_000, 9_999_500]; // µs
  for (let i = 0; i < startTimes.length; i++) {
    await client.writePtDescriptor(
      makeDescriptor({ sequenceNumber: i, startTimeMicros: startTimes[i]! }),
    );
  }
  await flush();

  // Inget dispatchat än — alla startTimes i framtiden
  expect(fw.getDispatchedDescriptors().length).toBe(0);

  // Avancera klockan till strax efter sista startTime
  fw.getClock().advance(10_000); // 10s = 10_000ms = 10_000_000µs
  await flush();

  const dispatched = fw.getDispatchedDescriptors();
  expect(dispatched.length).toBe(3);
  // dispatchedAtMicros ska vara EXAKT lika med startTimeMicros — ingen tick-jitter
  for (let i = 0; i < startTimes.length; i++) {
    expect(dispatched[i]!.dispatchedAtMicros).toBe(startTimes[i]!);
    expect(dispatched[i]!.descriptor.sequenceNumber).toBe(i);
  }

  await client.disconnect();
  fw.detach();
});

test('descriptor flow: drain invaliderar pending dispatch-events (generation bump)', async () => {
  // Generation-pattern: descriptors enqueued men dispatch-event ej fired än.
  // drainPtQueue() bumpar generation → events no-op:ar när de fire:as.
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  // Enqueue 3 descriptors med startTime långt in i framtiden
  for (let i = 0; i < 3; i++) {
    await client.writePtDescriptor(
      makeDescriptor({ sequenceNumber: i, startTimeMicros: 5_000_000 }),
    );
  }
  await flush();

  // Drain INNAN events fire:ar
  fw.drainPtQueue();

  // Nu advance klockan förbi alla startTimes — events fire:ar men gen-mismatch
  fw.getClock().advance(10_000);
  await flush();

  // Inget ska ha dispatchats (gen-check filtrerade bort dem)
  expect(fw.getDispatchedDescriptors().length).toBe(0);
  expect(fw.getPtQueueFreeSpace()).toEqual({ q0: SLOTS_PER_QUEUE, q1: SLOTS_PER_QUEUE });

  await client.disconnect();
  fw.detach();
});

test('descriptor flow: PlayPauseStop "stop" drains queue automatically', async () => {
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  for (let i = 0; i < 3; i++) {
    await client.writePtDescriptor(
      makeDescriptor({ sequenceNumber: i, startTimeMicros: 1_000_000_000 }),
    );
  }
  await flush();
  expect(fw.getPtQueueFreeSpace().q0).toBe(SLOTS_PER_QUEUE - 3);

  await client.writePlayState('stop');
  await flush();

  expect(fw.getPtQueueFreeSpace().q0).toBe(SLOTS_PER_QUEUE);

  await client.disconnect();
  fw.detach();
});

test('descriptor flow: STOP-during-stuck-queue (outside-voice #5)', async () => {
  // Kritisk safety-test: queue stuck (full pga overflow) + STOP. Verifiera:
  //   1. STOP dränerar queue till 100% free
  //   2. INGEN pending dispatch fires efter STOP (även när klockan advance:ar
  //      förbi alla schemalagda startTimes)
  // Detta är test-spec:en från outside-voice finding #5 (α2 design-doc).
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  // Pumpa in 25 descriptors → q0 (cap 20) overflow:ar med 5 dropade
  // startTime långt i framtiden så ingen dispatchas innan STOP
  for (let i = 0; i < 25; i++) {
    await client.writePtDescriptor(
      makeDescriptor({
        sequenceNumber: i,
        phase: 0,
        startTimeMicros: 5_000_000 + i * 1_000, // 5s+ i framtiden
      }),
    );
  }
  await flush();

  // Pre-STOP: queue stuck (full)
  expect(fw.getPtQueueFreeSpace().q0).toBe(0);
  expect(fw.getDispatchedDescriptors().length).toBe(0);

  // STOP via PlayPauseStop "stop" — drainar queue + bumpar generation
  await client.writePlayState('stop');
  await flush();

  // Queue dränerad omedelbart
  expect(fw.getPtQueueFreeSpace()).toEqual({
    q0: SLOTS_PER_QUEUE,
    q1: SLOTS_PER_QUEUE,
  });

  // Avancera klockan rejält förbi alla startTimes (10s)
  // Pending events fire:ar men generation-mismatch → no-op
  fw.getClock().advance(10_000);
  await flush();

  // Kritiskt: INGEN dispatch efter STOP
  expect(fw.getDispatchedDescriptors().length).toBe(0);

  await client.disconnect();
  fw.detach();
});

test('descriptor flow: STOP mid-flight stoppar resterande dispatches', async () => {
  // Kompletterande till outside-voice #5: när vissa redan dispatched + STOP +
  // resterande får INTE dispatchas.
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  await client.connect();
  await flush();

  // 10 descriptors spridda 0, 100ms, 200ms, ..., 900ms
  for (let i = 0; i < 10; i++) {
    await client.writePtDescriptor(
      makeDescriptor({
        sequenceNumber: i,
        startTimeMicros: i * 100_000,
      }),
    );
  }
  await flush();

  // Avancera till mitten — 5 ska ha dispatchats (startTime 0, 100, 200, 300, 400ms)
  fw.getClock().advance(450);
  await flush();
  const halfwayCount = fw.getDispatchedDescriptors().length;
  expect(halfwayCount).toBeGreaterThan(0);
  expect(halfwayCount).toBeLessThan(10);

  // STOP — drainar resterande, invaliderar pending events
  await client.writePlayState('stop');
  await flush();

  // Avancera förbi alla startTimes
  fw.getClock().advance(1_000);
  await flush();

  // Dispatched-count oförändrad efter STOP — resten droppade
  expect(fw.getDispatchedDescriptors().length).toBe(halfwayCount);

  await client.disconnect();
  fw.detach();
});

test('encodePtQueueFreeSpace round-trips via decodePtQueueFreeSpace', () => {
  const cases = [
    { q0: 20, q1: 20 },
    { q0: 0, q1: 20 },
    { q0: 20, q1: 0 },
    { q0: 7, q1: 13 },
  ];
  for (const free of cases) {
    const encoded = encodePtQueueFreeSpace(free);
    expect(encoded.length).toBe(6);
    const decoded = decodePtQueueFreeSpace(encoded);
    expect(decoded).toEqual(free);
  }
});

test('decodePtQueueFreeSpace returns null on bad payload', () => {
  expect(decodePtQueueFreeSpace(new Uint8Array(0))).toBeNull();
  expect(decodePtQueueFreeSpace(new Uint8Array([0x99, 4, 0, 0, 0, 0]))).toBeNull();
  expect(decodePtQueueFreeSpace(new Uint8Array([0x10, 99, 0, 0, 0, 0]))).toBeNull();
});

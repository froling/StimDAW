import { test, expect } from 'bun:test';
import { createInMemoryPair } from '../../src/transport/in-memory';
import { MockFirmware } from '../../src/mock-firmware/firmware';
import { NeoDKClient } from '../../src/protocol/neodk-client';
import { AttributeId } from '../../src/protocol/opcodes';

async function flush(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(() => r()));
  await new Promise<void>((r) => queueMicrotask(() => r()));
  await new Promise<void>((r) => queueMicrotask(() => r()));
}

test('client: connect emits connected event', async () => {
  const { client: clientTransport, firmware: fwTransport } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwTransport);
  await fwTransport.open();

  const client = new NeoDKClient(clientTransport);
  let connected = false;
  client.on('connected', () => {
    connected = true;
  });
  await client.connect();
  expect(connected).toBe(true);

  await client.disconnect();
  fw.detach();
});

test('client: subscribe to voltages → receives Voltages events', async () => {
  const { client: clientT, firmware: fwT } = createInMemoryPair();
  const fw = new MockFirmware({ voltageEmitIntervalMs: 50, realtime: false });
  fw.attach(fwT);
  await fwT.open();

  const client = new NeoDKClient(clientT);
  const voltageEvents: number[] = [];
  client.on('voltages', (v) => {
    voltageEvents.push(v.Vbat_mV);
  });
  await client.connect();
  await client.subscribe(AttributeId.Voltages);
  await flush();

  for (let i = 0; i < 4; i++) {
    fw.getClock().advance(50);
    await flush();
  }

  expect(voltageEvents.length).toBeGreaterThanOrEqual(4);
  for (const v of voltageEvents) {
    expect(v).toBeGreaterThan(8000);
    expect(v).toBeLessThan(10000);
  }

  await client.disconnect();
  fw.detach();
});

test('client: writeIntensity → fw state mutates → intensity event echoes', async () => {
  const { client: clientT, firmware: fwT } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwT);
  await fwT.open();

  const client = new NeoDKClient(clientT);
  const captured = { intensity: null as number | null };
  client.on('intensity', (n) => {
    captured.intensity = n;
  });
  await client.connect();
  await client.writeIntensity(75);
  await flush();
  await flush();

  expect(captured.intensity).toBe(75);
  expect(fw.getState().intensityPercent).toBe(75);

  await client.disconnect();
  fw.detach();
});

test('client: sendDebug "/n" cycles pattern → pattern event fires (after subscribe)', async () => {
  const { client: clientT, firmware: fwT } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwT);
  await fwT.open();

  const client = new NeoDKClient(clientT);
  const patternEvents: string[] = [];
  client.on('pattern', (p) => {
    patternEvents.push(p);
  });
  await client.connect();
  await client.subscribe(AttributeId.CurrentPatternName);
  await flush();
  await client.sendDebug('/n');
  await flush();
  await flush();

  expect(patternEvents.length).toBeGreaterThan(0);
  expect(patternEvents[patternEvents.length - 1]).toBe('TENS');
  expect(fw.getState().currentPattern).toBe('TENS');

  await client.disconnect();
  fw.detach();
});

test('client: disconnect emits disconnected event', async () => {
  const { client: clientT, firmware: fwT } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(fwT);
  await fwT.open();

  const client = new NeoDKClient(clientT);
  let disconnected = false;
  client.on('disconnected', () => {
    disconnected = true;
  });
  await client.connect();
  await client.disconnect();
  await flush();

  expect(disconnected).toBe(true);
  fw.detach();
});

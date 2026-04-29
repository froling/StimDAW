import { test, expect } from 'bun:test';
import { createInMemoryPair } from '../../src/transport/in-memory';
import { MockFirmware } from '../../src/mock-firmware/firmware';
import { encodeFrame, FrameParser } from '../../src/protocol/frame';
import {
  ATTRIBUTE_ACTION_SIZE,
  AttributeId,
  Encoding,
  FrameType,
  NST,
  OPCode,
  PACKET_HEADER_SIZE,
} from '../../src/protocol/opcodes';
import { decodeUInt1, decodeVoltages } from '../../src/protocol/attributes';

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

function wrapDatagram(payload: Uint8Array, seq: number): Uint8Array {
  return encodeFrame({ serviceType: NST.Datagram, frameType: FrameType.Data, seq, payload });
}

async function flush(): Promise<void> {
  // Two microtask hops: write → deliver → handler
  await new Promise<void>((r) => queueMicrotask(() => r()));
  await new Promise<void>((r) => queueMicrotask(() => r()));
}

test('integration: subscribe to voltages → receives periodic ReportData', async () => {
  const { client, firmware } = createInMemoryPair();
  const fw = new MockFirmware({ voltageEmitIntervalMs: 50, realtime: false });
  fw.attach(firmware);
  await firmware.open();
  await client.open();

  const parser = new FrameParser();
  const voltages: ReturnType<typeof decodeVoltages>[] = [];
  client.on((event) => {
    if (event.type !== 'data') return;
    for (const frame of parser.push(event.bytes)) {
      if (frame.frameType !== FrameType.Data || frame.serviceType !== NST.Datagram) continue;
      const offset = PACKET_HEADER_SIZE;
      const opcode = frame.payload[offset + 2]!;
      const attrId = frame.payload[offset + 4]! | (frame.payload[offset + 5]! << 8);
      if (opcode === OPCode.ReportData && attrId === AttributeId.Voltages) {
        voltages.push(
          decodeVoltages(frame.payload.slice(PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE)),
        );
      }
    }
  });

  await client.write(wrapDatagram(buildAttrPacket(1, OPCode.SubscribeRequest, AttributeId.Voltages), 0));
  await flush();

  // Advance 5 ticks of 50ms each
  for (let i = 0; i < 5; i++) {
    fw.getClock().advance(50);
    await flush();
  }

  // 1 from subscribe-ack-via-ReportData + 5 from periodic emission = 6
  expect(voltages.length).toBeGreaterThanOrEqual(5);
  for (const v of voltages) {
    expect(v).not.toBeNull();
    expect(v!.Vbat_mV).toBeGreaterThan(8000);
    expect(v!.Vbat_mV).toBeLessThan(10000);
  }
  fw.detach();
});

test('integration: write IntensityPercent → state mutates, ReportData echoes', async () => {
  const { client, firmware } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(firmware);
  await firmware.open();
  await client.open();

  const parser = new FrameParser();
  let echoedIntensity: number | null = null;
  client.on((event) => {
    if (event.type !== 'data') return;
    for (const frame of parser.push(event.bytes)) {
      if (frame.frameType !== FrameType.Data || frame.serviceType !== NST.Datagram) continue;
      const offset = PACKET_HEADER_SIZE;
      const opcode = frame.payload[offset + 2]!;
      const attrId = frame.payload[offset + 4]! | (frame.payload[offset + 5]! << 8);
      if (opcode === OPCode.ReportData && attrId === AttributeId.IntensityPercent) {
        echoedIntensity = decodeUInt1(
          frame.payload.slice(PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE),
        );
      }
    }
  });

  await client.write(
    wrapDatagram(
      buildAttrPacket(
        2,
        OPCode.WriteRequest,
        AttributeId.IntensityPercent,
        new Uint8Array([Encoding.UnsignedInt1, 75]),
      ),
      0,
    ),
  );
  await flush();
  await flush();

  expect(echoedIntensity).toBe(75);
  expect(fw.getState().intensityPercent).toBe(75);
  fw.detach();
});

test('integration: debug command "/5" sets intensity 50 and echoes via subscription', async () => {
  const { client, firmware } = createInMemoryPair();
  const fw = new MockFirmware({ realtime: false });
  fw.attach(firmware);
  await firmware.open();
  await client.open();

  const parser = new FrameParser();
  let intensity: number | null = null;
  client.on((event) => {
    if (event.type !== 'data') return;
    for (const frame of parser.push(event.bytes)) {
      if (frame.frameType !== FrameType.Data || frame.serviceType !== NST.Datagram) continue;
      const offset = PACKET_HEADER_SIZE;
      const opcode = frame.payload[offset + 2]!;
      const attrId = frame.payload[offset + 4]! | (frame.payload[offset + 5]! << 8);
      if (opcode === OPCode.ReportData && attrId === AttributeId.IntensityPercent) {
        intensity = decodeUInt1(frame.payload.slice(PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE));
      }
    }
  });

  // Subscribe first so debug-triggered changes notify
  await client.write(wrapDatagram(buildAttrPacket(1, OPCode.SubscribeRequest, AttributeId.IntensityPercent), 0));
  await flush();
  // Then debug command
  const debugFrame = encodeFrame({
    serviceType: NST.Debug,
    frameType: FrameType.Data,
    seq: 1,
    payload: new TextEncoder().encode('/5'),
  });
  await client.write(debugFrame);
  await flush();
  await flush();

  expect(fw.getState().intensityPercent).toBe(50);
  expect(intensity).toBe(50);
  fw.detach();
});

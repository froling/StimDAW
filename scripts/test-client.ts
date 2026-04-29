#!/usr/bin/env bun
/**
 * StimDAW test client — demonstrates mock firmware end-to-end.
 *
 *   bun run scripts/test-client.ts
 *
 * Spins up a mock NeoDK in-process, connects, subscribes to voltages,
 * runs through a scenario (subscribe → /b → ramp intensity → /n → write → /s),
 * prints what happens at each step.
 */
import { createInMemoryPair } from '../src/transport/in-memory';
import { MockFirmware } from '../src/mock-firmware/firmware';
import { encodeFrame, FrameParser } from '../src/protocol/frame';
import { encodeDebugCommand, DebugCommands } from '../src/protocol/debug-cli';
import {
  ATTRIBUTE_ACTION_SIZE,
  AttributeId,
  Encoding,
  FrameType,
  NST,
  OPCode,
  PACKET_HEADER_SIZE,
} from '../src/protocol/opcodes';
import { decodeUInt1, decodeUTF8String, decodeVoltages } from '../src/protocol/attributes';
import { setLogLevel } from '../src/log';

setLogLevel('warn'); // hide debug-level firmware logs in client output

async function main() {
  console.log('═══ StimDAW test client ═══\n');
  console.log('Spinning up mock NeoDK in-process…\n');

  const { client, firmware } = createInMemoryPair();
  const fw = new MockFirmware({ voltageEmitIntervalMs: 200, realtime: true });
  fw.attach(firmware);
  await firmware.open();
  await client.open();
  console.log('  ✓ transport open');
  console.log(`  ✓ mock fw v${fw.getState().firmwareVersion}\n`);

  // Listener: parse incoming and pretty-print
  const parser = new FrameParser();
  let voltageCount = 0;
  let lastPrintedAt = 0;
  client.on((event) => {
    if (event.type !== 'data') return;
    for (const frame of parser.push(event.bytes)) {
      if (frame.frameType !== FrameType.Data) continue;

      if (frame.serviceType === NST.Debug) {
        const text = new TextDecoder().decode(frame.payload).trim();
        console.log(`  ◀ DEBUG  ${text}`);
        continue;
      }

      const offset = PACKET_HEADER_SIZE;
      const opcode = frame.payload[offset + 2]!;
      const attrId = frame.payload[offset + 4]! | (frame.payload[offset + 5]! << 8);
      if (opcode !== OPCode.ReportData) continue;
      const attrPayload = frame.payload.slice(PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE);

      switch (attrId) {
        case AttributeId.Voltages: {
          voltageCount += 1;
          const v = decodeVoltages(attrPayload);
          if (v && Date.now() - lastPrintedAt > 500) {
            console.log(
              `  ◀ VOLT   Vbat=${v.Vbat_mV}mV  Vcap=${v.Vcap_mV.toString().padStart(5)}mV  Iprim=${v.Iprim_mA}mA`,
            );
            lastPrintedAt = Date.now();
          }
          break;
        }
        case AttributeId.IntensityPercent: {
          const v = decodeUInt1(attrPayload);
          console.log(`  ◀ INTENSITY  ${v}%`);
          break;
        }
        case AttributeId.PlayPauseStop: {
          const v = decodeUInt1(attrPayload);
          const labels = ['undefined', 'stopped', 'paused', 'playing'];
          console.log(`  ◀ STATE  ${labels[v ?? 0]}`);
          break;
        }
        case AttributeId.CurrentPatternName: {
          console.log(`  ◀ PATTERN  ${decodeUTF8String(attrPayload)}`);
          break;
        }
      }
    }
  });

  // Send helpers
  let txSeq = 0;
  let trans = 1000;
  const nextSeq = (): number => {
    const s = txSeq;
    txSeq = (txSeq + 1) & 0x7;
    return s;
  };
  const buildPacket = (
    opcode: number,
    attrId: number,
    payload: Uint8Array = new Uint8Array(0),
  ): Uint8Array => {
    const buf = new Uint8Array(PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE + payload.length);
    let i = PACKET_HEADER_SIZE;
    const t = trans++;
    buf[i++] = t & 0xff;
    buf[i++] = (t >> 8) & 0xff;
    buf[i++] = opcode;
    buf[i++] = 0;
    buf[i++] = attrId & 0xff;
    buf[i++] = (attrId >> 8) & 0xff;
    buf.set(payload, i);
    return buf;
  };
  const sendDatagram = (opcode: number, attrId: number, payload?: Uint8Array): Promise<void> =>
    client.write(
      encodeFrame({
        serviceType: NST.Datagram,
        frameType: FrameType.Data,
        seq: nextSeq(),
        payload: buildPacket(opcode, attrId, payload),
      }),
    );

  const step = (n: number, label: string): void => {
    console.log(`\n── Step ${n}: ${label}`);
  };

  step(1, 'subscribe to Voltages, IntensityPercent, PlayPauseStop, CurrentPatternName');
  await sendDatagram(OPCode.SubscribeRequest, AttributeId.Voltages);
  await sendDatagram(OPCode.SubscribeRequest, AttributeId.IntensityPercent);
  await sendDatagram(OPCode.SubscribeRequest, AttributeId.PlayPauseStop);
  await sendDatagram(OPCode.SubscribeRequest, AttributeId.CurrentPatternName);
  await sleep(400);

  step(2, 'press button (debug /b) → starts playing');
  await client.write(encodeDebugCommand(DebugCommands.ButtonPress, nextSeq()));
  await sleep(800);

  step(3, 'set intensity 50% via debug /5 → Vcap should rise');
  await client.write(encodeDebugCommand(DebugCommands.Intensity50, nextSeq()));
  await sleep(1500);

  step(4, 'switch pattern (/n)');
  await client.write(encodeDebugCommand(DebugCommands.NextPattern, nextSeq()));
  await sleep(400);

  step(5, 'write IntensityPercent=80 via Datagram');
  await sendDatagram(
    OPCode.WriteRequest,
    AttributeId.IntensityPercent,
    new Uint8Array([Encoding.UnsignedInt1, 80]),
  );
  await sleep(1500);

  step(6, 'stop (/s) → Vcap decays');
  await client.write(encodeDebugCommand(DebugCommands.Stop, nextSeq()));
  await sleep(1000);

  console.log('\n═══ Final state ═══');
  console.log(JSON.stringify(fw.getState(), null, 2));
  console.log(`\nReceived ${voltageCount} voltage updates over scenario.`);

  await client.close();
  fw.detach();
  console.log('\n✓ done.');
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error('test-client failed:', e);
  process.exit(1);
});

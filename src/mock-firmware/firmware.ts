import { encodeFrame, FrameParser } from '../protocol/frame';
import {
  ATTRIBUTE_ACTION_SIZE,
  AttributeId,
  FrameType,
  NST,
  OPCode,
  PACKET_HEADER_SIZE,
} from '../protocol/opcodes';
import {
  decodeUInt1,
  decodeUTF8String,
  encodeUInt1,
  encodeUTF8String,
  encodeVoltages,
} from '../protocol/attributes';
import { createLogger } from '../log';
import { SimClock } from './sim-clock';
import { VoltageSim } from './voltage-sim';
import { type FirmwareState, PlayState, createInitialState } from './state';
import type { Transport } from '../transport/transport';

const log = createLogger('mock-fw');

export interface MockFirmwareOptions {
  /** Voltage emit interval in simulated ms. Default 100. */
  voltageEmitIntervalMs?: number;
  /** Auto-start the simulation clock in real-time mode. Default true. */
  realtime?: boolean;
}

/**
 * Mock NeoDK firmware. Subscribes to a Transport, parses incoming frames,
 * dispatches to handlers, emits ReportData responses + periodic voltage updates.
 *
 * Drives all timing through SimClock — virtual time decoupled from real time.
 * In tests pass realtime:false and call clock.advance() manually.
 */
export class MockFirmware {
  private state: FirmwareState = createInitialState();
  private clock = new SimClock();
  private voltage = new VoltageSim();
  private parser = new FrameParser();
  private transport: Transport | null = null;
  private unsubscribe: (() => void) | null = null;
  private txSeq = 0;
  private voltageSubscribed = false;
  private otherSubscriptions = new Set<number>();
  private opts: Required<MockFirmwareOptions>;

  constructor(opts: MockFirmwareOptions = {}) {
    this.opts = {
      voltageEmitIntervalMs: opts.voltageEmitIntervalMs ?? 100,
      realtime: opts.realtime ?? true,
    };
  }

  attach(transport: Transport): void {
    this.transport = transport;
    this.unsubscribe = transport.on((event) => {
      if (event.type === 'data') this.handleBytes(event.bytes);
      else if (event.type === 'open') log.debug('transport open');
      else if (event.type === 'close') log.debug('transport close');
      else if (event.type === 'error') log.error('transport error:', event.error);
    });
    if (this.opts.realtime) this.clock.startRealtime();
    this.scheduleVoltageEmit();
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.transport = null;
    this.clock.stopRealtime();
  }

  getClock(): SimClock {
    return this.clock;
  }

  getState(): Readonly<FirmwareState> {
    return this.state;
  }

  private handleBytes(bytes: Uint8Array): void {
    const frames = this.parser.push(bytes);
    for (const frame of frames) {
      if (frame.frameType === FrameType.Sync) continue;
      if (frame.frameType === FrameType.Ack) continue;
      if (frame.frameType !== FrameType.Data) continue;
      this.sendAck(frame.serviceType, frame.seq);
      if (frame.serviceType === NST.Debug) this.handleDebugFrame(frame.payload);
      else if (frame.serviceType === NST.Datagram) this.handleDatagram(frame.payload);
    }
  }

  private sendAck(serviceType: NST, seq: number): void {
    if (!this.transport) return;
    const ack = encodeFrame({
      serviceType,
      frameType: FrameType.Ack,
      ackFlag: true,
      seq: 0,
      ack: seq,
    });
    void this.transport.write(ack);
  }

  private handleDebugFrame(payload: Uint8Array): void {
    const text = new TextDecoder().decode(payload).trim();
    log.debug('debug:', text);
    if (!text.startsWith('/') || text.length < 2) return;
    const cmd = text[1];
    if (cmd && cmd >= '0' && cmd <= '9') {
      this.applyIntensity(parseInt(cmd, 10) * 10);
      return;
    }
    switch (cmd) {
      case 'u':
        this.applyIntensity(this.state.intensityPercent + 2);
        return;
      case 'd':
        this.applyIntensity(this.state.intensityPercent - 2);
        return;
      case 'b':
        this.state.playState =
          this.state.playState === PlayState.Playing ? PlayState.Paused : PlayState.Playing;
        this.voltage.setPlaying(this.state.playState === PlayState.Playing);
        this.notify(AttributeId.PlayPauseStop);
        return;
      case 's':
        this.state.playState = PlayState.Stopped;
        this.voltage.setPlaying(false);
        this.notify(AttributeId.PlayPauseStop);
        return;
      case 'n': {
        const idx = this.state.availablePatterns.indexOf(this.state.currentPattern);
        const next =
          this.state.availablePatterns[(idx + 1) % this.state.availablePatterns.length]!;
        this.state.currentPattern = next;
        this.notify(AttributeId.CurrentPatternName);
        return;
      }
      case 'v':
        this.sendDebugLine(`Firmware ${this.state.firmwareVersion}`);
        return;
      case '?':
        this.sendDebugLine('Help: /0-9 intensity, /u up, /d down, /b btn, /s stop, /n next, /v ver');
        return;
    }
  }

  private applyIntensity(pct: number): void {
    const clamped = Math.max(0, Math.min(100, pct));
    this.state.intensityPercent = clamped;
    this.voltage.setIntensity(clamped);
    this.notify(AttributeId.IntensityPercent);
  }

  private sendDebugLine(text: string): void {
    if (!this.transport) return;
    const data = new TextEncoder().encode(`${text}\n`);
    void this.transport.write(
      encodeFrame({
        serviceType: NST.Debug,
        frameType: FrameType.Data,
        seq: this.nextTxSeq(),
        payload: data,
      }),
    );
  }

  private handleDatagram(packet: Uint8Array): void {
    if (packet.length < PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE) return;
    const offset = PACKET_HEADER_SIZE;
    const transId = packet[offset]! | (packet[offset + 1]! << 8);
    const opcode = packet[offset + 2]!;
    const attrId = packet[offset + 4]! | (packet[offset + 5]! << 8);

    switch (opcode) {
      case OPCode.ReadRequest:
        this.sendReportData(transId, attrId);
        return;
      case OPCode.WriteRequest: {
        const data = packet.slice(offset + ATTRIBUTE_ACTION_SIZE);
        this.handleWrite(attrId, data);
        this.sendReportData(transId, attrId);
        return;
      }
      case OPCode.SubscribeRequest:
        if (attrId === AttributeId.Voltages) this.voltageSubscribed = true;
        else this.otherSubscriptions.add(attrId);
        this.sendReportData(transId, attrId);
        return;
      default:
        log.warn('unknown opcode:', opcode);
    }
  }

  private handleWrite(attrId: number, data: Uint8Array): void {
    if (attrId === AttributeId.IntensityPercent) {
      const v = decodeUInt1(data);
      if (v !== null) this.applyIntensity(v);
    } else if (attrId === AttributeId.PlayPauseStop) {
      const v = decodeUTF8String(data);
      if (v === 'play') {
        this.state.playState = PlayState.Playing;
        this.voltage.setPlaying(true);
      } else if (v === 'pause') {
        this.state.playState = PlayState.Paused;
        this.voltage.setPlaying(false);
      } else if (v === 'stop') {
        this.state.playState = PlayState.Stopped;
        this.voltage.setPlaying(false);
      }
    } else if (attrId === AttributeId.BoxName) {
      const v = decodeUTF8String(data);
      if (v !== null) this.state.boxName = v;
    } else if (attrId === AttributeId.CurrentPatternName) {
      const v = decodeUTF8String(data);
      if (v !== null) this.state.currentPattern = v;
    }
  }

  private sendReportData(transId: number, attrId: number): void {
    if (!this.transport) return;
    const payload = this.encodeAttributePayload(attrId);
    if (!payload) return;
    const packet = this.buildAttributePacket(transId, OPCode.ReportData, attrId, payload);
    void this.transport.write(
      encodeFrame({
        serviceType: NST.Datagram,
        frameType: FrameType.Data,
        seq: this.nextTxSeq(),
        payload: packet,
      }),
    );
  }

  private encodeAttributePayload(attrId: number): Uint8Array | null {
    switch (attrId) {
      case AttributeId.Voltages:
        return encodeVoltages(this.voltage.read());
      case AttributeId.IntensityPercent:
        return encodeUInt1(this.state.intensityPercent);
      case AttributeId.PlayPauseStop:
        return encodeUInt1(this.state.playState);
      case AttributeId.BoxName:
        return encodeUTF8String(this.state.boxName);
      case AttributeId.CurrentPatternName:
        return encodeUTF8String(this.state.currentPattern);
      case AttributeId.FirmwareVersion:
        return encodeUTF8String(this.state.firmwareVersion);
      default:
        return null;
    }
  }

  private buildAttributePacket(
    transId: number,
    opcode: number,
    attrId: number,
    payload: Uint8Array,
  ): Uint8Array {
    const total = PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE + payload.length;
    const buf = new Uint8Array(total);
    let i = PACKET_HEADER_SIZE;
    buf[i++] = transId & 0xff;
    buf[i++] = (transId >> 8) & 0xff;
    buf[i++] = opcode & 0xff;
    buf[i++] = 0;
    buf[i++] = attrId & 0xff;
    buf[i++] = (attrId >> 8) & 0xff;
    buf.set(payload, i);
    return buf;
  }

  private nextTxSeq(): number {
    const s = this.txSeq;
    this.txSeq = (this.txSeq + 1) & 0x7;
    return s;
  }

  private notify(attrId: number): void {
    if (!this.transport) return;
    if (attrId !== AttributeId.Voltages && !this.otherSubscriptions.has(attrId)) return;
    const payload = this.encodeAttributePayload(attrId);
    if (!payload) return;
    const packet = this.buildAttributePacket(0, OPCode.ReportData, attrId, payload);
    void this.transport.write(
      encodeFrame({
        serviceType: NST.Datagram,
        frameType: FrameType.Data,
        seq: this.nextTxSeq(),
        payload: packet,
      }),
    );
  }

  private scheduleVoltageEmit(): void {
    const tick = (): void => {
      this.voltage.advance(this.opts.voltageEmitIntervalMs);
      if (this.voltageSubscribed) this.notify(AttributeId.Voltages);
      this.clock.scheduleIn(this.opts.voltageEmitIntervalMs, tick);
    };
    this.clock.scheduleIn(this.opts.voltageEmitIntervalMs, tick);
  }
}

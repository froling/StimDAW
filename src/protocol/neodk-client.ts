import { encodeFrame, FrameParser } from './frame';
import {
  ATTRIBUTE_ACTION_SIZE,
  AttributeId,
  Encoding,
  FrameType,
  NST,
  OPCode,
  PACKET_HEADER_SIZE,
} from './opcodes';
import {
  decodeUInt1,
  decodeUTF8String,
  decodeVoltages,
  encodeUInt1,
  encodeUTF8String,
  type Voltages,
} from './attributes';
import { encodeDebugCommand } from './debug-cli';
import { TypedEventEmitter } from './typed-emitter';
import { createLogger } from '../log';
import type { Transport } from '../transport/transport';

const log = createLogger('client');

export type PlayStateLabel = 'undefined' | 'stopped' | 'paused' | 'playing';
const PLAY_STATE_LABELS: PlayStateLabel[] = ['undefined', 'stopped', 'paused', 'playing'];

export interface NeoDKClientEvents extends Record<string, unknown[]> {
  connected: [];
  disconnected: [];
  error: [Error];
  voltages: [Voltages];
  intensity: [number];
  playState: [PlayStateLabel];
  pattern: [string];
  boxName: [string];
  debug: [string];
}

/**
 * High-level facade over the NeoDK protocol. UI subscribes to events;
 * stores.svelte.ts adapts these to Svelte 5 runes (per A3=A: EventEmitter
 * core, Svelte adapter at the UI edge — protocol stays framework-free).
 */
export class NeoDKClient extends TypedEventEmitter<NeoDKClientEvents> {
  private parser = new FrameParser();
  private unsubscribe: (() => void) | null = null;
  private txSeq = 0;
  private transId = 1959;
  private connected = false;

  constructor(private transport: Transport) {
    super();
  }

  /** Open transport + send Sync frame. Resolves when transport open. */
  async connect(): Promise<void> {
    this.unsubscribe = this.transport.on((event) => {
      if (event.type === 'data') this.handleBytes(event.bytes);
      else if (event.type === 'open') this.onOpen();
      else if (event.type === 'close') this.onClose();
      else if (event.type === 'error') this.emit('error', event.error);
    });
    await this.transport.open();
  }

  async disconnect(): Promise<void> {
    await this.transport.close();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Reads / Writes / Subscribes ──────────────────────────────────────────

  async readAttribute(id: AttributeId): Promise<void> {
    await this.sendDatagram(OPCode.ReadRequest, id);
  }

  async writeIntensity(percent: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    await this.sendDatagram(OPCode.WriteRequest, AttributeId.IntensityPercent, encodeUInt1(clamped));
  }

  async writeBoxName(name: string): Promise<void> {
    await this.sendDatagram(OPCode.WriteRequest, AttributeId.BoxName, encodeUTF8String(name));
  }

  async writePatternName(name: string): Promise<void> {
    await this.sendDatagram(OPCode.WriteRequest, AttributeId.CurrentPatternName, encodeUTF8String(name));
  }

  async writePlayState(state: 'play' | 'pause' | 'stop'): Promise<void> {
    await this.sendDatagram(OPCode.WriteRequest, AttributeId.PlayPauseStop, encodeUTF8String(state));
  }

  async subscribe(id: AttributeId): Promise<void> {
    await this.sendDatagram(OPCode.SubscribeRequest, id);
  }

  /** Send a Debug NST text command (e.g. "/0", "/b", "/n"). */
  async sendDebug(cmd: string): Promise<void> {
    await this.transport.write(encodeDebugCommand(cmd, this.nextSeq()));
  }

  /**
   * Send raw IntensityPercent write that bypasses any wrapping (used by
   * STOP-watchdog and ramp-controller). Same wire format, just lower-level.
   */
  async writeIntensityRaw(percent: number): Promise<void> {
    await this.writeIntensity(percent);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async sendDatagram(opcode: number, attrId: number, payload?: Uint8Array): Promise<void> {
    const data = payload ?? new Uint8Array(0);
    const total = PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE + data.length;
    const buf = new Uint8Array(total);
    let i = PACKET_HEADER_SIZE;
    const t = this.transId++;
    buf[i++] = t & 0xff;
    buf[i++] = (t >> 8) & 0xff;
    buf[i++] = opcode & 0xff;
    buf[i++] = 0;
    buf[i++] = attrId & 0xff;
    buf[i++] = (attrId >> 8) & 0xff;
    buf.set(data, i);
    await this.transport.write(
      encodeFrame({
        serviceType: NST.Datagram,
        frameType: FrameType.Data,
        seq: this.nextSeq(),
        payload: buf,
      }),
    );
  }

  private nextSeq(): number {
    const s = this.txSeq;
    this.txSeq = (this.txSeq + 1) & 0x7;
    return s;
  }

  private onOpen(): void {
    this.connected = true;
    this.emit('connected');
    // Send Sync frame to reset firmware sequence (matches neodk.js behavior)
    void this.transport.write(
      encodeFrame({
        serviceType: NST.Debug,
        frameType: FrameType.Sync,
        seq: this.nextSeq(),
      }),
    );
  }

  private onClose(): void {
    this.connected = false;
    this.emit('disconnected');
  }

  private handleBytes(bytes: Uint8Array): void {
    for (const frame of this.parser.push(bytes)) {
      if (frame.frameType === FrameType.Ack) continue;
      if (frame.frameType === FrameType.Sync) continue;
      if (frame.frameType !== FrameType.Data) continue;

      if (frame.serviceType === NST.Debug) {
        const text = new TextDecoder().decode(frame.payload).trimEnd();
        this.emit('debug', text);
        continue;
      }

      if (frame.serviceType !== NST.Datagram) continue;
      const offset = PACKET_HEADER_SIZE;
      if (frame.payload.length < offset + ATTRIBUTE_ACTION_SIZE) continue;
      const opcode = frame.payload[offset + 2]!;
      const attrId = frame.payload[offset + 4]! | (frame.payload[offset + 5]! << 8);
      if (opcode !== OPCode.ReportData) continue;
      const data = frame.payload.slice(PACKET_HEADER_SIZE + ATTRIBUTE_ACTION_SIZE);
      this.dispatchAttribute(attrId, data);
    }
  }

  private dispatchAttribute(attrId: number, data: Uint8Array): void {
    switch (attrId) {
      case AttributeId.Voltages: {
        const v = decodeVoltages(data);
        if (v) this.emit('voltages', v);
        return;
      }
      case AttributeId.IntensityPercent: {
        const v = decodeUInt1(data);
        if (v !== null) this.emit('intensity', v);
        return;
      }
      case AttributeId.PlayPauseStop: {
        const v = decodeUInt1(data);
        if (v !== null && v >= 0 && v < PLAY_STATE_LABELS.length) {
          this.emit('playState', PLAY_STATE_LABELS[v]!);
        }
        return;
      }
      case AttributeId.CurrentPatternName: {
        const v = decodeUTF8String(data);
        if (v !== null) this.emit('pattern', v);
        return;
      }
      case AttributeId.BoxName: {
        const v = decodeUTF8String(data);
        if (v !== null) this.emit('boxName', v);
        return;
      }
      default:
        log.debug('unhandled attribute', attrId);
    }
  }
}

/** Avoid unused-import warning for Encoding while building debug commands. */
export const _ = Encoding.UnsignedInt1;

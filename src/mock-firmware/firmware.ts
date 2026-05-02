import { encodeFrame, FrameParser } from '../protocol/frame';
import {
  ATTRIBUTE_ACTION_SIZE,
  AttributeId,
  Encoding,
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
import {
  decodeDescriptor,
  DESCRIPTOR_MAX_SIZE,
  DescriptorDecodeError,
  type PtDescriptor,
} from '../protocol/descriptor';
import { createLogger } from '../log';
import { SimClock } from './sim-clock';
import { VoltageSim } from './voltage-sim';
import { type FirmwareState, PlayState, createInitialState } from './state';
import { PtQueue, type QueueFreeSpace, ShortCircuitError } from './pt-queue';
import type { Transport } from '../transport/transport';

const log = createLogger('mock-fw');

export interface MockFirmwareOptions {
  /** Voltage emit interval in simulated ms. Default 100. */
  voltageEmitIntervalMs?: number;
  /** Auto-start the simulation clock in real-time mode. Default true. */
  realtime?: boolean;
}

/**
 * Tracker-row för dispatched descriptor — används av csv-export (replay test)
 * och getDispatchedDescriptors() (integrationstester).
 */
export interface DispatchedDescriptor {
  readonly descriptor: PtDescriptor;
  /** Sim-time vid dispatch i mikrosekunder. */
  readonly dispatchedAtMicros: number;
  /** Sub-queue 0 eller 1 (polarity-bit). */
  readonly queueIdx: 0 | 1;
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
  private ptQueue = new PtQueue();
  private dispatched: DispatchedDescriptor[] = [];
  /**
   * Generation counter — bumpas vid drain. Schedulerade events captures sin
   * generation och no-op:ar om aktuell !== captured (descriptor draina'd
   * mellan enqueue och fire). Detta ersätter en manuell event-cancellation,
   * SimClock har ingen sådan API.
   */
  private ptQueueGeneration = 0;

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
    // Inget tick-based dispatcher behövs — varje enqueue schedulerar sin
    // egen dispatch-event vid descriptor.startTimeMicros (event-driven).
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

  /**
   * Notifiera voltage-sim om puls-fire från host-sidans emit-stream.
   * Per BETA_OSCILLOSCOPE.md (eng-review T2): mock simulerar Vcap-dipp
   * vid varje puls + recovery via existing intensity-baseline-RC-modell.
   *
   * Anropas av stores.svelte.ts emit-sink (mixer + pattern-runner) vid
   * varje dispatched descriptor. wallNowMicros ger oss tids-bas för dipp-
   * recovery-modell.
   */
  onPulseFired(
    desc: import('../protocol/descriptor').PtDescriptor,
    _wallNowMicros: number,
  ): void {
    // Real firmware ankrar voltage-sim till playState. Host-emit-mode (pattern-
    // runner / mixer) sätter aldrig playState eftersom vi inte kör Invoke START.
    // Treat aktiv emit-stream som "playing" så voltage-sim:s RC-modell laddar
    // mot intensity-target. onPulseFired drar sen ner Vcap per puls och låter
    // RC-recovery fylla på baseline mellan pulserna.
    this.voltage.setPlaying(true);
    this.voltage.onPulseFired(desc);
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
        // STOP per outside-voice #5: dräna queue så pending descriptors inte
        // dispatchas efter stop. CSV-spår kvar för debug (dispatched-buffer).
        this.drainPtQueue();
      }
    } else if (attrId === AttributeId.BoxName) {
      const v = decodeUTF8String(data);
      if (v !== null) this.state.boxName = v;
    } else if (attrId === AttributeId.CurrentPatternName) {
      const v = decodeUTF8String(data);
      if (v !== null) this.state.currentPattern = v;
    } else if (attrId === AttributeId.PtDescriptorQueue) {
      this.handlePtDescriptorWrite(data);
    }
  }

  /**
   * Dekoda inkommande descriptor-bytes, enqueue:a i sub-queue, och schemalägg
   * dispatch via SimClock vid descriptor.startTimeMicros.
   * Tysta varningar vid decode-fel eller short-circuit (matchar firmware
   * PE_NONE-beteende där fel tyst loggas och dropas).
   */
  private handlePtDescriptorWrite(data: Uint8Array): void {
    let descriptor: PtDescriptor;
    try {
      descriptor = decodeDescriptor(data);
    } catch (e) {
      if (e instanceof DescriptorDecodeError) {
        log.warn('PtDescriptor decode failed:', e.message);
        return;
      }
      throw e;
    }

    let accepted = false;
    let queueIdx: 0 | 1 = 0;
    try {
      const result = this.ptQueue.enqueue(descriptor);
      accepted = result.accepted;
      queueIdx = result.queueIdx as 0 | 1;
      if (result.accepted) {
        log.debug(
          `PtQueue enqueue seq=${descriptor.sequenceNumber} q${result.queueIdx} (free=${result.freeAfter})`,
        );
      } else {
        log.warn(
          `PtQueue overflow seq=${descriptor.sequenceNumber} q${result.queueIdx} dropped`,
        );
      }
    } catch (e) {
      if (e instanceof ShortCircuitError) {
        log.warn(`PtQueue rejected: ${e.message}`);
        return;
      }
      throw e;
    }
    // Notify host om free-space efter enqueue (även vid drop, så host kan re-evaluera).
    this.notifyPtQueueFreeSpace();
    if (accepted) {
      this.scheduleDescriptorDispatch(descriptor, queueIdx);
    }
  }

  /**
   * Schemalägg dispatch av en specifik descriptor vid dess startTimeMicros.
   * Detta speglar firmware sequencer.c:s scheduleFirstBurst/scheduleNextBurst
   * som anropar BSP_startSequencerClock(start_time_µs) — dispatch sker exakt
   * vid descriptorns angivna tid, inte tick-aligned.
   *
   * Generation-pattern: capture aktuell generation. Om drainPtQueue() bumpar
   * generationen mellan enqueue och fire blir den schemalagda eventen no-op
   * (descriptorn dräna's). Detta är vår event-cancellation eftersom SimClock
   * inte har en sådan API.
   *
   * Past-due descriptors (startTime < simNow) clampas till simNow så de
   * dispatchas vid nästa advance. Real firmware skulle returnera
   * PE_BAD_TIMESTAMP men för mock-α2 är clampning tillräckligt; framtida
   * replay-test kan tillsätta strikt validering.
   */
  private scheduleDescriptorDispatch(descriptor: PtDescriptor, queueIdx: 0 | 1): void {
    const generation = this.ptQueueGeneration;
    const startTimeMs = descriptor.startTimeMicros / 1000;
    const nowMs = this.clock.getTime();
    const fireAtMs = Math.max(startTimeMs, nowMs);
    this.clock.scheduleAt(fireAtMs, () => {
      // Drained mellan enqueue och fire → event invalideras
      if (generation !== this.ptQueueGeneration) return;
      const head = this.ptQueue.dequeue(queueIdx);
      if (!head) return; // belt-and-suspenders, gen-check borde redan ha fångat detta
      // dispatchedAtMicros == clock.getTime() vid fire == fireAtMs * 1000.
      // För future-startTime är detta exakt descriptor.startTimeMicros.
      // För past-due (clampad) är detta nowMs när clock advance:as fram.
      this.dispatched.push({
        descriptor: head,
        dispatchedAtMicros: this.clock.getTime() * 1000,
        queueIdx,
      });
      this.notifyPtQueueFreeSpace();
    });
  }

  /**
   * Encode + emit PtDescriptorQueue free-space notification.
   * Format matchar firmware sequencer.c:447 — uint16_t[2] LE wrapped i
   * EE_BYTES_1LEN. Värden = bytes-free per sub-queue (slots × max descriptor size).
   */
  private notifyPtQueueFreeSpace(): void {
    if (!this.transport) return;
    if (!this.otherSubscriptions.has(AttributeId.PtDescriptorQueue)) return;
    const free = this.ptQueue.freeSpace();
    const payload = encodePtQueueFreeSpace(free);
    const packet = this.buildAttributePacket(
      0,
      OPCode.ReportData,
      AttributeId.PtDescriptorQueue,
      payload,
    );
    void this.transport.write(
      encodeFrame({
        serviceType: NST.Datagram,
        frameType: FrameType.Data,
        seq: this.nextTxSeq(),
        payload: packet,
      }),
    );
  }

  /**
   * Drain queue + invalidate pending dispatch-events + notify free-space.
   * Anropas från STOP-flödet (PlayPauseStop "stop") och kan triggas externt
   * via public drainPtQueue() för testbarhet.
   *
   * Generation-bumpen invaliderar alla schemalagda dispatch-events som
   * captures'ade tidigare generation — de no-op:ar när de fire:as. Detta
   * matchar firmware-beteende där PtdQueue_clear följt av sequencerstop
   * drar bort pending bursts.
   */
  drainPtQueue(): number {
    const dropped = this.ptQueue.drain();
    this.ptQueueGeneration++;
    this.notifyPtQueueFreeSpace();
    return dropped;
  }

  /** Snapshot av dispatched-buffer för CSV-export och tester. */
  getDispatchedDescriptors(): readonly DispatchedDescriptor[] {
    return this.dispatched;
  }

  /** Töm dispatched-buffer (test-helper). */
  resetDispatched(): void {
    this.dispatched = [];
  }

  /** Aktuell free-space per sub-queue (test-helper). */
  getPtQueueFreeSpace(): QueueFreeSpace {
    return this.ptQueue.freeSpace();
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
      case AttributeId.PtDescriptorQueue:
        return encodePtQueueFreeSpace(this.ptQueue.freeSpace());
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

/**
 * Encode QueueFreeSpace till wire-format som matchar firmware
 * sequencer.c:447 — uint16_t[2] LE wrapped i Encoding.Bytes_1Len.
 *
 * Layout: [marker=0x10, len=4, q0_lo, q0_hi, q1_lo, q1_hi]
 * Värden = bytes-free per sub-queue (slots × DESCRIPTOR_MAX_SIZE).
 *
 * Standalone så host (NeoDKClient) och tester kan dela samma kodning.
 */
export function encodePtQueueFreeSpace(free: QueueFreeSpace): Uint8Array {
  const q0Bytes = free.q0 * DESCRIPTOR_MAX_SIZE;
  const q1Bytes = free.q1 * DESCRIPTOR_MAX_SIZE;
  return new Uint8Array([
    Encoding.Bytes_1Len,
    4,
    q0Bytes & 0xff,
    (q0Bytes >>> 8) & 0xff,
    q1Bytes & 0xff,
    (q1Bytes >>> 8) & 0xff,
  ]);
}

/**
 * Decode wire-format → QueueFreeSpace. Returnerar null vid bad payload.
 * Används för host-side decoding (NeoDKClient → events) och replay-tester.
 */
export function decodePtQueueFreeSpace(payload: Uint8Array): QueueFreeSpace | null {
  if (payload.length < 6 || payload[0] !== Encoding.Bytes_1Len || payload[1] !== 4) return null;
  const q0Bytes = payload[2]! | (payload[3]! << 8);
  const q1Bytes = payload[4]! | (payload[5]! << 8);
  return {
    q0: Math.floor(q0Bytes / DESCRIPTOR_MAX_SIZE),
    q1: Math.floor(q1Bytes / DESCRIPTOR_MAX_SIZE),
  };
}

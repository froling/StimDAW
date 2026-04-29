import { crc8, crc16ccitt } from './crc';
import {
  FRAME_HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  type FrameType,
  type NST,
} from './opcodes';

export interface ParsedFrame {
  serviceType: NST;
  frameType: FrameType;
  ackFlag: boolean;
  seq: number;
  ack: number;
  payload: Uint8Array;
}

export interface EncodeFrameOpts {
  serviceType: NST;
  frameType: FrameType;
  seq: number;
  ackFlag?: boolean;
  ack?: number;
  payload?: Uint8Array;
}

/** Encode a frame: header + payload + CRC8/CRC16. */
export function encodeFrame(opts: EncodeFrameOpts): Uint8Array {
  const payload = opts.payload ?? new Uint8Array(0);
  if (payload.length > MAX_PAYLOAD_SIZE) {
    throw new Error(`Payload too large: ${payload.length} > ${MAX_PAYLOAD_SIZE}`);
  }
  const frame = new Uint8Array(FRAME_HEADER_SIZE + payload.length);
  frame[0] =
    ((opts.serviceType & 0x3) << 4) |
    ((opts.frameType & 0x7) << 1) |
    (opts.ackFlag ? 1 : 0);
  frame[1] = ((opts.seq & 0x7) << 3) | ((opts.ack ?? 0) & 0x7);
  frame[2] = (payload.length >> 8) & 0xff;
  frame[3] = payload.length & 0xff;
  frame[4] = 0;
  frame[5] = crc8(frame.slice(0, 5));
  let crc = crc16ccitt(frame.slice(0, 6));
  frame.set(payload, FRAME_HEADER_SIZE);
  if (payload.length > 0) crc = crc16ccitt(payload, crc);
  frame[6] = (crc >> 8) & 0xff;
  frame[7] = crc & 0xff;
  return frame;
}

/**
 * Stateful frame parser. Web Serial chunks split frames mid-byte;
 * this buffers partial frames and returns complete ones as they assemble.
 *
 * Bad header CRC8 → shift buffer left and retry (matches NeoDK reference).
 * Bad payload CRC16 → drop frame entirely.
 */
export class FrameParser {
  private buf = new Uint8Array(FRAME_HEADER_SIZE + MAX_PAYLOAD_SIZE);
  private bufLen = 0;
  private payloadSize = 0;

  /** Feed bytes from the wire. Returns 0+ complete frames. */
  push(chunk: Uint8Array): ParsedFrame[] {
    const frames: ParsedFrame[] = [];
    for (let i = 0; i < chunk.length; i++) {
      this.buf[this.bufLen++] = chunk[i]!;
      const result = this.tryFinalize();
      if (result) frames.push(result);
    }
    return frames;
  }

  private tryFinalize(): ParsedFrame | null {
    if (this.bufLen < FRAME_HEADER_SIZE) return null;
    if (this.bufLen === FRAME_HEADER_SIZE) {
      // Validate header CRC8
      const expected = crc8(this.buf.slice(0, 5));
      if (this.buf[5] !== expected) {
        // Shift left by 1 and retry header on next byte
        this.bufLen -= 1;
        for (let i = 0; i < this.bufLen; i++) this.buf[i] = this.buf[i + 1]!;
        return null;
      }
      this.payloadSize = (this.buf[2]! << 8) | this.buf[3]!;
      if (this.payloadSize > MAX_PAYLOAD_SIZE) {
        this.bufLen = 0;
        this.payloadSize = 0;
        return null;
      }
      if (this.payloadSize === 0) return this.finalize();
      return null;
    }
    if (this.bufLen === FRAME_HEADER_SIZE + this.payloadSize) {
      return this.finalize();
    }
    return null;
  }

  private finalize(): ParsedFrame | null {
    // Verify CRC16 over bytes 0..5 + payload
    const expected = (this.buf[6]! << 8) | this.buf[7]!;
    let crc = crc16ccitt(this.buf.slice(0, 6));
    if (this.payloadSize > 0) {
      crc = crc16ccitt(
        this.buf.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + this.payloadSize),
        crc,
      );
    }
    if (crc !== expected) {
      this.reset();
      return null;
    }
    const serviceType = ((this.buf[0]! >> 4) & 0x3) as NST;
    const frameType = ((this.buf[0]! >> 1) & 0x7) as FrameType;
    const ackFlag = (this.buf[0]! & 0x1) === 1;
    const seq = (this.buf[1]! >> 3) & 0x7;
    const ack = this.buf[1]! & 0x7;
    const payload = this.buf.slice(
      FRAME_HEADER_SIZE,
      FRAME_HEADER_SIZE + this.payloadSize,
    );
    this.reset();
    return { serviceType, frameType, ackFlag, seq, ack, payload };
  }

  private reset(): void {
    this.bufLen = 0;
    this.payloadSize = 0;
  }
}

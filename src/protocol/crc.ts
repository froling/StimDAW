import crc8Fn from 'crc/crc8';
import crc16ccittFn from 'crc/crc16ccitt';

/** CRC-8 (poly 0x07, init 0). Verified vs NeoDK reference impl in tests. */
export function crc8(bytes: Uint8Array): number {
  return crc8Fn(bytes);
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF). Continuation via `previous`. */
export function crc16ccitt(bytes: Uint8Array, previous?: number): number {
  return crc16ccittFn(bytes, previous);
}

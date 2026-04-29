/**
 * CRC-8 (poly 0x07, init 0) and CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF).
 *
 * Hand-rolled to match reference/NeoDK/UI/neodk.js byte-for-byte. Verified by
 * property tests in test/protocol/crc.test.ts against a copy of NeoDK's own
 * implementation across 200+ random inputs.
 *
 * History: originally planned to use npm `crc` (decision D1=A in CEO review)
 * but the package's TS types don't accept Uint8Array, and adding a Buffer
 * polyfill for browser bundle was not worth it for ~20 lines of stable
 * algorithm. The decision was walked back during eng-review implementation.
 */

export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let k = 0; k < 8; k++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

export function crc16ccitt(bytes: Uint8Array, previous?: number): number {
  let crc = previous ?? 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]! << 8;
    for (let k = 0; k < 8; k++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

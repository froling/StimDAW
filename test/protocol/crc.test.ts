import { test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { crc8, crc16ccitt } from '../../src/protocol/crc';

// Reference implementations copied byte-for-byte from reference/NeoDK/UI/neodk.js.
// Property tests below verify our crc.ts wrapper matches NeoDK's hand-rolled algorithm.
function crc8Reference(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let k = 0; k < 8; k++) {
      crc = crc & 0x80 ? (crc << 1) ^ 0x07 : crc << 1;
    }
  }
  return crc & 0xff;
}

function crc16Reference(data: Uint8Array, init: number): number {
  let crc = init;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]! << 8;
    for (let k = 0; k < 8; k++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return crc & 0xffff;
}

test('crc8: matches NeoDK reference for arbitrary inputs', () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 0, maxLength: 256 }), (bytes) => {
      expect(crc8(bytes)).toBe(crc8Reference(bytes));
    }),
    { numRuns: 200 },
  );
});

test('crc16ccitt: single-pass matches NeoDK reference (init 0xFFFF)', () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 0, maxLength: 256 }), (bytes) => {
      expect(crc16ccitt(bytes)).toBe(crc16Reference(bytes, 0xffff));
    }),
    { numRuns: 200 },
  );
});

test('crc16ccitt: continuation matches reference', () => {
  fc.assert(
    fc.property(
      fc.uint8Array({ minLength: 0, maxLength: 64 }),
      fc.uint8Array({ minLength: 0, maxLength: 64 }),
      (a, b) => {
        const ours = crc16ccitt(b, crc16ccitt(a));
        const ref = crc16Reference(b, crc16Reference(a, 0xffff));
        expect(ours).toBe(ref);
      },
    ),
    { numRuns: 100 },
  );
});

test('crc8: empty input is 0', () => {
  expect(crc8(new Uint8Array(0))).toBe(0);
});

test('crc16ccitt: empty input is 0xFFFF', () => {
  expect(crc16ccitt(new Uint8Array(0))).toBe(0xffff);
});

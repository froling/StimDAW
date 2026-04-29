import { test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { encodeFrame, FrameParser } from '../../src/protocol/frame';
import { FrameType, NST } from '../../src/protocol/opcodes';

test('frame: encode + parse round-trip preserves payload, seq, types', () => {
  fc.assert(
    fc.property(
      fc.uint8Array({ minLength: 0, maxLength: 200 }),
      fc.integer({ min: 0, max: 7 }),
      (payload, seq) => {
        const frame = encodeFrame({
          serviceType: NST.Datagram,
          frameType: FrameType.Data,
          seq,
          payload,
        });
        const parser = new FrameParser();
        const parsed = parser.push(frame);
        expect(parsed.length).toBe(1);
        expect(parsed[0]!.payload).toEqual(payload);
        expect(parsed[0]!.seq).toBe(seq);
        expect(parsed[0]!.frameType).toBe(FrameType.Data);
        expect(parsed[0]!.serviceType).toBe(NST.Datagram);
      },
    ),
    { numRuns: 80 },
  );
});

test('frame: parser reassembles chunks split mid-byte (Web Serial edge case)', () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const frame = encodeFrame({
    serviceType: NST.Datagram,
    frameType: FrameType.Data,
    seq: 3,
    payload,
  });
  const parser = new FrameParser();
  const allFrames = [];
  // Feed 3 bytes at a time
  for (let i = 0; i < frame.length; i += 3) {
    allFrames.push(...parser.push(frame.slice(i, i + 3)));
  }
  expect(allFrames.length).toBe(1);
  expect(allFrames[0]!.payload).toEqual(payload);
});

test('frame: parser drops frames with corrupted payload CRC', () => {
  const frame = encodeFrame({
    serviceType: NST.Datagram,
    frameType: FrameType.Data,
    seq: 0,
    payload: new Uint8Array([10, 20, 30]),
  });
  const corrupted = new Uint8Array(frame);
  corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1]! ^ 0xff) & 0xff;
  const parser = new FrameParser();
  expect(parser.push(corrupted).length).toBe(0);
});

test('frame: empty-payload frame parses correctly', () => {
  const frame = encodeFrame({
    serviceType: NST.Debug,
    frameType: FrameType.Sync,
    seq: 5,
  });
  expect(frame.length).toBe(8);
  const parsed = new FrameParser().push(frame);
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.payload.length).toBe(0);
  expect(parsed[0]!.seq).toBe(5);
  expect(parsed[0]!.frameType).toBe(FrameType.Sync);
});

test('frame: parser recovers from leading garbage bytes', () => {
  const frame = encodeFrame({
    serviceType: NST.Datagram,
    frameType: FrameType.Data,
    seq: 1,
    payload: new Uint8Array([42, 43]),
  });
  const garbage = new Uint8Array([0xff, 0xee, 0xdd]);
  const stream = new Uint8Array(garbage.length + frame.length);
  stream.set(garbage, 0);
  stream.set(frame, garbage.length);
  const parsed = new FrameParser().push(stream);
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.payload).toEqual(new Uint8Array([42, 43]));
});

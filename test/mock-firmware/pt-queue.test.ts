import { test, expect } from 'bun:test';
import {
  PtQueue,
  QUEUE_COUNT,
  SLOTS_PER_QUEUE,
  ShortCircuitError,
} from '../../src/mock-firmware/pt-queue';
import type { PtDescriptor } from '../../src/protocol/descriptor';

function makeDesc(seq: number, phase = 0, pos = 1, neg = 2): PtDescriptor {
  return {
    meta: 0,
    sequenceNumber: seq,
    phase,
    pulseWidthMicros: 144,
    startTimeMicros: 0,
    electrodeSet: [pos, neg],
    nrOfPulses: 4,
    paceQuarterMs: 100,
    amplitude: 128,
    deltaPulseWidthQuarters: 0,
    deltaPaceMicros: 0,
  };
}

test('constants: 2 queues × 20 slots', () => {
  expect(QUEUE_COUNT).toBe(2);
  expect(SLOTS_PER_QUEUE).toBe(20);
});

test('enqueue: phase bit 0 = 0 → queue 0', () => {
  const q = new PtQueue();
  const result = q.enqueue(makeDesc(1, 0));
  expect(result.accepted).toBe(true);
  expect(result.queueIdx).toBe(0);
  expect(q.size(0)).toBe(1);
  expect(q.size(1)).toBe(0);
});

test('enqueue: phase bit 0 = 1 → queue 1', () => {
  const q = new PtQueue();
  q.enqueue(makeDesc(1, 1));
  expect(q.size(0)).toBe(0);
  expect(q.size(1)).toBe(1);
});

test('enqueue: shortage throws ShortCircuitError', () => {
  const q = new PtQueue();
  // pos=AC=5, neg=AB=3 → A delas → shortage
  expect(() => q.enqueue(makeDesc(1, 0, 5, 3))).toThrow(ShortCircuitError);
});

test('enqueue: shortage error includes pos/neg/intersect', () => {
  const q = new PtQueue();
  try {
    q.enqueue(makeDesc(1, 0, 5, 3));
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(ShortCircuitError);
    if (e instanceof Error) {
      expect(e.message).toContain('pos=5');
      expect(e.message).toContain('neg=3');
      expect(e.message).toContain('intersect=1');
    }
  }
});

test('overflow: tyst drop när queue full', () => {
  const q = new PtQueue();
  for (let i = 0; i < SLOTS_PER_QUEUE; i++) {
    expect(q.enqueue(makeDesc(i, 0)).accepted).toBe(true);
  }
  // Slot 21 → drop
  const overflow = q.enqueue(makeDesc(99, 0));
  expect(overflow.accepted).toBe(false);
  expect(overflow.freeAfter).toBe(-1);
  expect(q.size(0)).toBe(SLOTS_PER_QUEUE);
});

test('overflow på en queue påverkar inte den andra', () => {
  const q = new PtQueue();
  for (let i = 0; i < SLOTS_PER_QUEUE; i++) {
    q.enqueue(makeDesc(i, 0));
  }
  expect(q.enqueue(makeDesc(50, 0)).accepted).toBe(false);
  // queue 1 fortfarande tom → accepterar
  expect(q.enqueue(makeDesc(51, 1)).accepted).toBe(true);
});

test('dequeue: FIFO order', () => {
  const q = new PtQueue();
  q.enqueue(makeDesc(1, 0));
  q.enqueue(makeDesc(2, 0));
  q.enqueue(makeDesc(3, 0));
  expect(q.dequeue(0)?.sequenceNumber).toBe(1);
  expect(q.dequeue(0)?.sequenceNumber).toBe(2);
  expect(q.dequeue(0)?.sequenceNumber).toBe(3);
  expect(q.dequeue(0)).toBeUndefined();
});

test('peek: returnerar oldest utan ta bort', () => {
  const q = new PtQueue();
  q.enqueue(makeDesc(1, 0));
  q.enqueue(makeDesc(2, 0));
  expect(q.peek(0)?.sequenceNumber).toBe(1);
  expect(q.size(0)).toBe(2); // peek not destructive
});

test('freeSpace: per sub-queue', () => {
  const q = new PtQueue();
  q.enqueue(makeDesc(1, 0));
  q.enqueue(makeDesc(2, 0));
  q.enqueue(makeDesc(3, 1));
  const free = q.freeSpace();
  expect(free.q0).toBe(SLOTS_PER_QUEUE - 2);
  expect(free.q1).toBe(SLOTS_PER_QUEUE - 1);
});

test('drain: rensar båda queues, returnerar antal', () => {
  const q = new PtQueue();
  for (let i = 0; i < 5; i++) q.enqueue(makeDesc(i, i % 2));
  const dropped = q.drain();
  expect(dropped).toBe(5);
  expect(q.total()).toBe(0);
});

test('drain på tom queue → 0 dropped', () => {
  const q = new PtQueue();
  expect(q.drain()).toBe(0);
});

test('STOP-during-stuck-queue scenario (outside-voice #5)', () => {
  // Fyll queue till overflow, sedan drain (simulerar STOP)
  const q = new PtQueue();
  for (let i = 0; i < SLOTS_PER_QUEUE; i++) q.enqueue(makeDesc(i, 0));
  expect(q.enqueue(makeDesc(99, 0)).accepted).toBe(false);
  // STOP fires drain
  const dropped = q.drain();
  expect(dropped).toBe(SLOTS_PER_QUEUE);
  expect(q.total()).toBe(0);
  // Efter drain ska enqueue funka igen
  expect(q.enqueue(makeDesc(100, 0)).accepted).toBe(true);
});

/**
 * PT-descriptor queue — replikerar firmware sequencer.c:s 2× sub-queue.
 *
 * 2 sub-queues à 20 slots (per spec). Varje descriptor routas till sub-queue
 * baserat på phase-bit 0 (polarity). NeoDK har 1 transformer så stage-bits 2..1
 * ignoreras — bara polarity styr queue-val.
 *
 * Per outside-voice finding #4: disjunkts-rule (electrodeSet pos & neg === 0)
 * enforcas vid enqueue() som belt-and-suspenders. Builder validerar redan,
 * detta är defense in depth.
 *
 * Overflow: tyst drop + log warn (per spec PE_BUFFER_FULL). Host ska tracka
 * pending-tid och inte överbelasta — overflow indikerar bug.
 */
import type { PtDescriptor } from '../protocol/descriptor';
import { createLogger } from '../log';

const log = createLogger('pt-queue');

export const QUEUE_COUNT = 2;
export const SLOTS_PER_QUEUE = 20;

export class ShortCircuitError extends Error {
  constructor(pos: number, neg: number) {
    super(
      `Short circuit: electrodeSet pos & neg overlap (pos=${pos}, neg=${neg}, intersect=${pos & neg})`,
    );
    this.name = 'ShortCircuitError';
  }
}

export interface EnqueueResult {
  /** True om descriptor hamnade i queue, false vid overflow. */
  readonly accepted: boolean;
  /** Sub-queue index 0 eller 1 (polarity-bit). */
  readonly queueIdx: number;
  /** Antal lediga slots i queueIdx EFTER enqueue. -1 vid overflow. */
  readonly freeAfter: number;
}

export interface QueueFreeSpace {
  readonly q0: number;
  readonly q1: number;
}

export class PtQueue {
  private queues: PtDescriptor[][] = [[], []];

  /**
   * Lägg in descriptor i rätt sub-queue baserat på phase-bit 0.
   * Throws ShortCircuitError vid disjunkt-violation.
   * Returns { accepted: false } vid overflow (tyst drop).
   */
  enqueue(descriptor: PtDescriptor): EnqueueResult {
    const [pos, neg] = descriptor.electrodeSet;
    if ((pos & neg) !== 0) {
      throw new ShortCircuitError(pos, neg);
    }
    const queueIdx = descriptor.phase & 0x01;
    const queue = this.queues[queueIdx]!;
    if (queue.length >= SLOTS_PER_QUEUE) {
      log.warn(
        `Queue ${queueIdx} full (${SLOTS_PER_QUEUE} slots), dropping descriptor seq=${descriptor.sequenceNumber}`,
      );
      return { accepted: false, queueIdx, freeAfter: -1 };
    }
    queue.push(descriptor);
    return {
      accepted: true,
      queueIdx,
      freeAfter: SLOTS_PER_QUEUE - queue.length,
    };
  }

  /** Plocka ut FIFO oldest från given sub-queue. Undefined om tom. */
  dequeue(queueIdx: 0 | 1): PtDescriptor | undefined {
    return this.queues[queueIdx]?.shift();
  }

  /** Peek på oldest utan att ta bort. */
  peek(queueIdx: 0 | 1): PtDescriptor | undefined {
    return this.queues[queueIdx]?.[0];
  }

  /** Storlek av sub-queue. */
  size(queueIdx: 0 | 1): number {
    return this.queues[queueIdx]?.length ?? 0;
  }

  /** Total descriptors över båda queues. */
  total(): number {
    return this.queues[0]!.length + this.queues[1]!.length;
  }

  /** Free space per sub-queue. Skickas via AI_PT_DESCRIPTOR_QUEUE-notify. */
  freeSpace(): QueueFreeSpace {
    return {
      q0: SLOTS_PER_QUEUE - this.queues[0]!.length,
      q1: SLOTS_PER_QUEUE - this.queues[1]!.length,
    };
  }

  /**
   * Drain alla descriptors. Anropas av STOP-flödet — krav per outside-voice
   * finding #5: STOP måste tömma queue innan pending dispatches.
   */
  drain(): number {
    const dropped = this.total();
    this.queues = [[], []];
    return dropped;
  }
}

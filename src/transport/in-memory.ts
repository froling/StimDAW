import type { Transport, TransportEvent, TransportListener } from './transport';

class InMemoryTransport implements Transport {
  private peer: InMemoryTransport | null = null;
  private listeners = new Set<TransportListener>();
  private isOpen = false;

  setPeer(peer: InMemoryTransport): void {
    this.peer = peer;
  }

  async open(): Promise<void> {
    if (this.isOpen) return;
    this.isOpen = true;
    this.emit({ type: 'open' });
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.emit({ type: 'close' });
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.isOpen) throw new Error('Transport not open');
    if (!this.peer) throw new Error('No peer connected');
    // Deliver async to simulate I/O latency
    queueMicrotask(() => {
      if (this.peer && this.peer.isOpen) this.peer.deliver(bytes);
    });
  }

  on(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private deliver(bytes: Uint8Array): void {
    this.emit({ type: 'data', bytes });
  }

  private emit(event: TransportEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** Two paired in-memory transports — bytes written to one appear on the other. */
export function createInMemoryPair(): { client: Transport; firmware: Transport } {
  const a = new InMemoryTransport();
  const b = new InMemoryTransport();
  a.setPeer(b);
  b.setPeer(a);
  return { client: a, firmware: b };
}

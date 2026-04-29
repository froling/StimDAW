export type TransportEvent =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'data'; bytes: Uint8Array }
  | { type: 'error'; error: Error };

export type TransportListener = (event: TransportEvent) => void;

/**
 * Bidirectional byte channel. Implementations: in-memory.ts (mock-FW pair) and
 * web-serial.ts (real NeoDK over USB-Serial — added when hw arrives).
 *
 * Transport-interfacet existerar för att mock vs Web Serial ska kunna bytas
 * bakom NeoDK-clienten. INGEN abstraktion för andra protokoll/enheter — det är
 * en hård non-goal (se docs/STIMDAW_BRIEF.md).
 */
export interface Transport {
  /** Open the channel. Idempotent. */
  open(): Promise<void>;
  /** Close the channel. Idempotent. */
  close(): Promise<void>;
  /** Write bytes. Throws if closed. */
  write(bytes: Uint8Array): Promise<void>;
  /** Subscribe to events. Returns unsubscribe fn. */
  on(listener: TransportListener): () => void;
}

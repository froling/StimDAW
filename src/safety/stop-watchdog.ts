/**
 * STOP watchdog — om STOP-write inte ACK:ar inom timeout, surface loud failure.
 * Per outside-voice finding #3: STOP måste bypassa transport-queue och ha en
 * watchdog så vi inte tysteligen "skickade STOP men det kom aldrig fram".
 *
 * Användning:
 *   const watchdog = new StopWatchdog({ timeoutMs: 1000 });
 *   const result = await watchdog.execute(() => transport.write(stopFrame));
 *   if (!result.success) showLoudFailureUI(result.reason);
 */

export interface StopWatchdogOptions {
  /** Default 1000ms — generous for an in-process or USB-Serial round-trip. */
  timeoutMs?: number;
}

export interface StopResult {
  success: boolean;
  reason?: string;
}

export class StopWatchdog {
  private timeoutMs: number;

  constructor(opts: StopWatchdogOptions = {}) {
    this.timeoutMs = Math.max(0, opts.timeoutMs ?? 1000);
  }

  setTimeout(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.timeoutMs = ms;
  }

  /**
   * Run a STOP write with timeout. Resolves to success/failure status.
   * Does NOT reject — STOP failure must be visible, not crash.
   */
  async execute(write: () => Promise<void>): Promise<StopResult> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<StopResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ success: false, reason: `STOP timeout after ${this.timeoutMs}ms` }),
        this.timeoutMs,
      );
    });
    const action = write()
      .then((): StopResult => ({ success: true }))
      .catch((e): StopResult => ({
        success: false,
        reason: e instanceof Error ? e.message : 'unknown error',
      }));

    const result = await Promise.race([action, timeout]);
    if (timer) clearTimeout(timer);
    return result;
  }
}

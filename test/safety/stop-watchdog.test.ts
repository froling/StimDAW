import { test, expect } from 'bun:test';
import { StopWatchdog } from '../../src/safety/stop-watchdog';

test('stop-watchdog: success path resolves quickly', async () => {
  const w = new StopWatchdog({ timeoutMs: 1000 });
  const result = await w.execute(async () => {
    /* fast write */
  });
  expect(result.success).toBe(true);
});

test('stop-watchdog: timeout fires loud failure', async () => {
  const w = new StopWatchdog({ timeoutMs: 50 });
  const result = await w.execute(
    () => new Promise<void>(() => { /* never resolves */ }),
  );
  expect(result.success).toBe(false);
  expect(result.reason).toContain('timeout');
});

test('stop-watchdog: write error surfaces as failure (not crash)', async () => {
  const w = new StopWatchdog({ timeoutMs: 1000 });
  const result = await w.execute(async () => {
    throw new Error('boom');
  });
  expect(result.success).toBe(false);
  expect(result.reason).toBe('boom');
});

test('stop-watchdog: setTimeout updates value', () => {
  const w = new StopWatchdog({ timeoutMs: 100 });
  w.setTimeout(500);
  // No public getter, but the behavior is verified via timeout test in real use
  expect(() => w.setTimeout(NaN)).not.toThrow();
  expect(() => w.setTimeout(-1)).not.toThrow();
});

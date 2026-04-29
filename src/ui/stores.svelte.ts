import { NeoDKClient, type PlayStateLabel } from '../protocol/neodk-client';
import { createInMemoryPair } from '../transport/in-memory';
import { MockFirmware } from '../mock-firmware/firmware';
import { RampController } from '../safety/ramp-controller';
import { MaxCeiling } from '../safety/max-ceiling';
import { StopWatchdog } from '../safety/stop-watchdog';
import { AttributeId } from '../protocol/opcodes';
import type { Voltages } from '../protocol/attributes';
import { loadSettings, saveSettings } from '../fileformat/io';
import { createLogger } from '../log';

const log = createLogger('ui-store');

const VOLTAGE_RING_SIZE = 600;
const DEBUG_LOG_SIZE = 100;
const RAMP_TICK_MS = 100;

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'ramping';

export interface DebugLogEntry {
  ts: number;
  direction: 'sent' | 'received' | 'system';
  text: string;
}

/**
 * Svelte 5 runes adapter over NeoDKClient + safety layer.
 * Per A3=A: protocol stays framework-free; this is the framework-bound edge.
 */
class AppState {
  connection = $state<ConnectionState>('disconnected');
  voltages = $state<Voltages>({ Vbat_mV: 0, Vcap_mV: 0, Iprim_mA: 0 });
  voltageHistory = $state<Voltages[]>([]);
  intensity = $state<number>(0); // last echoed from device
  desiredIntensity = $state<number>(0); // user's slider value
  effectiveIntensity = $state<number>(0); // post-ramp, post-ceiling
  playState = $state<PlayStateLabel>('stopped');
  pattern = $state<string>('');
  ceiling = $state<number>(50);
  rampUpDurationMs = $state<number>(5000);
  rampInfo = $state<{ ramping: boolean; effective: number }>({ ramping: false, effective: 0 });
  debugLog = $state<DebugLogEntry[]>([]);
  lastError = $state<string | null>(null);
}

export const app = new AppState();

// Hydrate persisted settings on module load (per A5=A: säkerhetsdefaults persisterar)
const persisted = loadSettings();
if (persisted) {
  app.rampUpDurationMs = persisted.rampUpDurationMs;
  app.ceiling = persisted.maxCeilingPercent;
}

function persistSettings(): void {
  saveSettings({
    rampUpDurationMs: app.rampUpDurationMs,
    maxCeilingPercent: app.ceiling,
  });
}

let client: NeoDKClient | null = null;
let mockFw: MockFirmware | null = null;
let ramp: RampController | null = null;
let ceiling: MaxCeiling | null = null;
let watchdog: StopWatchdog | null = null;
let rampLoopHandle: ReturnType<typeof setInterval> | null = null;
let lastWrittenIntensity = -1;

function pushDebugLog(entry: DebugLogEntry): void {
  app.debugLog.push(entry);
  if (app.debugLog.length > DEBUG_LOG_SIZE) app.debugLog.shift();
}

export async function connectMock(): Promise<void> {
  if (app.connection !== 'disconnected') return;
  app.connection = 'connecting';
  app.lastError = null;
  pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Connecting to mock NeoDK…' });

  ramp = new RampController({ rampUpDurationMs: app.rampUpDurationMs });
  ceiling = new MaxCeiling(app.ceiling);
  watchdog = new StopWatchdog({ timeoutMs: 1000 });

  const { client: ct, firmware: ft } = createInMemoryPair();
  mockFw = new MockFirmware({ realtime: true, voltageEmitIntervalMs: 100 });
  mockFw.attach(ft);
  await ft.open();

  client = new NeoDKClient(ct);

  client.on('connected', () => {
    app.connection = 'connected';
    ramp?.onConnect(performance.now());
    pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Connected.' });
  });

  client.on('disconnected', () => {
    if (app.connection !== 'disconnected') {
      app.connection = 'disconnected';
      ramp?.onDisconnect();
      pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Disconnected.' });
    }
  });

  client.on('error', (err) => {
    app.lastError = err.message;
    log.error(err);
  });

  client.on('voltages', (v) => {
    app.voltages = v;
    app.voltageHistory.push(v);
    if (app.voltageHistory.length > VOLTAGE_RING_SIZE) app.voltageHistory.shift();
  });

  client.on('intensity', (n) => {
    app.intensity = n;
  });

  client.on('playState', (s) => {
    app.playState = s;
  });

  client.on('pattern', (p) => {
    app.pattern = p;
  });

  client.on('debug', (text) => {
    pushDebugLog({ ts: Date.now(), direction: 'received', text });
  });

  await client.connect();

  // Subscribe to live attributes
  await client.subscribe(AttributeId.Voltages);
  await client.subscribe(AttributeId.IntensityPercent);
  await client.subscribe(AttributeId.PlayPauseStop);
  await client.subscribe(AttributeId.CurrentPatternName);

  startRampLoop();
}

function startRampLoop(): void {
  if (rampLoopHandle !== null) return;
  rampLoopHandle = setInterval(() => {
    if (!ramp || !ceiling || !client) return;
    const now = performance.now();
    const snap = ramp.snapshot(now);
    const safe = ceiling.enforce(snap.effective);
    app.rampInfo = { ramping: snap.ramping, effective: safe };
    app.effectiveIntensity = safe;

    if (snap.ramping && app.connection === 'connected') app.connection = 'ramping';
    else if (!snap.ramping && app.connection === 'ramping') app.connection = 'connected';

    if (safe !== lastWrittenIntensity) {
      lastWrittenIntensity = safe;
      void client.writeIntensity(safe).catch(() => {
        // transport may be closed mid-write — already handled by reconnect flow
      });
    }
  }, RAMP_TICK_MS);
}

function stopRampLoop(): void {
  if (rampLoopHandle !== null) {
    clearInterval(rampLoopHandle);
    rampLoopHandle = null;
  }
  lastWrittenIntensity = -1;
}

export async function disconnect(): Promise<void> {
  stopRampLoop();
  await client?.disconnect();
  mockFw?.detach();
  client = null;
  mockFw = null;
}

export function setDesiredIntensity(value: number): void {
  app.desiredIntensity = value;
  ramp?.setDesired(value);
}

export function setCeiling(value: number): void {
  if (!ceiling) {
    app.ceiling = Math.max(0, Math.min(100, value));
  } else {
    ceiling.set(value);
    app.ceiling = ceiling.get();
  }
  // If desired is now above ceiling, snap it down
  if (app.desiredIntensity > app.ceiling) {
    setDesiredIntensity(app.ceiling);
  }
  persistSettings();
}

export function setRampUpDuration(ms: number): void {
  app.rampUpDurationMs = Math.max(0, ms);
  ramp?.setRampUpDuration(app.rampUpDurationMs);
  persistSettings();
}

export async function sendDebug(cmd: string): Promise<void> {
  if (!client) return;
  pushDebugLog({ ts: Date.now(), direction: 'sent', text: cmd });
  await client.sendDebug(cmd);
}

export async function stop(): Promise<void> {
  ramp?.onStop();
  app.desiredIntensity = 0;
  pushDebugLog({ ts: Date.now(), direction: 'system', text: 'STOP pressed' });
  if (!client || !watchdog) return;
  const result = await watchdog.execute(() => client!.writeIntensity(0));
  if (!result.success) {
    app.lastError = `STOP FAILED: ${result.reason}`;
    pushDebugLog({
      ts: Date.now(),
      direction: 'system',
      text: `STOP FAILED: ${result.reason}`,
    });
  }
}

/** For dev: simulate a transport disconnect — useful for testing ramp-up. */
export async function simulateDisconnect(): Promise<void> {
  pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Simulating disconnect…' });
  await client?.disconnect();
}

/** Re-open the existing transport (in-memory). For dev/disconnect testing. */
export async function reconnectMock(): Promise<void> {
  if (!client) {
    await connectMock();
    return;
  }
  pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Reconnecting…' });
  await client.connect();
}

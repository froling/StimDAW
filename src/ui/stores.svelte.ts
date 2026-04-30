import { NeoDKClient, type PlayStateLabel } from '../protocol/neodk-client';
import { createInMemoryPair } from '../transport/in-memory';
import { MockFirmware, type DispatchedDescriptor } from '../mock-firmware/firmware';
import { RampController } from '../safety/ramp-controller';
import { MaxCeiling } from '../safety/max-ceiling';
import { StopWatchdog } from '../safety/stop-watchdog';
import { AttributeId } from '../protocol/opcodes';
import type { Voltages } from '../protocol/attributes';
import { loadSettings, saveSettings } from '../fileformat/io';
import { createLogger } from '../log';
import { generatePatternDescriptors } from '../patterns/runner';
import { getPatternByName } from '../patterns/builtins';
import { type PatternDef, elconId, uniqueElcons } from '../patterns/types';
import { WaveformGenerator, type WaveformSample } from '../mock-firmware/waveform';
import { exportDispatchedAsCsv } from '../mock-firmware/csv-export';
import { buildCsvFilename } from './csv-filename';

const log = createLogger('ui-store');

const VOLTAGE_RING_SIZE = 600;
const DEBUG_LOG_SIZE = 100;
const RAMP_TICK_MS = 100;
const WAVEFORM_TICK_MS = 30; // 30ms per design-review lock
const WAVEFORM_RING_SIZE = 200; // 6s @ 30ms — matchar approved.html

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

  // ── α2 — pattern + oscilloscope state ──────────────────────────────────
  /** Aktivt pattern (null = idle). */
  currentPattern = $state<PatternDef | null>(null);
  isRunningPattern = $state<boolean>(false);
  /** Per-elconId ringbuffer av samples (för Oscilloscope render). */
  waveformBuffers = $state<Map<string, WaveformSample[]>>(new Map());
  /** Aktuellt sim-time µs — driver rolling x-axis, ticks vid 30Hz. */
  waveformNowMicros = $state<number>(0);
  /** Vilka elcons som ska visas i oscilloscope (eye toggle). */
  visibleElcons = $state<Set<string>>(new Set());
  /** Vilka traces som ritas (amp alltid på, vcap optional, etc.). */
  activeTraces = $state<Set<'amp' | 'vcap'>>(new Set(['amp']));
  /**
   * Host-sidans dispatched-buffer: vad pattern-runnern faktiskt skickade
   * via writePtDescriptor + förväntad sim-tid (descTime). Capped så vi
   * inte blåser upp minnet under långa körningar. Driver CSV-export.
   *
   * OBS: detta är host-sanning (vad host trodde sig skicka), inte
   * firmware-sanning. För mock-läge exponerar MockFirmware.getDispatched-
   * Descriptors() firmware-sidans truth (post-decode, post-enqueue).
   */
  dispatchedDescriptors = $state<DispatchedDescriptor[]>([]);
  /**
   * Loop-mode: när true så repeterar runPattern hela pattern-körningen tills
   * stopPattern triggas. Läses i runPattern's do-while-condition och vid
   * varje iterations start, så användaren kan toggla under körning:
   *   - check while running → forsätt loopa efter aktuell iteration
   *   - uncheck while looping → avsluta efter aktuell iteration
   * I loop-mode bypassas 5-rep-cap:en (kör pattern.nrOfReps fullt per iter).
   */
  loopPattern = $state<boolean>(false);
}

/** Cap så att en tre-timmars patternrun inte sväller minnet — räcker för dev. */
const DISPATCHED_BUFFER_CAP = 5000;

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
  stopWaveformLoop();
  if (patternRunCancel) patternRunCancel.cancelled = true;
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

// ──────────────────────────────────────────────────────────────────────────
// α2 — Pattern runner + waveform shadow render
// ──────────────────────────────────────────────────────────────────────────

let waveformGen: WaveformGenerator | null = null;
let waveformLoopHandle: ReturnType<typeof setInterval> | null = null;
let patternRunCancel: { cancelled: boolean } | null = null;

function startWaveformLoop(): void {
  if (waveformLoopHandle !== null) return;
  if (!waveformGen) waveformGen = new WaveformGenerator();
  waveformLoopHandle = setInterval(() => {
    if (!waveformGen) return;
    const nowMicros = performance.now() * 1000;
    // Update reactive "now" så Oscilloscope kan rolla X-axeln även när
    // inga active descriptors finns (samples-array kan vara tom).
    app.waveformNowMicros = nowMicros;

    const rampPercent = ramp?.snapshot(performance.now()).effective ?? 0;
    const ceilingPercent = ceiling?.get() ?? app.ceiling;
    const samples = waveformGen.sample(nowMicros, { rampPercent, ceilingPercent });

    if (samples.length === 0) return;

    // Push samples till ringbuffer per elcon — Map mutation
    const next = new Map(app.waveformBuffers);
    for (const sample of samples) {
      let buf = next.get(sample.elconId);
      if (!buf) {
        buf = [];
      } else {
        buf = buf.slice(); // copy för immutability
      }
      buf.push(sample);
      if (buf.length > WAVEFORM_RING_SIZE) buf.shift();
      next.set(sample.elconId, buf);
    }
    app.waveformBuffers = next;
  }, WAVEFORM_TICK_MS);
}

function stopWaveformLoop(): void {
  if (waveformLoopHandle !== null) {
    clearInterval(waveformLoopHandle);
    waveformLoopHandle = null;
  }
}

/**
 * Run named pattern. Genererar descriptors host-side, skickar via NeoDKClient,
 * shadow-renderar lokalt i WaveformGenerator för Oscilloscope.
 */
export async function runPattern(patternName: string): Promise<void> {
  if (!client) {
    pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Cannot run pattern: not connected' });
    return;
  }
  if (app.isRunningPattern) {
    pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Pattern already running' });
    return;
  }
  const pattern = getPatternByName(patternName);
  if (!pattern) {
    pushDebugLog({ ts: Date.now(), direction: 'system', text: `Unknown pattern: ${patternName}` });
    return;
  }

  app.currentPattern = pattern;
  app.isRunningPattern = true;
  pushDebugLog({
    ts: Date.now(),
    direction: 'system',
    text: `Run pattern "${pattern.name}" (${pattern.elcons.length} elcons, ${pattern.nrOfReps} reps)`,
  });

  // Auto-show alla unika elcons i pattern
  const visibleSet = new Set<string>();
  for (const elcon of uniqueElcons(pattern.elcons)) {
    visibleSet.add(elconId(elcon));
  }
  app.visibleElcons = visibleSet;

  // Reset waveform-gen + dispatched-buffer för clean run
  if (!waveformGen) waveformGen = new WaveformGenerator();
  waveformGen.reset();
  app.waveformBuffers = new Map();
  app.dispatchedDescriptors = [];
  startWaveformLoop();

  const cancel = { cancelled: false };
  patternRunCancel = cancel;

  try {
    const startMicros = performance.now() * 1000;
    let descTime = startMicros;
    // Cumulativa state-variabler för descriptor-stream-continuity över
    // loop-iterations: descriptor.startTimeMicros och sequenceNumber måste
    // vara monotont stigande så mock-firmware:s SimClock-scheduling och
    // firmware-sidans seq-tracking funkar korrekt över loop-gränser.
    let cumulativeStartTimeMicros = 0;
    let cumulativeSeqNr = 0;

    do {
      // Per-iteration rep-cap. Loop-läge använder 1 rep så repetitionen
      // syns tätt; one-shot använder upp till 5 reps för längre play
      // utan att man måste hålla i Stop. Bypassad cap (= pattern.nrOfReps)
      // ger 15+ min/iter på Toggle 300× → man tror loopen är trasig.
      // Re-evalueras per iter så toggle av checkbox under körning tar
      // effekt på nästa iteration.
      const maxReps = app.loopPattern
        ? Math.min(1, pattern.nrOfReps)
        : Math.min(5, pattern.nrOfReps);
      for (const desc of generatePatternDescriptors(pattern, {
        maxReps,
        initialStartTimeMicros: cumulativeStartTimeMicros,
        initialSequenceNumber: cumulativeSeqNr,
      })) {
        if (cancel.cancelled) break;
        try {
          await client.writePtDescriptor(desc);
        } catch (e) {
          log.warn('writePtDescriptor failed:', e);
          cancel.cancelled = true;
          break;
        }
        // Shadow-render: feed descriptor til local waveform-gen vid sin sim-time
        waveformGen.enqueueDescriptor(desc, descTime);
        // Track för CSV-export — ringbuffer-cap så långa körningar inte blåser
        // upp minnet. queueIdx härleds från phase-bit (samma som firmware).
        const queueIdx = (desc.phase & 0x01) as 0 | 1;
        const next = app.dispatchedDescriptors.slice();
        next.push({ descriptor: desc, dispatchedAtMicros: descTime, queueIdx });
        if (next.length > DISPATCHED_BUFFER_CAP) {
          next.splice(0, next.length - DISPATCHED_BUFFER_CAP);
        }
        app.dispatchedDescriptors = next;
        const durationMicros = desc.nrOfPulses * desc.paceQuarterMs * 250;
        descTime += durationMicros;
        cumulativeStartTimeMicros = desc.startTimeMicros + durationMicros;
        cumulativeSeqNr = (desc.sequenceNumber + 1) & 0xff;
        // Vänta så pattern playas i realtid (annars firar alla descriptors instant)
        await sleep(durationMicros / 1000);
      }
    } while (app.loopPattern && !cancel.cancelled);
  } finally {
    if (patternRunCancel === cancel) patternRunCancel = null;
    app.isRunningPattern = false;
    pushDebugLog({ ts: Date.now(), direction: 'system', text: `Pattern "${pattern.name}" finished` });
  }
}

/** Stop currently-running pattern. Cancels the run loop, drains waveform-gen. */
export function stopPattern(): void {
  if (patternRunCancel) {
    patternRunCancel.cancelled = true;
  }
  app.isRunningPattern = false;
  waveformGen?.reset();
  pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Pattern stopped' });
}

/** Toggle visibility of a single elcon row in oscilloscope. */
export function toggleElconVisibility(eId: string): void {
  const next = new Set(app.visibleElcons);
  if (next.has(eId)) next.delete(eId);
  else next.add(eId);
  app.visibleElcons = next;
}

/** Toggle a trace (amp/vcap) on/off across all rows. */
export function toggleTrace(trace: 'amp' | 'vcap'): void {
  const next = new Set(app.activeTraces);
  if (next.has(trace)) next.delete(trace);
  else next.add(trace);
  app.activeTraces = next;
}

// Re-export så UI kan importera från en plats; pure-helper bor i csv-filename.ts
// för att undvika Svelte 5 $state-runtime i tester.
export { buildCsvFilename };

/**
 * Bygg CSV-payload för aktuell dispatched-buffer + förslag på filnamn.
 * Separerad från download-trigger så att action:en är testbar utan DOM.
 *
 * Returnerar null om buffern är tom — UI ska disable knappen då.
 */
export function buildDispatchedCsv(now: Date = new Date()): { filename: string; csv: string } | null {
  if (app.dispatchedDescriptors.length === 0) return null;
  const csv = exportDispatchedAsCsv(app.dispatchedDescriptors);
  return {
    filename: buildCsvFilename(app.currentPattern?.name, now),
    csv,
  };
}

/**
 * UI-action: triggar nedladdning av CSV via temporär anchor.
 * No-op om dispatched-buffern är tom.
 */
export function exportDispatchedCsv(): void {
  const built = buildDispatchedCsv();
  if (!built) {
    pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Export CSV: empty buffer' });
    return;
  }
  const blob = new Blob([built.csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = built.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  pushDebugLog({
    ts: Date.now(),
    direction: 'system',
    text: `Export CSV: ${built.filename} (${app.dispatchedDescriptors.length} descriptors)`,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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
import type { PatternDef } from '../patterns/types';
import { exportDispatchedAsCsv } from '../mock-firmware/csv-export';
import { buildCsvFilename } from './csv-filename';
import { SynthEngine } from '../synth/synth-engine';
import { RealtimeClock } from '../synth/clock';
import { synth, attachEngineHooks } from './synth/synth-store.svelte';
import { computeDispatchRate } from '../synth/dispatch-stats';
import { buildFrame } from '../oscilloscope/frame-builder';
import { buildPolarFrame, type PolarFrame } from '../oscilloscope/polar-frame';
import { buildEnvelopeFrame, type EnvelopeFrame } from '../oscilloscope/envelope-frame';
import type { OscilloscopeFrame } from '../oscilloscope/types';
import type { VoltageSample } from '../oscilloscope/voltage-state';

const log = createLogger('ui-store');

const VOLTAGE_RING_SIZE = 600;
const DEBUG_LOG_SIZE = 100;
const RAMP_TICK_MS = 100;

/**
 * Frame-builder tick rate per BETA_OSCILLOSCOPE.md (eng-review T1 locked):
 * 30Hz = 33ms. Kapar Svelte-rerender-rate till skärm-refresh oavsett
 * emit-rate. Frame-builder är pure function; tick är enbart driver.
 */
const FRAME_TICK_MS = 33;

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
  /**
   * Historik av voltage-samples med wall-time-stamp. Drives Monitor-
   * sparklines (Vbat/Vcap/Iprim) OCH Oscilloscope primary-voltage-trace.
   * VoltageSample extends Voltages med wallTimeMicros — Monitor läser
   * samma fält som tidigare (Vbat_mV/Vcap_mV/Iprim_mA) utan ändring.
   */
  voltageHistory = $state.raw<VoltageSample[]>([]);
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

  // ── β Oscilloscope state (post BETA_OSCILLOSCOPE.md rewrite) ──────────
  /** Aktivt pattern (null = idle). */
  currentPattern = $state<PatternDef | null>(null);
  isRunningPattern = $state<boolean>(false);
  /**
   * Wire-truth-buffer: descriptors host emittat via writePtDescriptor.
   * `$state.raw` skippar Svelte deep proxy — undviker overhead vid 200Hz
   * emit-rate (eng-review T1 locked). Mutationer kräver reassign;
   * frame-builder läser hela arrayen vid 30Hz tick.
   */
  dispatchedDescriptors = $state.raw<DispatchedDescriptor[]>([]);
  /**
   * Stream-time origin (descriptor.startTimeMicros vid första dispatch).
   * Wall-clock origin (`performance.now()*1000` vid samma moment) för
   * voltage-history-translation. Båda null tills första dispatch.
   * PURGE vid runPattern/startMixer start.
   */
  streamTimeOriginMicros = $state<number | null>(null);
  streamOriginWallMicros = $state<number | null>(null);
  /**
   * Aktuell frame för Oscilloscope-komponenten. Legacy per-puls-format,
   * behålls tills komponenten tagits bort i nästa pass.
   */
  oscilloscopeFrame = $state<OscilloscopeFrame | null>(null);
  /**
   * Envelope-frame: per-electrode amplitude-curve över 6s. Visar känsla
   * (intensity + polaritet) över tid, smooth — inte diskreta pulser.
   */
  envelopeFrame = $state<EnvelopeFrame | null>(null);
  /**
   * Polar-frame: spatial flow-vy. Arcs mellan + och − elektroder under
   * senaste 1s med age-fade. Pattern-rörelser (Circle, Toggle) syns
   * som visuella riktnings-mönster.
   */
  polarFrame = $state<PolarFrame | null>(null);
  /**
   * Loop-mode: när true så repeterar runPattern hela pattern-körningen tills
   * stopPattern triggas. Läses i runPattern's do-while-condition och vid
   * varje iterations start, så användaren kan toggla under körning:
   *   - check while running → forsätt loopa efter aktuell iteration
   *   - uncheck while looping → avsluta efter aktuell iteration
   * I loop-mode bypassas 5-rep-cap:en (kör pattern.nrOfReps fullt per iter).
   */
  loopPattern = $state<boolean>(false);
  /** β.0 mixer engine running. Toggleras av startMixer/stopMixer. */
  isMixerRunning = $state<boolean>(false);
  /**
   * Logga varje emittad descriptor till browser-konsolen (filterbar via
   * `[synth-emit]` prefix i DevTools). Plus periodic summary till
   * app.debugLog (synlig i CLI-panelen) varje sekund.
   * Off by default — minst 40 emits/s från aktiv mixer skulle flooda console.
   */
  logDescriptors = $state<boolean>(false);
  /**
   * Descriptors per sekund (rolling 1s window). Updated 30Hz från frame-tick.
   * Indikator för dataström-tryck mot firmware. PtQueue 20 slots × 2 phases →
   * DPS > 60 riskerar overflow. Visas tone-coded i MonitorBar.
   */
  dispatchRateHz = $state<number>(0);
  /** Approximativ wire-bandwidth (bytes/sec) baserat på dispatchRateHz. */
  dispatchBytesPerSec = $state<number>(0);
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
  // 33ms ≈ 30Hz, matchar frame-builder så voltage-trace inte blir chunky
  mockFw = new MockFirmware({ realtime: true, voltageEmitIntervalMs: 33 });
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
    const sample: VoltageSample = {
      Vbat_mV: v.Vbat_mV,
      Vcap_mV: v.Vcap_mV,
      Iprim_mA: v.Iprim_mA,
      wallTimeMicros: performance.now() * 1000,
    };
    // $state.raw kräver reassign — append + cap via slice
    const next = app.voltageHistory.length >= VOLTAGE_RING_SIZE
      ? [...app.voltageHistory.slice(1), sample]
      : [...app.voltageHistory, sample];
    app.voltageHistory = next;
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
  stopFrameTimer();
  if (patternRunCancel) patternRunCancel.cancelled = true;
  // Stop synth-engine annars fortsätter pending events fire (sink no-op:ar
  // utan client) och app.isMixerRunning förblir true → UI visar "running"
  // i evighet efter disconnect.
  synthEngine?.stop();
  app.isMixerRunning = false;
  synthEngine = null;
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
// β Oscilloscope — frame-builder pipeline
//
// Per BETA_OSCILLOSCOPE.md (eng-review locked 2026-05-02):
//   - Frame-timer kör vid 30Hz, oberoende av emit-rate
//   - Emit-sink lägger till app.dispatchedDescriptors (pendingDispatched för
//     batchad reassign med $state.raw)
//   - Frame-timer drainar pendingDispatched, anropar buildFrame, sätter
//     app.oscilloscopeFrame
//   - Stream-origin sätts vid första dispatch, PURGE vid stream-start
//   - Ingen waveform-shadow-render, ingen sample-tick — Vcap från
//     real telemetri via voltageHistory
// ──────────────────────────────────────────────────────────────────────────

let frameTimerHandle: ReturnType<typeof setInterval> | null = null;
let patternRunCancel: { cancelled: boolean } | null = null;

/**
 * Pending dispatched-buffer. Emit-sink push:ar hit synchronously vid 200Hz.
 * Frame-timer drainar var 33ms (60-100x per sec) och reassign:ar till
 * app.dispatchedDescriptors ($state.raw så ingen deep-proxy-overhead).
 */
const pendingDispatched: DispatchedDescriptor[] = [];

function startFrameTimer(): void {
  if (frameTimerHandle !== null) return;
  frameTimerHandle = setInterval(runFrameTick, FRAME_TICK_MS);
}

function stopFrameTimer(): void {
  if (frameTimerHandle !== null) {
    clearInterval(frameTimerHandle);
    frameTimerHandle = null;
  }
  pendingDispatched.length = 0;
}

function runFrameTick(): void {
  // 1. Drain pendingDispatched → app.dispatchedDescriptors
  if (pendingDispatched.length > 0) {
    const next = app.dispatchedDescriptors.length > 0
      ? [...app.dispatchedDescriptors, ...pendingDispatched]
      : [...pendingDispatched];
    if (next.length > DISPATCHED_BUFFER_CAP) {
      next.splice(0, next.length - DISPATCHED_BUFFER_CAP);
    }
    app.dispatchedDescriptors = next;
    pendingDispatched.length = 0;
  }

  // Update dispatch-rate metrics (rolling 1s window)
  const wallNowMicros = performance.now() * 1000;
  const rate = computeDispatchRate(app.dispatchedDescriptors, wallNowMicros);
  app.dispatchRateHz = rate.dps;
  app.dispatchBytesPerSec = rate.bytesPerSec;

  // 2. Bygg ny frame om vi har stream-origin
  if (
    app.streamTimeOriginMicros === null ||
    app.streamOriginWallMicros === null
  ) {
    // Ingen aktiv stream — bevarar senaste frame om sådan finns, annars null
    return;
  }
  const streamNow = wallNowMicros - app.streamOriginWallMicros;
  const inputs = {
    dispatched: app.dispatchedDescriptors,
    voltageHistory: app.voltageHistory,
    streamOriginMicros: app.streamTimeOriginMicros,
    streamOriginWallMicros: app.streamOriginWallMicros,
    streamNowMicros: streamNow,
  };
  app.oscilloscopeFrame = buildFrame(inputs);
  app.envelopeFrame = buildEnvelopeFrame(inputs);
  app.polarFrame = buildPolarFrame(inputs);
}

/**
 * Anropas av emit-sinks (pattern-runner + synth-engine). Sätter origin
 * vid första dispatch, push:ar till pendingDispatched för frame-tick-drain.
 */
function recordDispatch(desc: { phase: number; startTimeMicros: number }, fullDispatch: DispatchedDescriptor): void {
  if (app.streamTimeOriginMicros === null) {
    app.streamTimeOriginMicros = desc.startTimeMicros;
    app.streamOriginWallMicros = fullDispatch.dispatchedAtMicros;
  }
  pendingDispatched.push(fullDispatch);
  if (pendingDispatched.length > DISPATCHED_BUFFER_CAP) {
    pendingDispatched.splice(0, pendingDispatched.length - DISPATCHED_BUFFER_CAP);
  }
}

/**
 * PURGE vid stream-start. Eng-review locked: löser origin-reset-inkonsistens
 * genom att rensa buffer + null:a origin samtidigt. Frame återskapas vid
 * första nya dispatch.
 */
function purgeOscilloscopeState(): void {
  app.dispatchedDescriptors = [];
  pendingDispatched.length = 0;
  app.streamTimeOriginMicros = null;
  app.streamOriginWallMicros = null;
  app.oscilloscopeFrame = null;
  app.envelopeFrame = null;
  app.polarFrame = null;
  app.dispatchRateHz = 0;
  app.dispatchBytesPerSec = 0;
}

/**
 * Run named pattern. Genererar descriptors host-side, skickar via NeoDKClient.
 * Oscilloscope renderar via frame-builder från `app.dispatchedDescriptors`.
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

  // PURGE oscilloscope-state + start frame-timer för clean run
  purgeOscilloscopeState();
  startFrameTimer();

  const cancel = { cancelled: false };
  patternRunCancel = cancel;

  try {
    let cumulativeStartTimeMicros = 0;
    let cumulativeSeqNr = 0;

    do {
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
        const enqueueAtMicros = performance.now() * 1000;
        const queueIdx = (desc.phase & 0x01) as 0 | 1;
        recordDispatch(desc, {
          descriptor: desc,
          dispatchedAtMicros: enqueueAtMicros,
          queueIdx,
        });
        // Notifiera mock-firmware:s voltage-sim om puls-fire (samma som mixer sink)
        mockFw?.onPulseFired?.(desc, enqueueAtMicros);
        const durationMicros = desc.nrOfPulses * desc.paceQuarterMs * 250;
        cumulativeStartTimeMicros = desc.startTimeMicros + durationMicros;
        cumulativeSeqNr = (desc.sequenceNumber + 1) & 0xff;
        await sleep(durationMicros / 1000);
      }
    } while (app.loopPattern && !cancel.cancelled);
  } finally {
    if (patternRunCancel === cancel) patternRunCancel = null;
    app.isRunningPattern = false;
    pushDebugLog({ ts: Date.now(), direction: 'system', text: `Pattern "${pattern.name}" finished` });
  }
}

/** Stop currently-running pattern. Cancels the run loop. Frame-timer fortsätter. */
export function stopPattern(): void {
  if (patternRunCancel) {
    patternRunCancel.cancelled = true;
  }
  app.isRunningPattern = false;
  pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Pattern stopped' });
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
  // Frame-tickern reassign:ar app.dispatchedDescriptors var 33ms; om user
  // klickar Export mellan tickar finns senaste pulser i pendingDispatched.
  // Inkludera dem i snapshot så CSV alltid är komplett up-to-the-moment.
  const tail = pendingDispatched.length > 0
    ? [...app.dispatchedDescriptors, ...pendingDispatched]
    : app.dispatchedDescriptors;
  if (tail.length === 0) return null;
  return {
    filename: buildCsvFilename(app.currentPattern?.name, now),
    csv: exportDispatchedAsCsv(tail),
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
    text: `Export CSV: ${built.filename} (${app.dispatchedDescriptors.length + pendingDispatched.length} descriptors)`,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ──────────────────────────────────────────────────────────────────────────
// β.0 — Mixer / Synth engine bridge
// ──────────────────────────────────────────────────────────────────────────

let synthEngine: SynthEngine | null = null;
const synthEmitLog = createLogger('synth-emit');

/** Periodic summary state — accumulerar emits, flushar var 1000ms till debug-log. */
const emitSummary = {
  count: 0,
  pwMin: Infinity,
  pwMax: -Infinity,
  paceMin: Infinity,
  paceMax: -Infinity,
  ampMin: Infinity,
  ampMax: -Infinity,
  flushTimer: null as ReturnType<typeof setTimeout> | null,
};

function flushEmitSummary(): void {
  if (emitSummary.count === 0) return;
  const text =
    `mixer emit: ${emitSummary.count} descriptors ` +
    `· pw ${emitSummary.pwMin}-${emitSummary.pwMax}µs ` +
    `· pace ${(emitSummary.paceMin / 1000).toFixed(1)}-${(emitSummary.paceMax / 1000).toFixed(1)}ms ` +
    `· amp ${emitSummary.ampMin}-${emitSummary.ampMax}`;
  pushDebugLog({ ts: Date.now(), direction: 'sent', text });
  emitSummary.count = 0;
  emitSummary.pwMin = Infinity;
  emitSummary.pwMax = -Infinity;
  emitSummary.paceMin = Infinity;
  emitSummary.paceMax = -Infinity;
  emitSummary.ampMin = Infinity;
  emitSummary.ampMax = -Infinity;
}

function logDescriptorEmit(desc: import('../protocol/descriptor').PtDescriptor): void {
  if (!app.logDescriptors) return;
  const paceMicros = desc.paceQuarterMs * 250;
  // Per-emit verbose till console (filterbar i DevTools via 'synth-emit')
  synthEmitLog.debug(
    `seq=${desc.sequenceNumber} phase=${desc.phase & 0x01} ` +
      `ec=[${desc.electrodeSet[0]},${desc.electrodeSet[1]}] ` +
      `pw=${desc.pulseWidthMicros}µs pace=${paceMicros}µs amp=${desc.amplitude}`,
  );
  // Accumulera summary för debug-log-panel (var 1000ms)
  emitSummary.count++;
  emitSummary.pwMin = Math.min(emitSummary.pwMin, desc.pulseWidthMicros);
  emitSummary.pwMax = Math.max(emitSummary.pwMax, desc.pulseWidthMicros);
  emitSummary.paceMin = Math.min(emitSummary.paceMin, paceMicros);
  emitSummary.paceMax = Math.max(emitSummary.paceMax, paceMicros);
  emitSummary.ampMin = Math.min(emitSummary.ampMin, desc.amplitude);
  emitSummary.ampMax = Math.max(emitSummary.ampMax, desc.amplitude);
  if (emitSummary.flushTimer === null) {
    emitSummary.flushTimer = setTimeout(() => {
      emitSummary.flushTimer = null;
      flushEmitSummary();
    }, 1000);
  }
}

/**
 * Lazy-init synth-engine på first start. RealtimeClock i prod, sink skickar
 * via client.writePtDescriptor + recordDispatch (frame-builder läser från
 * app.dispatchedDescriptors).
 */
function ensureSynthEngine(): SynthEngine {
  if (synthEngine) return synthEngine;
  synthEngine = new SynthEngine({
    clock: new RealtimeClock(),
    getState: () => synth.current,
    sink: (desc) => {
      if (!client) return;
      void client.writePtDescriptor(desc).catch((e) => log.warn('writePtDescriptor failed:', e));
      const wallNow = performance.now() * 1000;
      const queueIdx = (desc.phase & 0x01) as 0 | 1;
      recordDispatch(desc, {
        descriptor: desc,
        dispatchedAtMicros: wallNow,
        queueIdx,
      });
      // Notifiera mock-firmware:s voltage-sim om puls-fire för Vcap-dipp
      mockFw?.onPulseFired?.(desc, wallNow);
      // Optional debug-log per descriptor (gated på app.logDescriptors toggle)
      logDescriptorEmit(desc);
    },
    getRampPercent: () => ramp?.snapshot(performance.now()).effective ?? 0,
    getCeilingPercent: () => ceiling?.get() ?? app.ceiling,
  });
  // Wire upp engine-hooks så synth-store kan re-schedule channels vid
  // add/re-enable under aktiv run (annars permanent tystnad — se synth-store).
  attachEngineHooks({
    ensureChannelScheduled: (id) => synthEngine?.ensureChannelScheduled(id),
  });
  return synthEngine;
}

export function startMixer(): void {
  if (!client || app.connection === 'disconnected') {
    pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Cannot start mixer: not connected' });
    return;
  }
  if (app.isMixerRunning) return;

  // PURGE oscilloscope-state + start frame-timer för clean run
  purgeOscilloscopeState();
  startFrameTimer();

  const engine = ensureSynthEngine();
  engine.start();
  app.isMixerRunning = true;
  pushDebugLog({
    ts: Date.now(),
    direction: 'system',
    text: `Mixer started (${synth.current.channels.length} channels, ${synth.current.lfos.length} LFOs)`,
  });
}

export function stopMixer(): void {
  if (synthEngine) {
    synthEngine.stop();
  }
  app.isMixerRunning = false;
  // Frame-tickern fortsätter köra så Oscilloscope håller kvar senaste frame.
  // Ingen waveform-gen att resetta — frame-builder-pipeline ersatte den.
  pushDebugLog({ ts: Date.now(), direction: 'system', text: 'Mixer stopped' });
  // Flush ev. ackumulerad summary direkt vid stop
  if (emitSummary.flushTimer !== null) {
    clearTimeout(emitSummary.flushTimer);
    emitSummary.flushTimer = null;
  }
  flushEmitSummary();
}

export function setLogDescriptors(enabled: boolean): void {
  app.logDescriptors = enabled;
  pushDebugLog({
    ts: Date.now(),
    direction: 'system',
    text: enabled ? 'Descriptor log enabled' : 'Descriptor log disabled',
  });
}

/**
 * Dev-only test-hooks exponerade på `window.__stimdaw_test`.
 *
 * Importeras endast i DEV-mode via main.ts (gated på `import.meta.env.DEV`).
 * Vite tree-shakar bort hela modulen i production-build.
 *
 * Designad för att låta AI/RPA-tooling driva komplexa interaktioner som är
 * fragila via DOM-events:
 *   - Knob drag (custom pointer-events)
 *   - Cable drag-drop (port → knob hit-test)
 *   - State-inspection (synth.current, app.dispatchedDescriptors)
 *
 * Best-practice motiv (per Fas 1-rec): stable test-API som inte bryts av
 * CSS-refactor eller animations-changes. Alternativ till brittle DOM-queries
 * + raw mouse-events.
 *
 * Naming: __stimdaw_test (double underscore prefix = intern, inte public API).
 * Globalt strukturerat objekt så det syns i DevTools console autocomplete.
 */
import * as synthStore from '../ui/synth/synth-store.svelte';
import * as appStore from '../ui/stores.svelte';
import { ElectrodeMask, type Elcon } from '../patterns/types';
import type { MixerState, WaveShape } from '../synth/types';
import type { DispatchedDescriptor } from '../mock-firmware/firmware';
import type { OscilloscopeFrame } from '../oscilloscope/types';

export interface TestHelpers {
  /** Version-marker så test-skript kan checka API-kompat. */
  readonly version: '0.1.0';

  // ── State inspection ────────────────────────────────────────────
  getMixerState(): MixerState;
  getActiveSource(): 'idle' | 'pattern-runner' | 'mixer';
  getConnectionState(): string;
  getIsMixerRunning(): boolean;
  getIsPatternRunning(): boolean;
  getDispatchedDescriptors(): readonly DispatchedDescriptor[];
  getDispatchedCount(): number;
  /** Aktuell Oscilloscope-frame (β post-rewrite). null innan första dispatch. */
  getOscilloscopeFrame(): OscilloscopeFrame | null;
  /** Antal pulser per electrode-rad (A/B/C/D) i aktuell frame — diagnostik. */
  getElectrodePulseCounts(): {
    A: number;
    B: number;
    C: number;
    D: number;
    total: number;
  };
  /** Polaritets-distribution över alla electrode-rader i aktuell frame. */
  getPolarityStats(): { pos: number; neg: number; total: number };

  // ── Mixer actions (delegate till synth-store) ──────────────────
  addChannel(pos?: number, neg?: number): string;
  removeChannel(channelId: string): void;
  addLfo(shape?: WaveShape): string;
  removeLfo(lfoId: string): void;
  setKnobBase(
    channelId: string,
    knobName: 'pulseWidth' | 'pace' | 'amplitude',
    value: number,
  ): void;
  setLfoRate(lfoId: string, rate: number): void;
  setLfoAmount(lfoId: string, amount: number): void;
  setLfoShape(lfoId: string, shape: WaveShape): void;
  setChannelEnabled(channelId: string, enabled: boolean): void;
  addCable(
    lfoId: string,
    channelId: string,
    knobName: 'pulseWidth' | 'pace' | 'amplitude',
    depth?: number,
  ): string;
  removeCable(cableId: string): void;
  setCableDepth(cableId: string, depth: number): void;

  // ── Mixer engine lifecycle ─────────────────────────────────────
  startMixer(): void;
  stopMixer(): void;
  setLogDescriptors(on: boolean): void;
  exportCsv(): void;

  // ── Mode switching ─────────────────────────────────────────────
  setActiveSource(source: 'idle' | 'pattern-runner' | 'mixer'): void;

  // ── Helpers ────────────────────────────────────────────────────
  /** Wait för Svelte/microtask-flushing. RPA: await window.__stimdaw_test.flush() */
  flush(): Promise<void>;
  /** Snapshot all relevant state för debug. */
  snapshot(): {
    mixer: MixerState;
    activeSource: string;
    connection: string;
    isMixerRunning: boolean;
    dispatchedCount: number;
  };
}

export function installTestHelpers(): void {
  if (typeof window === 'undefined') return;

  const helpers: TestHelpers = {
    version: '0.1.0',

    getMixerState: () => synthStore.synth.current,
    getActiveSource: () => synthStore.synth.activeSource,
    getConnectionState: () => appStore.app.connection,
    getIsMixerRunning: () => appStore.app.isMixerRunning,
    getIsPatternRunning: () => appStore.app.isRunningPattern,
    getDispatchedDescriptors: () => appStore.app.dispatchedDescriptors,
    getDispatchedCount: () => appStore.app.dispatchedDescriptors.length,
    getOscilloscopeFrame: () => appStore.app.oscilloscopeFrame,
    getElectrodePulseCounts: () => {
      const frame = appStore.app.oscilloscopeFrame;
      if (!frame) return { A: 0, B: 0, C: 0, D: 0, total: 0 };
      const counts: { A: number; B: number; C: number; D: number; total: number } = {
        A: 0, B: 0, C: 0, D: 0, total: 0,
      };
      for (const row of frame.electrodeRows) {
        const n = row.pulses.length;
        counts[row.electrode] = n;
        counts.total += n;
      }
      return counts;
    },
    getPolarityStats: () => {
      const frame = appStore.app.oscilloscopeFrame;
      if (!frame) return { pos: 0, neg: 0, total: 0 };
      let pos = 0;
      let neg = 0;
      for (const row of frame.electrodeRows) {
        for (const p of row.pulses) {
          if (p.polarity === 'pos') pos++;
          else neg++;
        }
      }
      return { pos, neg, total: pos + neg };
    },

    addChannel: (pos = ElectrodeMask.A, neg = ElectrodeMask.C) => {
      const before = synthStore.synth.current.channels.length;
      synthStore.addChannel([pos, neg] as Elcon);
      const ch = synthStore.synth.current.channels[before];
      if (!ch) throw new Error('addChannel did not produce a new channel');
      return ch.id;
    },
    removeChannel: (id) => synthStore.removeChannel(id),
    addLfo: (shape = 'sine') => {
      const before = synthStore.synth.current.lfos.length;
      synthStore.addLfo(shape);
      const lfo = synthStore.synth.current.lfos[before];
      if (!lfo) throw new Error('addLfo did not produce a new LFO');
      return lfo.id;
    },
    removeLfo: (id) => synthStore.removeLfo(id),
    setKnobBase: (channelId, knobName, value) =>
      synthStore.updateKnobBase(channelId, knobName, value),
    setLfoRate: (id, rate) => synthStore.setLfoRate(id, rate),
    setLfoAmount: (id, amount) => synthStore.setLfoAmount(id, amount),
    setLfoShape: (id, shape) => synthStore.setLfoShape(id, shape),
    setChannelEnabled: (id, enabled) => synthStore.setChannelEnabled(id, enabled),
    addCable: (lfoId, channelId, knobName, depth = 0.5) => {
      const before = synthStore.synth.current.cables.length;
      synthStore.addCable(lfoId, channelId, knobName, depth);
      const cable = synthStore.synth.current.cables[synthStore.synth.current.cables.length - 1];
      if (!cable || synthStore.synth.current.cables.length <= before) {
        throw new Error('addCable did not create a cable (refs may be invalid)');
      }
      return cable.id;
    },
    removeCable: (id) => synthStore.removeCable(id),
    setCableDepth: (id, depth) => synthStore.setCableDepth(id, depth),

    startMixer: () => appStore.startMixer(),
    stopMixer: () => appStore.stopMixer(),
    setLogDescriptors: (on) => appStore.setLogDescriptors(on),
    exportCsv: () => appStore.exportDispatchedCsv(),

    setActiveSource: (source) => synthStore.setActiveSource(source),

    flush: () =>
      new Promise<void>((resolve) => {
        // β.0 fix-2026-05: vänta på rAF eftersom waveform/dispatched batchas
        // genom requestAnimationFrame istället för direkt $state-mutation.
        // Två microtask-hops efter rAF så Svelte $derived/$effect hinner reagera.
        requestAnimationFrame(() => {
          queueMicrotask(() => queueMicrotask(() => resolve()));
        });
      }),

    snapshot: () => ({
      mixer: synthStore.synth.current,
      activeSource: synthStore.synth.activeSource,
      connection: appStore.app.connection,
      isMixerRunning: appStore.app.isMixerRunning,
      dispatchedCount: appStore.app.dispatchedDescriptors.length,
    }),
  };

  // Använd Object.defineProperty så det är icke-enumerable och inte rör
  // production-namespace om någon sniffar window.
  Object.defineProperty(window, '__stimdaw_test', {
    value: helpers,
    writable: false,
    configurable: true,
    enumerable: false,
  });

  // eslint-disable-next-line no-console
  console.info(
    '[stimdaw] test-helpers installed: window.__stimdaw_test (DEV-only). ' +
      `API version ${helpers.version}.`,
  );
}

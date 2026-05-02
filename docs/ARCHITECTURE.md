# StimDAW Architecture

Aktuell kod-arkitektur efter β-refactor (2026-05-03). Beskriver vad som finns på disk just nu — design-historik och rationale finns i [`docs/designs/`](designs/).

> Hardware-spec och protokoll finns i [HARDWARE.md](HARDWARE.md). Vision och kontext finns i [STIMDAW_BRIEF.md](STIMDAW_BRIEF.md).

---

## Layer model

Tre konceptuella lager + en bridge. **DAW-lagret komponerar och emitterar**. **Viz-lagret konsumerar och renderar**. **Bridge orkestrerar lifecycle och håller reactive state**. Layer-separation tillåter att DAW-pipelinen kan köra utan viz, och viz utan DAW (för replay).

```
┌──── DAW LAYER (composition + protocol-emit) ────────────┐
│ src/synth/*           Mixer state, SynthEngine, LFO,    │
│                       cables, waveforms, clock          │
│ src/patterns/*        Built-in patterns + runner         │
│ src/safety/*          Ramp, ceiling, single-chokepoint  │
│                       clamp, identity-scrubber, watchdog│
│ src/protocol/*        PT-descriptor encoder, NeoDKClient│
│ src/transport/*       Web Serial + in-memory transport  │
│ src/mock-firmware/*   Mock backend (sim-clock, queue,   │
│                       voltage-sim, csv-export)          │
│ src/fileformat/*      .stimdaw v0 (Zod-validated)       │
│ src/ui/Mixer.svelte   Mixer UI                          │
│ src/ui/synth/*        Knob, Channel, LFO, Cable,        │
│                       ElconPicker                       │
│ src/ui/PatternRunnerBar.svelte   Pattern launcher       │
└────────────────────┬──────────────────────────────────────┘
                     │ writePtDescriptor(d)
                     │ voltages-event back from firmware
                     ▼
┌──── BRIDGE (state + orchestration) ─────────────────────┐
│ src/ui/stores.svelte.ts                                 │
│   • app.dispatchedDescriptors ($state.raw, host-emit)   │
│   • app.voltageHistory ($state.raw, telemetry)          │
│   • app.streamTimeOriginMicros, streamOriginWallMicros  │
│   • app.{oscilloscopeFrame, envelopeFrame, polarFrame}  │
│   • Frame-timer (30Hz) — buildFrame + buildEnvelopeFrame│
│                          + buildPolarFrame              │
│   • runPattern(), startMixer(), ensureSynthEngine()     │
│   • recordDispatch(), purgeOscilloscopeState()          │
│   • CSV-export (buildDispatchedCsv, exportDispatchedCsv)│
└────────────────────┬──────────────────────────────────────┘
                     ▼
┌──── VIZ LAYER (frame production + render) ──────────────┐
│ src/oscilloscope/*    Pure pipeline                     │
│   ├─ types            FiredPulse, ElectrodeRowFrame     │
│   ├─ expand           descriptor + delta → FiredPulse[] │
│   ├─ voltage-state    voltageHistory → effective V at t │
│   ├─ electrode-mapping FiredPulse → ElectrodeRowPulse[] │
│   ├─ frame-builder    samordnar till OscilloscopeFrame  │
│   ├─ envelope-frame   per-electrode amp-curve över 6s   │
│   └─ polar-frame      spatial bezier-arcs med age-fade  │
│ src/ui/Oscilloscope.svelte    per-electrode rendering   │
│ src/ui/PolarFlow.svelte       spatial flow-vy           │
│ src/ui/Monitor.svelte         Vbat/Vcap/Iprim sparklines│
└──────────────────────────────────────────────────────────┘
```

---

## Data flow — emit till render

```
User input (Mixer knob, LFO drag, Pattern button)
     │
     ▼
synth.current state (Svelte 5 $state runes adapter)
     │
     ▼
SynthEngine.tick() / PatternRunner.next()
     │
     │  PtDescriptor (wire-format, post-clamp amp)
     ▼
sink callback (in stores.svelte.ts):
     │  ├─ client.writePtDescriptor(d)  ──→ NeoDKClient → Transport → mock-firmware
     │  └─ recordDispatch(d, fullDispatch)
     │       │
     │       ▼
     │  pendingDispatched.push(d)        ── batchas, ej reactive per push
     │
     │  setInterval(33ms) frame-tick:
     ▼
runFrameTick():
     │  1. Drain pendingDispatched → app.dispatchedDescriptors (reassign $state.raw)
     │  2. Build OscilloscopeFrame, EnvelopeFrame, PolarFrame
     │  3. Set app.{oscilloscopeFrame,envelopeFrame,polarFrame}
     │
     ▼ (Svelte reactivity, max 30Hz)
Oscilloscope.svelte / PolarFlow.svelte / Monitor.svelte re-render
```

**Frikoppling:** synth-engine kan emittera vid 200Hz, frame-builder läser arrayen vid 30Hz och bygger frames. UI re-renderar bara när frame-state ändras. Inget per-emit-overhead för Svelte deep-proxy.

---

## Module map

### `src/protocol/` — wire format

Stateful frame parser, CRC8/CRC16-CCITT, PT-descriptor encoder/decoder, Attribute-API. NeoDK-klient med EventEmitter. Hardware-bounds (PW_MIN/MAX, PACE_MIN/MAX) från `firmware/inc/burst.h` är single source-of-truth.

| Fil | Ansvar |
|---|---|
| `frame.ts` | 8-byte header + payload, stateful parse-buffer |
| `crc.ts` | CRC8 (header) + CRC16-CCITT (payload) |
| `descriptor.ts` | PT-descriptor encode/decode, 5 omittnings-rules |
| `attributes.ts` | TS-types för 15 attribut-IDs |
| `opcodes.ts` | ReadRequest/WriteRequest/InvokeRequest/SubscribeRequest/ReportData |
| `neodk-client.ts` | Host facade — write/read/subscribe + EventEmitter |
| `hardware-bounds.ts` | PW_MIN/MAX/PACE_MIN/MAX, AMP_MAX |
| `debug-cli.ts` | /X-kommando-routing |
| `typed-emitter.ts` | EventEmitter med TS-typade events |

### `src/transport/` — UART abstraction

| Fil | Ansvar |
|---|---|
| `transport.ts` | Interface (open/close/write/onData/onDisconnect) |
| `in-memory.ts` | Mock-pair (host ↔ firmware loopback) |

(Web Serial-impl finns inte än — mock-driven dev tills hardware landar.)

### `src/mock-firmware/` — simulerad NeoDK

| Fil | Ansvar |
|---|---|
| `firmware.ts` | Glue: datagram dispatch, attribute-routing, voltage-emit-loop |
| `sim-clock.ts` | Monotonisk event-scheduler (priority queue, advance till nästa event) |
| `pt-queue.ts` | 2× sub-queue × 20 slots, drop on overflow, short-circuit-reject |
| `voltage-sim.ts` | Vbat-baseline + Vcap-RC-modell + per-puls-Vcap-dipp via `onPulseFired()` |
| `csv-export.ts` | Dispatched descriptors → patterns312-format med polaritet-stage-labels |
| `state.ts` | Mock-firmware state (intensity, pattern, play-state) |

### `src/synth/` — modular synth core

Pure TypeScript, ingen Svelte runtime → bun-test-bart.

| Fil | Ansvar |
|---|---|
| `types.ts` | KnobState, LFO, Cable, MixerChannel, MixerState |
| `state.ts` | Pure mutators (addChannel, addLfo, addCable, setLfoRate, …) + cascade-delete invariants |
| `waveforms.ts` | sine/saw/square/triangle (pure functions) |
| `lfo.ts` | computeLfoSignal + reAnchorPhase (continuous över rate-byte) |
| `clock.ts` | Clock-interface + RealtimeClock (prod) + TestClock (deterministic test) |
| `synth-engine.ts` | Event-driven per-channel scheduling + ensureChannelScheduled-API |

**Invariants:**
- Per-channel polarity-flip per emit (CRITICAL — undviker DC-stim)
- Generation-counter cancellation pattern (pending events efter stop no-op:as)
- Cable cascade-delete: `removeLfo` rensar danglande knob.modCableId
- Single-chokepoint amp-clamp via `src/safety/clamp.ts`

### `src/oscilloscope/` — frame-builder pipeline

Pure pipeline, läser från app-state, bygger frame-objekt. Inga side-effects.

| Fil | Ansvar |
|---|---|
| `types.ts` | FiredPulse, ElectrodeRowFrame, OscilloscopeFrame + `streamTime()` helper |
| `expand.ts` | Descriptor + delta_pw/delta_pace → FiredPulse[] (per-puls-expansion) |
| `voltage-state.ts` | voltageHistory + streamTime → effective primary voltage at t |
| `electrode-mapping.ts` | FiredPulse → ElectrodeRowPulse[] (mappar elcon-bitmask till 4 fasta rader) |
| `frame-builder.ts` | Orkestrerar expand + electrode-mapping + window-filter → OscilloscopeFrame |
| `envelope-frame.ts` | Per-electrode amplitude-curve smooth över 6s (Sensation Envelope) |
| `polar-frame.ts` | Spatial bezier-arcs mellan + och − under senaste 1s med age-fade |

**ampNorm = `descriptor.amplitude / 255`** (wire-truth/DAW-intent), inte Vcap-telemetri (annars blank viz vid intensity=0).

### `src/safety/` — guardrails

| Fil | Ansvar |
|---|---|
| `clamp.ts` | Single chokepoint: `min(rampPercent × descriptorAmp × ceilingPercent, 255)`. Hardcoded MAX kan ej överskridas. |
| `ramp-controller.ts` | Smooth 0→lastKnown over rampUpDuration vid reconnect |
| `max-ceiling.ts` | Hard ceiling configurerbar i settings (default 50%) |
| `stop-watchdog.ts` | 1s deadline på STOP, loud-failure-UI om timeout |
| `identity-scrubber.ts` | Filtrera paths/usernames ur saved files + logs |

### `src/patterns/` — pattern engine

| Fil | Ansvar |
|---|---|
| `types.ts` | Elcon, PatternDef, ElectrodeMask, elconId, uniqueElcons |
| `builtins.ts` | 5 firmware-patterns porterade |
| `runner.ts` | generatePatternDescriptors() — descriptor-stream med biphasic phase-flip + amp ramp |
| `validate.ts` | `(pos & neg) === 0` + `pos | neg !== 0` + bounds-checks |
| `csv-format.ts` | patterns312-CSV format med polaritet-explicit Stage |
| `replay-validate.ts` | Verifierar CSV → descriptor → CSV round-trip |

### `src/fileformat/` — .stimdaw v0

| Fil | Ansvar |
|---|---|
| `schema.ts` | Zod-schema för v0 (rampUpDurationMs + maxCeilingPercent) |
| `migrate.ts` | Versioned migration-scaffold (v0→v0 nop, ramverk för v0→v1) |
| `io.ts` | Load/save till localStorage |

### `src/ui/` — Svelte 5 (runes)

```
App.svelte                Topbar (STOP + source-indicator) + source-tabs
                          (Patterns | Mixer) — visuell mutex via segmented control
ConnectionBanner.svelte   Connection status + reconnect-button
Monitor.svelte            Vbat/Vcap/Iprim sparklines
IntensitySlider.svelte    Ramp-controlled intensity + ceiling-cap
StopButton.svelte         Big red STOP, alltid synlig
Cli.svelte                /X-kommando-passthrough + debug-log

PatternRunnerBar.svelte   5 patterns + loop-checkbox + Stop + Export-CSV
Mixer.svelte              Channels + LFOs + cable-layer-overlay
Oscilloscope.svelte       4 fasta electrode-rader (A/B/C/D) rendering
PolarFlow.svelte          Spatial bezier-arcs

stores.svelte.ts          Bridge-modul:
                          - AppState class med $state-fält
                          - connectMock() / disconnect() / reconnectMock()
                          - runPattern() / stopPattern()
                          - startMixer() / stopMixer()
                          - ensureSynthEngine() + attachEngineHooks
                          - recordDispatch() + purgeOscilloscopeState()
                          - Frame-timer (30Hz)
                          - CSV-export

csv-filename.ts           Pure helper för CSV-filnamn

synth/
  Knob.svelte             Vertical drag + Shift fine-grain + log-scale (pace) +
                          double-click reset + ARIA slider + mod-ring
  MixerChannel.svelte     Channel-strip med 3 knobs + enable-toggle + remove
  LFOModule.svelte        Shape-picker + rate/amount knobs + output-port
  CableLayer.svelte       SVG-overlay (pointer-events: stroke på cables) +
                          drag-cable-creation + Esc-cancel
  ElconPicker.svelte      9 hardware-valid elcon-knappar
  
  cable-helpers.ts        Pure: bezierPath + LFO-färgpalett
  knob-helpers.ts         Pure: tToValue + valueToT + dragDeltaToValue + format
  synth-store.svelte.ts   Svelte 5 runes-adapter över src/synth/state.ts +
                          attachEngineHooks-injektion
```

### `src/dev/` — DEV-only test-hooks

| Fil | Ansvar |
|---|---|
| `test-helpers.ts` | `window.__stimdaw_test` API för RPA/AI-driven UI-testning. State-inspection + mixer-actions + frame-introspection. Tree-shakad i prod via `import.meta.env.DEV`-gate. |

---

## Reactivity model

**Svelte 5 runes** för reactivity, med två mönster:

1. **`$state(...)` deep-proxy** — för normalt UI-state (intensity, ceiling, currentPattern, etc.) där mutationer ska trigga re-render.

2. **`$state.raw(...)` shallow** — för stora arrayer som `dispatchedDescriptors` (cap 5000) och `voltageHistory` (cap 600). Mutationer kräver reassign men undviker deep-proxy-overhead vid 200Hz emit-rate.

**Frame-batching:** alla viz-frames (oscilloscope/envelope/polar) reassign:as tillsammans i `runFrameTick()` vid 30Hz. UI re-renderar max 30 ggr/sec oavsett emit-rate.

**Engine-hooks:** `synth-store.svelte.ts` exponerar `attachEngineHooks()` så `stores.svelte.ts` kan registrera `ensureChannelScheduled` callback efter SynthEngine init. Undviker cirkulär import (stores → synth-store → synth-engine).

---

## Testing

| Verktyg | Vad |
|---|---|
| `bun test` | Unit + integration suite (417 tester över 40 filer) |
| `bun x tsc --noEmit` | Strict TypeScript typecheck |
| `bun run build` | Vite production build (verifierar tree-shaking + minification) |

Test-struktur speglar `src/`. Pure modules (`src/oscilloscope/*`, `src/synth/*`, `src/patterns/*`) testas isolerat utan DOM. UI-komponent-tester kräver Svelte runtime (deferred).

**Critical-path-tester** (eng-review locked):
- GAP-A: per-channel phase-flip (CRITICAL safety, undviker DC-stim)
- GAP-B: STOP-mid-flight drainar pending events utan late dispatch
- GAP-C: hardware-bounds shared mellan synth + descriptor-timing
- GAP-D: knob log-scale conversion (geometric mean vid t=0.5)
- GAP-E: cable bezier-path d-string format
- GAP-F: SynthEngine generation-pattern (no-op pending events efter stop)
- GAP-G: cascade-delete invariant (removeLfo + removeChannel rensar refs)

---

## Stack

- **Vite 6** — dev-server + build + HMR
- **TypeScript** strict mode
- **Svelte 5** runes-mode (`$state`, `$derived`, `$effect`)
- **Bun** — package manager + test runner (snabbt, native, perfekt för pure-logic-tester)
- **Web Serial API** — när real hardware landar (i-memory mock används idag)
- **Zod** — runtime-validering för `.stimdaw`-filformat
- **fast-check** — property-based tests för crc/frame/descriptor

Total bundle: ~189 kB JS (57 kB gzipped), 196 modules. Built in <800ms.

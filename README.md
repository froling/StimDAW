# StimDAW

DAW-likt klient för [NeoDK](https://github.com/Onwrikbaar/NeoDK) e-stim-hårdvara — exponerar hela protokollets djup, inte bara intensity/pattern-UI:t som följer med firmware.

**Status:** β — modulär synth (Reason-style mixer + LFO + cables) + frame-builder oscilloscope + spatial PolarFlow-vy. Mock-driven utveckling. Hårdvaran är beställd, inte levererad än.

## Vad den gör (idag)

- **Live mock NeoDK device** med riktig protokoll-stack (frames, CRC, descriptors, queue, voltages-telemetri)
- **Pattern runner** med alla 5 firmware-patterns (Toggle, Jackhammer, CrossToggle, Circle, ScratchThatItch) + loop-mode
- **Modular Mixer** (Reason-paradigm): channels med PW/Pace/Amp-knobs, LFOs (sine/saw/square/triangle), patch-cables LFO→knob med per-cable depth, hardware-valid 9-elcon picker
- **Oscilloscope** med fasta 4 electrode-rader (A/B/C/D) + Sensation Envelope per electrode + spatial **PolarFlow** (bezier-arcs mellan + och − under senaste sekunden)
- **CSV-export** av dispatched descriptors i patterns312-kompatibelt format med polaritets-explicita stage-labels (`A>C`, `AC<BD`)
- **Safety-stack:** ramp-controller, max-ceiling, STOP-watchdog, single-chokepoint amplitude clamp
- **Mock firmware** med SimClock event-driven dispatch + voltage-sim med per-puls-Vcap-dipp
- **Source mode tabs** (Patterns vs Mixer) — visuell mutex, ej disabled-state
- **RPA test-helpers** på `window.__stimdaw_test` (DEV-only) för AI-driven UI-testning

## Quick start

```bash
bun install
bun run dev
```

Öppna `http://localhost:5173`. Web Serial API kräver Chromium-baserad browser (Chrome, Edge, Opera). I mock-driven dev-läge auto-connectar appen till en in-memory mock NeoDK vid load — ingen hårdvara behövs.

## Tester

```bash
bun test           # unit + integration suite (417 tester över 40 filer)
bun x tsc --noEmit # typecheck
bun run build      # production build
```

## Project layout

```
src/
  protocol/         NeoDK frame, attributes, descriptors, hardware-bounds
  transport/        Web Serial + in-memory implementations
  mock-firmware/    Simulerar NeoDK utan hårdvara
                    ├─ sim-clock        monoton event scheduler
                    ├─ pt-queue         2× sub-queue × 20 slots, drop on overflow
                    ├─ voltage-sim      Vbat/Vcap/Iprim med per-puls-Vcap-dipp
                    ├─ csv-export       dispatched-descriptors → patterns312-CSV
                    └─ firmware         glue + datagram dispatch + free-space notify
  patterns/         Pattern data-model + 5 firmware-patterns + runner + csv-format
  synth/            Modular synth core (Reason-paradigm)
                    ├─ types            KnobState, LFO, Cable, MixerChannel
                    ├─ state            pure mutators + cascade-delete invariants
                    ├─ waveforms        sine/saw/square/triangle (pure)
                    ├─ lfo              computeLfoSignal + reAnchorPhase
                    ├─ clock            Clock-interface (RealtimeClock + TestClock)
                    └─ synth-engine     event-driven per-channel scheduling
  oscilloscope/     Frame-builder pipeline (post β-rewrite)
                    ├─ types            FiredPulse, ElectrodeRowFrame
                    ├─ expand           descriptor + delta → FiredPulse[]
                    ├─ voltage-state    voltageHistory → effective voltage at t
                    ├─ electrode-mapping FiredPulse → ElectrodeRowPulse[] (4 rader)
                    ├─ frame-builder    samordnar till OscilloscopeFrame
                    ├─ envelope-frame   per-electrode amplitude-curve över 6s
                    └─ polar-frame      spatial flow-vy med age-fade arcs
  safety/           ramp-controller, max-ceiling, STOP watchdog, single-chokepoint clamp
  fileformat/       .stimdaw v0 (JSON + Zod, versioned)
  ui/               Svelte 5 (runes)
                    ├─ App.svelte           source-tabs + topbar + STOP
                    ├─ Mixer.svelte         channels + LFOs + cable-layer
                    ├─ Oscilloscope.svelte  per-electrode-rader rendering
                    ├─ PolarFlow.svelte     spatial bezier-arcs
                    ├─ PatternRunnerBar     5 patterns + loop + CSV-export
                    ├─ Monitor              Vbat/Vcap/Iprim sparklines
                    ├─ IntensitySlider      ramp + ceiling
                    ├─ Cli                  debug-CLI passthrough
                    ├─ stores.svelte.ts     Svelte 5 runes-adapter + frame-tick
                    └─ synth/               Knob, MixerChannel, LFOModule,
                                            CableLayer, ElconPicker
  dev/              test-helpers.ts (RPA-hooks, DEV-only)
  log.ts            tunn logger med levels
  main.ts           Vite entry
test/               Speglar src/ + integration/
reference/NeoDK/    Submodule: NeoDK firmware + protocol-spec + patterns312-CSVs
docs/               Brief, hardware, architecture, design-historik
```

## Dokumentation

- [Project brief](docs/STIMDAW_BRIEF.md) — vision, kontext, scope-locks
- [Hardware & protocol](docs/HARDWARE.md) — NeoDK topologi, PT-descriptor-spec, stream lifecycle, builtins
- [Architecture](docs/ARCHITECTURE.md) — current layer-stack, moduler, data flow
- [Design history](docs/designs/) — ship-loggar för α/β-wedges
- [NeoDK protocol spec](reference/NeoDK/PulseTrainDescr.md) — pulse train descriptor wire-format
- [Changelog](CHANGELOG.md) — versioned shipping log
- [TODOS](TODOS.md) — β.1 / γ-prep / deferred items

## Scope (hårda non-goals)

- **NeoDK-only.** Ingen abstraktion för andra e-stim-protokoll (zc95, FOC-Stim, ET-312).
- **Single device.** Inget multi-device.
- **Inte mikrosekund-resolution waveform.** Oscilloscope visar dispatched-descriptors (per-puls-events), inte sample-buffer.

## Topologi-not

`reference/NeoDK/patterns312/*.csv` är inspelningar från Erostek ET-312-hardware, inte NeoDK. ET-312 har två effekt-kanaler (A och B), NeoDK har en transformator + 4-electrode switch matrix. Ungefärlig mappning: ET-312 "A" ≈ NeoDK A↔C-par, ET-312 "B" ≈ NeoDK B↔D-par. Användbar som timing/cadence-referens, inte byte-level replay-target.

## Stack

Vite + TypeScript + Svelte 5 (runes) + Bun (test runner) + Web Serial API.

## Cloning

```bash
git clone --recurse-submodules https://github.com/froling/StimDAW.git
```

Om du klonade utan `--recurse-submodules`:
```bash
git submodule update --init --recursive
```

## License

Not yet licensed (TBD).

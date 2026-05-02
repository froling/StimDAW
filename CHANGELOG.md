# Changelog

Format: feature-grouped, newest first. Pre-1.0, breaking changes möjliga per α/β-wedge.

## β — 2026-05-03

"Spela boxen som ett instrument" — modulär synth + frame-builder oscilloscope.
Mock-driven hela vägen, hardware fortfarande inte levererad.

### Modular synth (Mixer)

- Reason-paradigm: knob-position rör sig inte under mod, LFO oscillerar runt user-set base
- `MixerChannel` med 3 knobs (PW/Pace/Amp) + enable-toggle + remove-knapp
- `LFO` med shape-picker (sine/saw/square/triangle), rate (0.01..50 Hz, log-scale), amount (0..1)
- `Cable` LFO→knob med per-cable depth (Reason-style modulation amount)
- Drag-cable-creation från LFO-output-port → knob-port via SVG-overlay (`pointer-events: stroke` på cables, `none` på SVG)
- Cable-färg = LFO-källa, mid-text-label "L1"/"L2" för colorblind-a11y
- Plain-click på cable = no-op (skydd mot accidental delete), Shift+click = instant delete
- Esc-cancel under aktiv cable-drag, drop-target-highlight på knobs
- `Knob.svelte` med vertical drag + Shift fine-grain + log-scale (pace) + double-click reset + ARIA slider
- 9-elcon picker (`ElconPicker.svelte`) — bara hardware-valid konfigurationer (A↔B, A↔D, C↔B, C↔D + AC/BD-varianter)
- Source-mode tabs (Patterns vs Mixer) — visuell mutex, segmented control istället för disabled-state
- F2 seed-state vid första Mixer-mount (1 channel AC↔BD + 1 LFO sine)

### Synth-engine

- Event-driven per-channel scheduling via `Clock`-interface (RealtimeClock prod / TestClock test)
- Per-channel polarity-flip per emit (CRITICAL safety — undviker DC-stim)
- Generation-counter cancellation pattern för pending events efter stop
- Single-chokepoint amplitude clamp via `src/safety/clamp.ts`
- Cascade-delete invariant på cables (removeLfo / removeChannel rensar danglande refs + knob.modCableId)
- LFO `phaseAnchorMicros` + `setLfoRate(state, id, rate, simNow)` re-ankrar phase så signal är continuous över rate-byte (annars diskontinuerlig glitch)
- `ensureChannelScheduled(id)` API för att starta emission när channel re-enable:as eller addas mid-run (annars permanent tystnad)
- LFO rate clampas defensivt 0.01..50 Hz (NaN/Infinity → min)
- Sink-call wrappad i try/catch + nästa schedule sker FÖRE sink så throw inte bryter scheduling-kedjan
- Hardware-bounds shared via `src/protocol/hardware-bounds.ts` (PW_MIN/MAX, PACE_MIN/MAX från `firmware/inc/burst.h`)

### Oscilloscope rewrite (post-α2 redesign)

- 4 fasta electrode-rader (A/B/C/D) ersätter per-elcon-rader (per `STIMDAW_BRIEF.md` §4 hardware-truth)
- Frame-builder pipeline (pure modules under `src/oscilloscope/`):
  - `expand.ts` — descriptor + delta_pw/delta_pace → FiredPulse[]
  - `voltage-state.ts` — voltageHistory → effective primary voltage at t
  - `electrode-mapping.ts` — FiredPulse → ElectrodeRowPulse[] (4 rader)
  - `frame-builder.ts` — orkestrerar till `OscilloscopeFrame`
  - `envelope-frame.ts` — per-electrode amplitude-curve över 6s (smooth)
  - `polar-frame.ts` — spatial bezier-arcs mellan + och − under senaste 1s med age-fade
- 30Hz frame-tick (`setInterval(33ms)`) batchar `pendingDispatched` → `app.dispatchedDescriptors` reassign — frikopplar Svelte reactivity från emit-rate (skala till 200Hz utan re-render-storm)
- Stream-time-origin (`streamTimeOriginMicros` + `streamOriginWallMicros`) ankras vid första dispatch, PURGE vid run-start
- `ampNorm` deriveras från `descriptor.amplitude` (wire-truth, DAW-intent) inte Vcap-telemetri (annars blank viz vid intensity=0)
- `PolarFlow.svelte` — separat panel, spatial flow-vy
- Tar bort: `waveform.ts`, `descriptor-timing.ts`, `bounds-shared.test.ts`

### Mock-firmware

- `voltage-sim.ts` utökad med `onPulseFired(amp, phase, simNow)` för per-puls-Vcap-dipp ovanpå intensity-baseline-RC-modell
- 30Hz voltage-emit-rate matchar frame-tick så Vcap-trace inte blir chunky
- `VoltageSample{wallTimeMicros}` extends Voltages för stream-time-translation

### App-shell + RPA

- `App.svelte` med source-tabs + topbar-source-indicator + STOP-button
- `src/dev/test-helpers.ts` — `window.__stimdaw_test` (DEV-only, tree-shakad i prod) med:
  - State-inspection (mixer state, dispatchedDescriptors, oscilloscopeFrame)
  - `getElectrodePulseCounts()` + `getPolarityStats()` per current frame
  - Mixer-actions (addChannel, addLfo, addCable, etc.)
  - `flush()` med rAF + 2× microtask för Svelte reactivity-stabilisering
- `data-testid`-attribut på alla interaktiva element (Fas 1)
- `disconnect()` stoppar synth-engine + flippar isMixerRunning + clearar engine-ref
- `stopMixer()` lämnar frame-tick igång så Oscilloscope behåller senaste frame

### UI-polish

- `Knob.svelte` SVG fill-arc med precis start-punkt (`±radie/√2` istället för hardcoded "-32.4 32.4") + korrekt large-arc-flag-tröskel (`knobAngle > 45°` istället för `fillFraction > 0.5`) — fixar visuell båg-loop mellan ~50-70% av knob-range
- Knob mod-ring i LFO-källans färg när modulerad (audit F3)
- Status-dot vid Mixer/Source-indicator (audit F7)

### Tester

- 417 tester över 40 filer (var 228 över 25 vid α2)
- `test/oscilloscope/*` — pure-pipeline-tester (expand, voltage-state, electrode-mapping, frame-builder, envelope, polar)
- `test/synth/*` — synth-engine, lfo, state, clock, waveforms (inkl GAP-A phase-flip + GAP-F generation-pattern + GAP-G cascade-delete)
- `test/integration/mixer-flow.test.ts` — end-to-end synth + GAP-B STOP-mid-flight + rate-reanchor regression + ensureChannelScheduled paths

## α2 — 2026-04-30

The "see what the box generates" milestone. Pattern-runner + Oscilloscope + CSV-export end-to-end on mock firmware.

### Pattern engine

- 5 firmware-patterns ported från `reference/NeoDK/firmware/src/patterns.c`: Toggle, Jackhammer, CrossToggle, Circle, ScratchThatItch
- Dynamic elcon-array model (2-18 elcons per pattern, ej 9 hardcoded)
- Disjunktums-rule enforced at builder + queue (`(pos & neg) === 0`)
- Pattern-runner genererar descriptor-stream med biphasic phase-flip och amp ramp-up
- Loop-mode (PatternRunnerBar checkbox): repeterar en rep per iteration tills Stop

### Protocol stack

- PT-descriptor encoder/decoder med alla 5 omittnings-rules (sizes 10/13/14/15/16 bytes)
- Round-trip property-tester för descriptor wire-format
- `NeoDKClient.writePtDescriptor()` extends host facade

### Mock firmware

- 2× sub-queue × 20 slots `PtQueue` med overflow-drop + short-circuit-reject
- Event-driven dispatch via `SimClock.scheduleAt(startTimeMicros)` — strikt timing, no tick-jitter
- Generation-counter cancellation pattern för `drainPtQueue` (invaliderar pending events)
- AI_PT_DESCRIPTOR_QUEUE free-space notify (matchar firmware `sequencer.c:447` wire-format)
- STOP via PlayPauseStop drainar queue + bumpar generation per outside-voice #5

### Oscilloscope (α2 — ersatt i β)

- N rader per pattern's unique elcons (auto-shown on pattern start)
- Top sub-chart (42px): biphasic amp/vcap traces, signed 0-baseline center, ±50% guides
- Bottom sub-chart (16px): pulse_width + pace bars
- 6s rolling window, X-axis rolls left vid 30Hz tick
- Ersattes av β:s frame-builder med 4 fasta electrode-rader (per hardware-truth)

### CSV-export

- Patterns312-kompatibelt 6-column-format (Stage, SeqNr, Timestamp, Phase, Width, Vprim)
- Stage-column med polaritet-explicit electrode-label för NeoDK (`A>C`, `AC<BD`, etc)
- ET-312 inspelningar parsas fortfarande korrekt (back-compat med bare 'A'/'B' Stage)
- Per-pulse expansion från descriptor (hanterar delta_pulse_width / delta_pace ramping)

### Safety + scope-locks (carried från α1)

- Single-chokepoint amplitude clamp: `min(rampPercent × descriptorAmp × ceilingPercent, 255)`
- Ramp-controller respekterar ceiling, snap-down på ceiling-decrease
- STOP-watchdog med 1s deadline, raw IntensityPercent-write
- `.stimdaw` filformat v0 (Zod-validated) auto-persisterar rampUpDurationMs + maxCeilingPercent

## α1 — 2026-04-29

Initial mock-driven foundation. Live monitor + CLI passthrough + safety + filformat.

- NeoDK frame parser + CRC8/CRC16-CCITT
- Attribute encoder/decoder för Voltages, IntensityPercent, PlayPauseStop, BoxName, CurrentPatternName, FirmwareVersion
- In-memory transport-pair för mock-driven dev
- Mock firmware med voltage-sim + state machine + debug NST passthrough
- UI: ConnectionBanner, Monitor, IntensitySlider (med ceiling), Cli, StopButton
- Safety: RampController, MaxCeiling, StopWatchdog
- Svelte 5 runes-adapter (`stores.svelte.ts`) över EventEmitter-core
- `.stimdaw` v0 filformat med versioned migration-scaffold

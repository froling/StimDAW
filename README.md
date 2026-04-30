# StimDAW

DAW-like client for [NeoDK](https://github.com/Onwrikbaar/NeoDK) e-stim hardware.

**Status:** α2 — pattern-runner + Oscilloscope + CSV-export, mock-driven development. Hardware not yet shipped.

## What it does (today)

- **Live mock NeoDK device** with real protocol stack (frames, CRC, descriptors, queue)
- **Pattern runner** with all 5 firmware-patterns (Toggle, Jackhammer, CrossToggle, Circle, Scratch That Itch)
- **Loop-mode** for continuous play until Stop
- **Oscilloscope** per unique elcon: biphasic amp/vcap (signed, 0-baseline mid) + timing-bars (pulse_width %, pace %)
- **CSV-export** of dispatched descriptors in patterns312-compatible format with Stage-column polarity-labels (`A>C`, `AC<BD` etc)
- **Safety stack**: ramp-controller, max-ceiling, STOP watchdog, single-chokepoint amplitude clamp
- **Mock firmware** with SimClock event-driven dispatch (strict timing at descriptor.startTimeMicros)

## Quick start

```bash
bun install
bun run dev
```

Open `http://localhost:5173`. Web Serial API requires a Chromium-based browser (Chrome, Edge, Opera).

For mock-driven dev (no hardware needed) the app auto-connects to an in-memory mock NeoDK on load.

## Tests

```bash
bun test           # unit + integration suite
bun x tsc --noEmit # typecheck
bun run build      # production build
```

228 tests across 25 files at α2 milestone.

## Project layout

```
src/
  protocol/         NeoDK frame, attributes, descriptors (port from neodk.js)
  transport/        Web Serial + in-memory implementations
  mock-firmware/    Simulates NeoDK without hardware
                    ├─ sim-clock        monotonic event scheduler
                    ├─ pt-queue         2× sub-queue × 20 slots, drop on overflow
                    ├─ waveform         RC voltage model + biphasic charge tracking
                    ├─ csv-export       dispatched-descriptors → patterns312-CSV
                    └─ firmware         glue + datagram dispatch + free-space notify
  patterns/         Pattern data model + 5 firmware-patterns + runner + csv-format
  safety/           Ramp-controller, max-ceiling, STOP watchdog
  fileformat/       .stimdaw v0 (JSON + Zod, versioned)
  ui/               Svelte 5 components
                    ├─ Oscilloscope     N rows per pattern's unique elcons
                    ├─ PatternRunnerBar pattern buttons + loop checkbox + Stop + Export CSV
                    ├─ Monitor          live voltages + connection status
                    ├─ IntensitySlider  ramp + ceiling controls
                    ├─ Cli              debug command passthrough
                    └─ stores.svelte.ts Svelte 5 runes adapter over the EventEmitter core
  log.ts            Thin logger with levels
  main.ts           Vite entry point
test/               Mirrors src/ + integration/
reference/NeoDK/    Submodule: NeoDK firmware + protocol spec + patterns312 CSVs
docs/               Brief and design plans
scripts/            Codegen for attributes.ts from C headers
```

## Documentation

- [Project brief](docs/STIMDAW_BRIEF.md) — vision, protocol summary, architecture
- [α-wedge plan](docs/designs/ALPHA_WEDGE.md) — α1 plan with CEO + eng-review decisions
- [α2 plan](docs/designs/ALPHA2_DESCRIPTOR_OSCILLOSCOPE.md) — α2 PT-descriptor stack + Oscilloscope
- [NeoDK protocol spec](reference/NeoDK/PulseTrainDescr.md) — pulse train descriptor format
- [Changelog](CHANGELOG.md) — versioned summary of shipped features

## Scope (hard non-goals)

- **NeoDK-only.** No abstraction layer for other e-stim protocols (zc95, FOC-Stim, ET-312).
- **Single device.** No multi-device support.
- **Real-time clock visualization.** Oscilloscope renders dispatched descriptors (envelope), not microsecond-resolution waveform.

## Topology note

`reference/NeoDK/patterns312/*.csv` are recordings from Erostek ET-312 hardware, not NeoDK. ET-312 has two effect channels (A and B), NeoDK has one transformer + 4-electrode switch matrix. Approximate mapping: ET-312 "A" ≈ NeoDK A↔C-pair, ET-312 "B" ≈ NeoDK B↔D-pair. Useful as timing/cadence reference, not byte-level replay target.

## Stack

Vite + TypeScript + Svelte 5 (runes) + Bun (test runner) + Web Serial API.

## Cloning

```bash
git clone --recurse-submodules https://github.com/froling/StimDAW.git
```

If you cloned without `--recurse-submodules`:
```bash
git submodule update --init --recursive
```

## License

Not yet licensed (TBD).

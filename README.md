# StimDAW

DAW-like client for [NeoDK](https://github.com/Onwrikbaar/NeoDK) e-stim hardware.

**Status:** α — live monitor + CLI passthrough, mock-driven development. Hardware not yet shipped.

## Quick start

```bash
bun install
bun run dev
```

Open `http://localhost:5173`. Web Serial API requires a Chromium-based browser (Chrome, Edge, Opera).

## Project layout

```
src/
  protocol/        NeoDK frame, attributes, descriptors (port from neodk.js)
  transport/       Web Serial + mock implementations
  mock-firmware/   Simulates NeoDK without hardware (RC voltage model + queue)
  safety/          Ramp-controller, max-ceiling, STOP watchdog
  fileformat/      .stimdaw v0 (JSON + Zod, versioned)
  ui/              Svelte 5 components (monitor, CLI, STOP)
  log.ts           Thin logger with levels
  main.ts          Vite entry point
test/              Mirrors src/ + integration/
reference/NeoDK/   Submodule: NeoDK firmware + protocol spec
docs/              Brief and design plans
scripts/           Codegen for attributes.ts from C headers
```

## Documentation

- [Project brief](docs/STIMDAW_BRIEF.md) — vision, protocol summary, architecture
- [α-wedge plan](docs/designs/ALPHA_WEDGE.md) — implementation plan with all CEO + eng-review decisions
- [NeoDK protocol spec](reference/NeoDK/PulseTrainDescr.md) — pulse train descriptor format

## Scope (hard non-goals)

- **NeoDK-only.** No abstraction layer for other e-stim protocols (zc95, FOC-Stim, ET-312).
- **Single device.** No multi-device support.

## Stack

Vite + TypeScript + Svelte 5 + Bun + Web Serial API.

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

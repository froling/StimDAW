# Changelog

Format: feature-grouped, newest first. Pre-1.0, breaking changes possible per α-wedge.

## α2 — 2026-04-30

The "see what the box generates" milestone. Pattern-runner + Oscilloscope + CSV-export end-to-end on mock firmware.

### Pattern engine
- 5 firmware-patterns ported from `reference/NeoDK/firmware/src/patterns.c`: Toggle, Jackhammer, CrossToggle, Circle, ScratchThatItch
- Dynamic elcon-array model (2-18 elcons per pattern, not 9 hardcoded)
- Disjunktums-rule enforced at builder + queue (`(pos & neg) === 0`)
- Pattern-runner generates descriptor-stream with biphasic phase-flip and amp ramp-up
- Loop-mode (PatternRunnerBar checkbox): repeats one rep per iteration until Stop

### Protocol stack
- PT-descriptor encoder/decoder with all 5 omittnings-rules (sizes 10/13/14/15/16 bytes)
- Round-trip property tests for descriptor wire-format
- `NeoDKClient.writePtDescriptor()` extends the host facade

### Mock firmware
- 2× sub-queue × 20 slots `PtQueue` with overflow drop + short-circuit reject
- Event-driven dispatch via `SimClock.scheduleAt(startTimeMicros)` — strict timing, no tick-jitter
- Generation-counter cancellation pattern for `drainPtQueue` (invalidates pending events)
- Waveform-gen with biphasic vcap (signed, RC follower with phase-multiplied target)
- AI_PT_DESCRIPTOR_QUEUE free-space notify (matches firmware `sequencer.c:447` wire-format)
- STOP via PlayPauseStop drains queue + bumps generation per outside-voice #5

### Oscilloscope (UI)
- N rows per pattern's unique elcons (auto-shown on pattern start)
- Per-row eye toggle for visibility
- Top sub-chart (42px): biphasic amp/vcap traces, signed 0-baseline center, ±50% guides
- Bottom sub-chart (16px): pulse_width + pace bars, 0-baseline bottom, 0..MAX hardware-range
- 6s rolling window, X-axis rolls left at 30Hz tick
- 4 toggleable traces in legend: amplitude, Vcap, pulse width, pace
- Per-row readouts: amp%, vcap V, pulse_width µs, pace ms
- Hardware-bounds from `firmware/inc/burst.h`: pulse_width 2..200µs, pace 5..62.5ms
- Mean-aggregation per descriptor for nrOfPulses > 1 (handles delta_pulse_width / delta_pace)
- Design tokens (CSS custom properties scoped to `.osc`) — single source-of-truth for layout

### CSV-export
- Patterns312-compatible 6-column format (Stage, SeqNr, Timestamp, Phase, Width, Vprim)
- Stage-column carries polarity-explicit electrode label for NeoDK (`A>C`, `AC<BD`, etc)
- ET-312 recordings still parse correctly (back-compat with bare 'A'/'B' Stage)
- Per-pulse expansion from descriptor (handles delta_pulse_width / delta_pace ramping)
- Vprim is amplitude-byte proxy (255 → 3000mV) — not actual measurement
- Download via blob URL with filesystem-friendly filenames: `stimdaw-{slug}-{ISO}.csv`

### Safety + scope-locks (carried from α1)
- Single chokepoint amplitude clamp: `min(rampPercent × descriptorAmp × ceilingPercent, 255)`
- Ramp-controller respects ceiling, snap-down on ceiling decrease
- STOP watchdog with 1s deadline, raw IntensityPercent write
- `.stimdaw` filformat v0 (Zod-validated) auto-persists rampUpDurationMs + maxCeilingPercent

## α1 — 2026-04-29

Initial mock-driven foundation. Live monitor + CLI passthrough + safety + filformat.

- NeoDK frame parser + CRC8/CRC16-CCITT
- Attribute encoder/decoder for Voltages, IntensityPercent, PlayPauseStop, BoxName, CurrentPatternName, FirmwareVersion
- In-memory transport pair for mock-driven dev
- Mock firmware with voltage-sim + state machine + debug NST passthrough
- UI: ConnectionBanner, Monitor, IntensitySlider (with ceiling), Cli, StopButton
- Safety: RampController, MaxCeiling, StopWatchdog
- Svelte 5 runes adapter (`stores.svelte.ts`) over EventEmitter core
- `.stimdaw` v0 filformat with versioned migration scaffold

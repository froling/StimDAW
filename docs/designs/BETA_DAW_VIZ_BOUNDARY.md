---
status: LOCKED (post eng-review 2026-05-02)
date: 2026-05-02
supersedes: (none — companion to BETA_OSCILLOSCOPE.md)
review: 2026-05-02 (plan-eng-review + outside voice — strategic miscalibration caught, scope reduced)
---
# StimDAW β — DAW/Viz boundary refactor (REDUCED SCOPE)

## Final scope (post eng-review)

**Outside voice flagged strategic miscalibration: original plan was ~80 lines of
protocol-routing for a 5-line bug. Reduced to one-liner per Issue 1A user lock.**

Change `ampNorm` source in two viz frame-builders:
- `src/oscilloscope/polar-frame.ts:163` (computed inside main loop, post `expandDescriptor`)
- `src/oscilloscope/envelope-frame.ts:127` (in pulse-loop body)

From: `clamp01(pulse.effectivePrimaryVoltageMV / 10_200)` (Vcap-driven)
To: `clamp01(pulse.descriptorAmplitude / 255)` (wire-truth — what host sent on protocol)

Requires `FiredPulse` type to expose `descriptorAmplitude` instead of (or alongside)
`effectivePrimaryVoltageMV`. Update `expand.ts` to populate.

**That is it.** No protocol-routing. No DispatchedDescriptor extension. No new client
methods. No mock-firmware Invoke handler.

Phases B and C from original plan: DEFERRED to TODO (see end of doc).



## Why this plan exists

Post-β-Oscilloscope-rewrite (BETA_OSCILLOSCOPE.md, locked 2026-05-02), live testing
shows the Mixer pumping out 752 PT-descriptors but the Sensation Envelope and
Polar render as essentially blank when intensity slider is at 0%. Mixer is
correctly emitting per protocol — visualization just collapses because it's
keyed off Vcap telemetry (which depends on intensity-percent).

User intent: separate DAW (composition + protocol-emit) from Viz (consume +
render), keep DAW protocol-correct, but make Viz reflect the COMPOSITION (what
mixer wants to send) not just the TELEMETRY (what firmware reports back).

This doc is a 3-phase refactor proposal. User asked for plan-eng-review before
implementation.

## Symptom & root cause

**Symptom:** Mixer 1 channel A↔C, intensity=0%, LFO modulating amp. Mixer is
running, dispatched buffer has 752 entries, but:
- Sensation Envelope: flat lines on all 4 rows
- Electrode Flow: 1 thin almost-invisible arc between A and C
- Vcap: 0V (per Monitor)

**Root cause:** Both polar-frame.ts and envelope-frame.ts compute amplitudeNorm
from Vcap_mV:

```typescript
// In polar-frame.ts:163 and envelope-frame.ts:127
const ampNorm = clamp01(pulse.effectivePrimaryVoltageMV / 10_200);
```

Where `effectivePrimaryVoltageMV` resolves to `voltageHistory[t].Vcap_mV` at
dispatch time. At intensity=0%, the chain:

1. RampController.snapshot().effective = 0
2. clampAmp(rawAmp, 0%, ceiling) returns 0 (multiplied by 0/100)
3. PT-descriptor emitted with `amplitude: 0`
4. VoltageSim.onPulseFired() early-returns at amp=0 (no Vcap dipp)
5. VoltageSim's intensity_percent is also 0 → target_Vcap = 0
6. Vcap stays at 0V
7. ampNorm = 0/10200 = 0 → envelope renders flat, polar renders min-stroke

**This is correct for "wire-truth" rendering** (the box is delivering 0V) but
**wrong for "DAW-mixing" UX** where the user wants to see the composition's
shape regardless of master gain. In a DAW, you see waveforms even when master
volume is at -∞ dB.

## Architecture map (current state)

```
┌──── DAW LAYER (composition + protocol-emit) ────────────┐
│ src/synth/*  ─ Mixer state, SynthEngine, LFO, cables    │
│ src/patterns/*  ─ Built-in patterns + runner            │
│ src/safety/*  ─ ramp, ceiling, single-chokepoint clamp  │
│ src/protocol/*  ─ PT-descriptor encoder, NeoDKClient    │
│ src/mock-firmware/*  ─ Mock backend                     │
│ src/ui/Mixer.svelte, src/ui/synth/*  ─ Mixer UI         │
│ src/ui/PatternRunnerBar.svelte  ─ Pattern launcher      │
└──────────────────────┬───────────────────────────────────┘
                       │ writePtDescriptor(d)
                       │ voltages-event back from firmware
                       ▼
┌──── BRIDGE (state + orchestration) ─────────────────────┐
│ src/ui/stores.svelte.ts                                 │
│   • app.dispatchedDescriptors ($state.raw, host-emit)   │
│   • app.voltageHistory ($state.raw, telemetry)          │
│   • app.streamTimeOriginMicros, streamOriginWallMicros  │
│   • app.{oscilloscopeFrame, envelopeFrame, polarFrame}  │
│   • Frame-timer (30Hz)                                  │
│   • runPattern(), startMixer(), ensureSynthEngine()     │
│   • recordDispatch(), purgeOscilloscopeState()          │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──── VIZ LAYER (frame production + render) ──────────────┐
│ src/oscilloscope/*  ─ Pure pipeline                     │
│ src/ui/Oscilloscope.svelte (envelope render)            │
│ src/ui/PolarFlow.svelte (radial render)                 │
│ src/ui/Monitor.svelte (Vbat/Vcap/Iprim sparklines)      │
└──────────────────────────────────────────────────────────┘
```

## Issues identified

| # | Severity | Issue | Where |
|---|----------|-------|-------|
| 1 | CRITICAL | ampNorm coupled to Vcap-telemetri → blank viz at intensity=0 | polar-frame.ts:163, envelope-frame.ts:127 |
| 2 | ARCH | mockFw.onPulseFired-hack bypassar Transport | stores.svelte.ts:640 |
| 3 | ARCH | VoltageSim setPlaying gated på state.PlayState (Mixer sätter aldrig Playing) | firmware.ts |
| 4 | CLARITY | stores.svelte.ts konflaterar DAW + Viz + Bridge concerns (~810 rader) | stores.svelte.ts |
| 5 | MISSING | Channel-identity överlever inte till viz | DispatchedDescriptor saknar sourceTag |
| 6 | NAMING | "dispatched" missvisande (är host-emitted, inte firmware-fired) | DispatchedDescriptor name |

## Proposed refactor plan (3 phases)

### Phase A — Critical fix: Viz reflects DAW-intent (~30 min CC)

**A1: Change ampNorm source to DAW-intent (descriptor.amplitude)**

In `polar-frame.ts` and `envelope-frame.ts`, change from:
```typescript
const ampNorm = clamp01(pulse.effectivePrimaryVoltageMV / 10_200);
```
to:
```typescript
// DAW-intent: what mixer/runner composed (per protocol byte 0..255)
const ampNorm = clamp01(pulse.descriptorAmplitude / 255);
```

This requires `FiredPulse` to carry `descriptorAmplitude` (currently has
`effectivePrimaryVoltageMV` derived from telemetry). Change `expand.ts`:

```typescript
// Before:
out.push({
  ...
  effectivePrimaryVoltageMV,  // resolved from voltageHistory at sink time
});

// After:
out.push({
  ...
  descriptorAmplitude: descriptor.amplitude,  // 0..255 per protocol
  // effectivePrimaryVoltageMV stays for reference if needed
});
```

Trade-off: at intensity=0, descriptors emitted with amp=0 STILL render as 0
(because clampAmp produces amp=0 byte). The viz remains blank. Better solution:
**use pre-clamp amp** OR **multiply by IntensityPercent in render**. Either way
we need an explicit DAW-intent vs telemetry split.

Concrete proposal: pre-clamp amp from synth-engine.

In `synth-engine.ts`, expose pre-clamp amplitude in descriptor's host-side
metadata (NOT in protocol). Add new field to `DispatchedDescriptor`:

```typescript
export interface DispatchedDescriptor {
  readonly descriptor: PtDescriptor;       // wire-truth (post-clamp)
  readonly dispatchedAtMicros: number;
  readonly queueIdx: 0 | 1;
  readonly composedAmplitude?: number;     // pre-clamp 0..255 — DAW-intent
}
```

Synth-engine fills `composedAmplitude` with pre-ramp/pre-ceiling value. Viz
uses this for rendering when present, falls back to descriptor.amplitude.

**A2: Remove mockFw.onPulseFired-hack from synth-engine sink**

Currently `stores.svelte.ts:640` calls `mockFw?.onPulseFired?.(desc, wallNow)`
directly from the synth-engine sink. This bypasses Transport — only works for
mock, would not work for real device.

Replace by routing through the protocol: when host calls
`client.writePtDescriptor(desc)`, that goes via UART → mock-firmware decodes →
handleWrite for AI_PT_DESCRIPTOR_QUEUE. Mock-firmware updates voltage-sim from
that path (already does setIntensity for AI_INTENSITY_PERCENT — same pattern).

**A3: VoltageSim auto-plays when PT-queue has activity**

In mock-firmware `handleWrite` for AI_PT_DESCRIPTOR_QUEUE, after enqueuing the
descriptor: `voltage.setPlaying(true)`. Schedule auto-stop after queue drains
(track last-activity timer; if no new descriptors for 200ms, setPlaying(false)).

Match real firmware behavior (which auto-plays on Invoke START and stops on
queue drain or Invoke STOP).

### Phase B — Boundary clarity (~30 min CC)

**B1: Top-of-file JSDoc clarifying DAW/Viz/Bridge role per module**

Add to each `src/`-file a header noting its layer:

```typescript
/**
 * Layer: DAW (composition).
 * Reads: synth state, LFO, cables.
 * Writes: PT-descriptors via sink.
 * No knowledge of viz frames or rendering.
 */
```

**B2: Update stale comments**

Stores.svelte.ts has comments like "α2 — Pattern runner + waveform shadow render"
referring to deleted code. Update to reflect current arch.

**B3: Audit unused imports / dead code in stores.svelte.ts**

After β-rewrite, some imports/utility functions may be dead. Sweep and remove.

### Phase C — Channel-identity to viz (~45 min CC)

**C1: Add `sourceTag` to DispatchedDescriptor**

```typescript
export interface DispatchedDescriptor {
  readonly descriptor: PtDescriptor;
  readonly dispatchedAtMicros: number;
  readonly queueIdx: 0 | 1;
  readonly sourceTag?: string;  // channel.id, pattern.name, etc.
}
```

Off-protocol metadata. Host-side only. Viz consumes if present.

**C2: Synth-engine + pattern-runner emit sourceTag**

```typescript
// Synth-engine sink (in stores.svelte.ts):
recordDispatch(desc, {
  descriptor: desc,
  dispatchedAtMicros: wallNow,
  queueIdx,
  sourceTag: `mixer:${channel.id}`,
});

// Pattern-runner sink:
sourceTag: `pattern:${pattern.name}`,
```

**C3: Viz uses sourceTag for subtle visual differentiation**

Polar nodes/arcs and Envelope rows can color-shift based on dominant sourceTag
in window. Multi-channel mixing becomes visually parseable.

## Test strategy

Phase A:
- Verify mixer at intensity=0% shows envelope shapes (regression for current bug)
- Verify mixer at intensity=100% still works
- Verify pattern Toggle/Jackhammer/Circle render correctly (regression)
- Verify Vcap-telemetri-band still updates (Monitor + envelope band)

Phase B:
- No functional change — purely cleanup. Tests unchanged.

Phase C:
- Verify multi-channel mixer (add second channel) renders distinguishable colors
- Single-channel and pattern modes unchanged

## Open questions for eng-review

1. **A1 implementation**: keep `effectivePrimaryVoltageMV` field on FiredPulse
   alongside new `descriptorAmplitude`, or drop former entirely (since Vcap
   trace lives in Monitor + envelope-band)? Min lutning: drop, simplify type.

2. **A2/A3**: real firmware semantics for AI_PT_DESCRIPTOR_QUEUE writes.
   Verify mock matches: PT-queue write should auto-trigger Playing-state when
   queue is non-empty? Or does host need explicit Invoke START? Check
   `reference/NeoDK/firmware/src/sequencer.c` for canonical behavior.

3. **C1 naming**: "sourceTag" vs "composerHint" vs "channelId". Off-protocol
   metadata convention.

4. **C3 visual**: per-channel color-coding — how many channels max? β.0 has
   1-N channels (no hard limit). Color generation strategy?

5. **Phase ordering**: A is mandatory (fixes bug). B optional (cleanup). C
   optional (β.1 prep). Recommend ship A alone, B+C deferred to TODO?

6. **Refactor risk**: Phase A changes FiredPulse type and DispatchedDescriptor
   type. Tests need updates. Implementation order: types first, then sink, then
   viz.

## What's deleted vs kept vs new

### Modified (Phase A only)
- `src/oscilloscope/types.ts` — FiredPulse gets `descriptorAmplitude`, drops
  `effectivePrimaryVoltageMV` (or keeps both with explicit semantics)
- `src/oscilloscope/expand.ts` — populate new field
- `src/oscilloscope/polar-frame.ts` — use new field for ampNorm
- `src/oscilloscope/envelope-frame.ts` — use new field for ampNorm
- `src/mock-firmware/firmware.ts` — DispatchedDescriptor + handleWrite for PT_DESCRIPTOR_QUEUE
- `src/synth/synth-engine.ts` — emit composedAmplitude + sourceTag
- `src/ui/stores.svelte.ts` — remove onPulseFired hack from synth-engine sink

### Tests to update
- `test/oscilloscope/expand.test.ts` — new field
- `test/oscilloscope/polar-frame.test.ts` — new field source
- `test/oscilloscope/envelope-frame.test.ts` — new field source

### New tests (Phase A)
- `test/regression/mixer-at-intensity-zero.test.ts` — verifies envelope renders
  even when intensity=0 (composition visible without master volume)

## Implementation order (Phase A)

1. Update FiredPulse type (descriptorAmplitude field)
2. Update DispatchedDescriptor type (composedAmplitude field)
3. Update expand.ts to populate descriptorAmplitude
4. Update synth-engine sink to compute and pass composedAmplitude
5. Update polar-frame + envelope-frame to use new field
6. Update tests
7. Remove mockFw.onPulseFired hack
8. Move VoltageSim activation to mock handleWrite for PT_DESCRIPTOR_QUEUE
9. Manual browser verify: mixer at intensity=0 → envelope visible

## Risk register

| Risk | Mitigation |
|---|---|
| Pre-clamp amp visible could mislead user (showing what they MIGHT get vs what they DO get) | Keep Vcap telemetri-trace separate (already in envelope-band + Monitor) |
| Multi-channel viz colors clash | Use only subtle hue shifts within warm color family; sourceTag is hint not requirement |
| Mock-firmware refactor breaks pattern-runner emit timing | Pattern tests cover this; verify before+after |
| Real hw might NOT auto-play on PT-queue write — needs Invoke START | Verify against firmware src; if needed, add explicit Invoke START call in stores |

## Non-goals

- No changes to PT-descriptor wire format (protocol unchanged)
- No changes to ramp-controller / max-ceiling logic (safety unchanged)
- No restructuring of pure oscilloscope/ pipeline modules
- No new UI panels (β.0 has Polar + Envelope; β.1 may add more)
- No multi-stream support (single-stream firmware only — γ-territory)

---

## GSTACK REVIEW REPORT (plan-eng-review, 2026-05-02)

### Outcome: LOCKED — implemented + verified

Outside voice (Claude subagent) caught strategic miscalibration on the original
proposal. Original Phase A was ~80 lines of protocol-routing scaffolding (Invoke
START/STOP via NeoDKClient, mock-fw Invoke handler, DispatchedDescriptor
extension, synth-engine composedAmplitude field, onPulseFired hack removal) for
what is fundamentally a 5-line bug: viz keys ampNorm off Vcap telemetry instead
of wire-truth descriptor.amplitude.

User locked Issue 1A (one-liner) on cross-model tension question. Plan reduced
~95% from original scope.

### Decisions locked

- **Issue 1A (locked)** — One-liner: change ampNorm source in two viz frame
  builders. No protocol-routing. No client method changes. No mock-fw refactor.
- **Issue 2A (locked)** — Awaited stop semantics (deferred — only relevant if/when
  Phase A protocol-routing returns).
- **Phase B (boundary-clarity comments)** — DEFERRED → `TODOS.md` P3.
- **Phase C (channel-identity tagging)** — DEFERRED → `TODOS.md` P3.
- **Real-hardware Invoke START/STOP** — DEFERRED → `TODOS.md` P2 ("Protocol-routing:
  Invoke START/STOP via NeoDKClient", β.1).

### Risks identified by outside voice

- **Risk A (Invoke ordering)** — Real firmware (`sequencer.c:269`) refuses
  `stateStreaming` if PT-queue is empty. Original plan's "Invoke START before
  first writePtDescriptor" would no-op on real hw. Moot under reduced scope;
  logged for β.1 protocol-routing TODO.
- **Risk B (PlayState notify spam)** — Mock fw needs to gate `notify` on
  state-change (only fire if old != new). Logged in TODO context.

### Implementation log (locked scope only)

Files changed:

- `src/oscilloscope/types.ts` — `FiredPulse.effectivePrimaryVoltageMV` →
  `FiredPulse.descriptorAmplitude` (wire-truth byte 0..255).
- `src/oscilloscope/expand.ts` — drop `effectivePrimaryVoltageMV` parameter,
  populate `descriptorAmplitude` directly from `descriptor.amplitude`.
- `src/oscilloscope/polar-frame.ts` — `ampNorm = clamp01(pulse.descriptorAmplitude / 255)`,
  drop `effectiveVoltageAtDispatch` lookup.
- `src/oscilloscope/envelope-frame.ts` — same change as polar-frame.
- `src/oscilloscope/electrode-mapping.ts` — same change for legacy waveform panel
  (cascade from field rename; viz-truth invariant maintained across all panels).
- `src/oscilloscope/frame-builder.ts` — drop `effectiveVoltageAtDispatch` lookup
  + voltage param to `expandDescriptor`.

Tests updated:

- `test/oscilloscope/expand.test.ts` — drop voltage arg in calls, assert new field.
- `test/oscilloscope/electrode-mapping.test.ts` — `descriptorAmplitude` fixture +
  amp-norm scaling tests against /255.
- `test/oscilloscope/envelope-frame.test.ts` — set `amplitude: 255` for full-amp
  test (was relying on Vcap=10200).

`effectiveVoltageAtDispatch` retained in `voltage-state.ts` as public API
(still used for telemetry overlay; just no longer feeds ampNorm).

### Verification

- `bun run --silent tsc --noEmit` — clean, no errors
- `bun test` — 395 pass / 0 fail / 4728 expects across 40 files
- `bun run build` — 194 modules, 185.78 kB JS bundle, built in 796ms

Browser-verify pending: mixer with non-zero intensity should now render envelope
amplitude at full scale on a `amplitude: 255` puls regardless of Vcap state. At
`amplitude: 0` (intensity=0%), envelope should be flat (correct — wire-truth says
nothing is being delivered, viz reflects that).

### TODOs created

See `TODOS.md` § "β.1 — Real hardware bring-up":

1. Protocol-routing: Invoke START/STOP via NeoDKClient (P2, M)
2. β.0 polish: DAW/Viz boundary-clarity comments (P3, XS)
3. β.1 prep: Channel-identity i DispatchedDescriptor (P3, S)

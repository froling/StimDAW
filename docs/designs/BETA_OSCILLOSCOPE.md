---
status: SHIPPED
date: 2026-05-01
review: 2026-05-02 (plan-eng-review + outside voice)
shipped: 2026-05-03 (frame-builder pipeline + 4 fasta electrode-rader live)
supersedes: ALPHA2_DESCRIPTOR_OSCILLOSCOPE.md (raderad)
---
# BETA Oscilloscope — Re-design with hardware truth

> **Historical.** Frame-builder pipeline + 4 fasta electrode-rader (A/B/C/D) shipped. Aktuell impl: `src/oscilloscope/`, `src/ui/Oscilloscope.svelte`, `src/ui/PolarFlow.svelte`. Se [ARCHITECTURE.md](../ARCHITECTURE.md) för current state.

## Why we're starting over

α2:s Oscilloscope-design baserades på flera antaganden som visat sig vara fel
efter genomgång av NeoDK firmware-källkod (`reference/NeoDK/firmware/`):

1. **Per-elcon UI-rader** istället för per-electrode (A/B/C/D). Brief §4 säger
   explicit att "4 kanaler med + och −" är vilseledande UX. Vi ska visa pulser
   per electrode-trådbana, färgad efter polaritet.

2. **Vcap som biphasic per-elcon RC-follower**. Verklig Vcap är spänningen på
   tre 220µF tantal-kondensatorer (C2/C9/C10) — en GLOBAL DC-spänning, alltid
   positiv, dippar vid varje puls och fylls på av buck-konverten mellan dem.
   Hör hemma i Monitor (telemetri), inte Oscilloscope (per-puls).

3. **30Hz sample-tick som driver buffert**. Antog `nrOfPulses=2-20` per
   descriptor → descriptor-livslängd ≫ tick-interval. Mixerns `nrOfPulses=1`
   gör descriptor-livslängd = pace ∈ [5..62.5]ms. Resultat: 30Hz alias
   alternating phase, all-UP eller all-DOWN visualisering.

4. **amp byte som "scaling factor på master-voltage"**. Verklig semantik
   (`bsp_stm32g071.c:451-456`): `amp != 0` → `setPrimaryVoltage_mV(amp * 40)`
   (override box-state). `amp == 0` → "do not change" (inherit). Det är ett
   override-eller-inherit-protokoll på en global voltage-state, inte
   per-descriptor multiplikation.

5. **Wall-time-baserad x-axel**. Protokollet använder `start_time_µs` relativt
   stream-clock som ankras vid `BSP_startSequencerClock(burst.start_time_µs - 200)`
   (`sequencer.c:160`). Wall-time fungerar för live-mixer men är fel för
   batch-mode och introducerar drift.

6. **`delta_pulse_width_¼µs` och `delta_pace_µs` ignorerade**. Spec definierar
   linjär ramp PER PULS inom en burst. Vår timing sub-chart visade `meanPulseWidthMicros`
   per descriptor — gömmer evolutionen. (Notera: firmware har ofullständig
   per-puls-delta-implementering — `Burst_applyDeltas`-anropet är utkommenterat
   i `bsp_stm32g071.c:476`. Vi hedrar spec, inte buggen.)

7. **Phase som per-emit-flip för biphasic safety i synth-engine**. Den
   modelleringen är felplacerad — phase är descriptor-fält, inte
   engine-säkerhetslogik. Hardware (`bsp_stm32g071.c:832-840`) hard-rejektar
   phase ≥ 2 (only 0 and 1 valid → CCR1/CCR2 H-bridge gates).

## Hardware reality (verifierad mot källkod)

### Electrode topology
- 4 single-pole electrodes A/B/C/D (bitmask: A=1, B=2, C=4, D=8)
- En transformator + switch matrix (4× TLP268J opto-triacs)
- Per puls: `electrode_set[2]` = `[pos_mask, neg_mask]` — vilka electrodes på T+ och T-
- Hård invariant: `(pos & neg) === 0` (annars kortslutning, firmware loggar `"short in elcon"`)
- 9 giltiga elcon-kombinationer × 2 phase-bits = 18 distinkta puls-konfigurationer

### Phase = H-bridge gate selection
```c
// bsp_stm32g071.c:832-840
if (phase == 0) {
    pulse_timer->CCR1 = pulse_width_µs;  // CH1 → forward through transformer
} else if (phase == 1) {
    pulse_timer->CCR2 = pulse_width_µs;  // CH2 → reverse through transformer
} else return false;                      // We only have one output stage.
```
- Phase=0 = forward current (T+ side first)
- Phase=1 = reverse current (T- side first)
- Phase bits 2..1 = stage select (NeoDK har bara 1 stage → REJECT)

### Amp = primary voltage override
```c
// bsp_stm32g071.c:451-453
if (burst->amplitude != 0) {            // 0 means do not change.
    setPrimaryVoltage_mV(burst->amplitude * 40);
}
```
- Primary voltage är BOX-tillstånd (mutabel global), ändras av antingen
  IntensityPercent-write eller `amp != 0`-descriptor
- amp byte 0..255 ↔ primary voltage 0..10200 mV (× 40)
- amp=0 betyder INHERIT — den senast skrivna voltage:n står kvar

### Two-stage scheduling
1. **Schedule** (`BSP_scheduleBurst`, bsp:806): timer-compare på seq_clock
   - Validate ≥20µs margin från nu
   - Sätt `seq_clock->CCR1 = burst.start_time_µs` → IRQ när klockan når dit
   - Returnerar false → BAD_BURST-event om för sent
2. **Start** (`BSP_startBurst`, bsp:825): pulse_timer auto-fyrar N pulser
   - `ARR = pace - 1`, `RCR = nr_of_pulses - 1`
   - CCR1 eller CCR2 = pulse_width (driver H-bridge gate per phase)
   - CCR4 = ADC_HOLDOFF (10µs) → trigga ADC-sampling 10µs in i pulsen

### Stream-clock anchor
- `BSP_startSequencerClock(burst.start_time_µs - 200)` — klockan ankras 200µs
  före första bursts start_time
- → första puls fyrar exakt vid sin `start_time_µs`
- Stream-time-zero = första-emittade-burstens start_time
- För live-streaming (mixer-mode): start_time ≈ wall-time-since-Invoke-START
- För batch-mode: start_time kan vara framtida tider, klockan väntar

### Telemetri (Vcap/Vbat/Iprim)
- ADC samples 3 kanaler vid varje puls (CCR4 trigger 10µs in i pulsen)
- DMA skriver till `bsp.adc_1_samples[3]`
- **Push-event är KOMMENTERAT UT** (`bsp_stm32g071.c:616`) — host får inte
  per-puls ADC-data
- Värden hämtas via `BSP_triggerADC()` on-demand vid AI_VOLTAGES-read
- Subscribe på AI_VOLTAGES → `Attribute_changed`-events vid förändring,
  trigger-rate styrs av firmware (typiskt 10-30Hz, inte per-puls)

### Queue-kapacitet
- `PtdQueue_new(20)` — 20 descriptor-slots fördelat över 2 sub-köer (per phase)
- `nqbf[2]` rapporterar BYTES free per sub-kö → host får back-pressure
- Tids-kapacitet beror på burst-storlek:
  - Min: 1 puls × 5ms pace = 5ms per slot
  - Max: 65535 × 62.5ms ≈ 68 min per slot
- Mixer-mode (nr=1): 20 slots × 5..62.5ms = 100ms-1.25s buffer
- Brief §8 sweet spot 30-50ms target → ~5-10 descriptors queued

## Data model

### Wire-truth: `app.dispatchedDescriptors`
Behåll som idag — array av descriptors som host emittade, med wall-time-stamp.
**Source-of-truth för visualisering.**

```typescript
interface DispatchedDescriptor {
  readonly descriptor: PtDescriptor;
  readonly dispatchedAtMicros: number;  // wall-clock
  readonly queueIdx: 0 | 1;             // härledd från phase-bit
}
```

### Stream-time origin
Module-level state som ankras vid första dispatch under en run.

```typescript
let streamTimeOriginMicros: number | null = null;  // wall-clock vid run-start
// → streamTime(d) = d.dispatchedAtMicros - streamTimeOriginMicros
```

Reset vid runPattern() / startMixer() / Stop. Allt rendering räknar i stream-time.

### Expanded fired-pulse events (computed at frame-time)

```typescript
interface FiredPulse {
  readonly streamTimeMicros: number;     // start-time för denna puls
  readonly elcon: readonly [pos: number, neg: number];
  readonly phase: 0 | 1;
  readonly pulseWidthMicros: number;     // efter delta-application för denna puls i sin burst
  readonly paceMicros: number;           // pace fram till NÄSTA puls (för spacing)
  readonly effectivePrimaryVoltageMV: number;  // box-state vid fire-tid
  readonly sourceDescriptorSeq: number;  // bakåt-ref för debug
  readonly pulseIdxInBurst: number;      // 0..nr_of_pulses-1
}
```

**Expansion** (i frame-builder):
- För varje DispatchedDescriptor med `nr_of_pulses=N`:
  - Generera N FiredPulse-events
  - Pulse k har:
    - streamTime = descriptor.startTimeMicros + k × pace_k
    - pulseWidth = base_pw + k × delta_pw
    - pace_k = base_pace + k × delta_pace
    - phase = descriptor.phase (samma för alla pulser i burst)
    - elcon = descriptor.electrodeSet (samma)
- effectivePrimaryVoltageMV beräknas via state-trace:
  - State: senast skrivna primary-voltage (från IntensityPercent-events
    eller previous descriptors med amp≠0)
  - För denna descriptor: om `amp == 0` → inherit, annars `amp × 40` mV

### Primary voltage trace
Separat output från frame-builder. Lista av step-events:

```typescript
interface PrimaryVoltageStep {
  readonly streamTimeMicros: number;
  readonly voltageMV: number;
  readonly source: 'intensity-percent' | 'descriptor-amp';
}
```

Ritas som step-line över hela visualisering, separat lager.

### Frame data (vad renderer-komponenten konsumerar)

```typescript
interface OscilloscopeFrame {
  readonly streamNowMicros: number;       // current visualization "now" cursor
  readonly windowMicros: number;          // 6_000_000 default
  // En entry per electrode (alltid 4)
  readonly electrodeRows: readonly ElectrodeRowFrame[];
  // Global voltage trace (ritas separat ovanför/under elektroderna)
  readonly primaryVoltageSteps: readonly PrimaryVoltageStep[];
  // Telemetri (om aktiv): nedre band, ej i Oscilloscope
}

interface ElectrodeRowFrame {
  readonly electrode: 'A' | 'B' | 'C' | 'D';
  readonly bit: 1 | 2 | 4 | 8;
  // Pulser där denna elektrod är aktiv (på T+ eller T-)
  readonly pulses: readonly ElectrodeRowPulse[];
}

interface ElectrodeRowPulse {
  readonly streamTimeMicros: number;
  readonly pulseWidthMicros: number;
  readonly polarity: 'pos' | 'neg';   // T+ (varm) eller T- (kall)
  readonly amplitudeNorm: number;      // 0..1, härledd från effectivePrimaryVoltageMV
  readonly sourceDescriptorSeq: number;
}
```

**Mapping elcon → electrode-rows:** för en FiredPulse med
`elcon = [pos_mask, neg_mask]`:
- För varje bit i pos_mask: lägg till ElectrodeRowPulse med polarity='pos'
  (om phase=0) eller 'neg' (om phase=1) på respektive elektrod-rad
- För varje bit i neg_mask: motsatt polarity
- Phase=1 flippar polarity-färgningen för hela elcon

Exempel: descriptor med `elcon=[0b0101, 0b1010]` (AC↔BD), phase=0:
- A: polarity='pos' (varm)
- C: polarity='pos' (varm)
- B: polarity='neg' (kall)
- D: polarity='neg' (kall)

Samma med phase=1: alla flippar (A/C kall, B/D varm).

## Pipeline

```
emit-sink (host-side write to client)
    │
    ▼
app.dispatchedDescriptors (array, wire-truth)
    │
    │  [reactive trigger: bumps app.dispatchedVersion counter]
    ▼
frame-builder (30Hz timer, läser dispatchedDescriptors + intensity-history)
    │
    │  För varje frame:
    │    1. Filter dispatched i 6s-fönster
    │    2. Expand till FiredPulse[] (nr=1, deltas-applied, voltage-resolved)
    │    3. Mappa till electrode-rows
    │    4. Bygg primary-voltage step-lista
    │    5. Returnera OscilloscopeFrame
    ▼
app.oscilloscopeFrame ($state, ENA reactiv referens)
    │
    ▼
Oscilloscope.svelte (komponent, läser frame, renderar SVG/canvas)
    │
    ▼
DOM (SVG element med <rect>/<line> per pulse)
```

### Frame-rate decoupling
- Frame-timer kör vid 30Hz (33ms interval) — fast, oberoende av emit-rate
- Frame-builder läser `app.dispatchedDescriptors` (mutabel array, push-only,
  trim till 1500 entries) — INGEN reactivity per push
- Reactivity triggas en gång per frame när `app.oscilloscopeFrame = newFrame`
- Vid hög emit-rate (200Hz mixer): frame-builder gör mer expansion-arbete per
  frame men reactivity-rate förblir 30Hz

### Buffer-strategi för dispatchedDescriptors
- Plain array, push på sink, trim front om > MAX (1500)
- Reactive bara via en counter `app.dispatchedVersion = n+1` per N pushes ELLER
  vid frame-tick — låter Svelte-rendering trigga utan att processa varje push
- ALTERNATIV: lämna kvar `$state` på dispatchedDescriptors (deep proxy är lazy
  vid läsning — push triggar reactivity men frame-builder läser via $derived så
  Svelte hanterar batchning. Pröva enklare först, optimera om bits)

## UI model

```
┌──── Oscilloscope ─────────────────────────────────────────────────┐
│ legend: [polarity-key] [trace-key]                                │
│ time-axis: -6s -4s -2s now                                        │
│                                                                    │
│ Primary voltage:  ────step──┐_____step──────                      │
│                              └────────                             │
│         (orange step-line, separat lager ovanför electrode-band)  │
│                                                                    │
│ A   ▌  ▌▌  ▌▌▌  ▌  ▌▌▌▌  ▌▌  ▌  ▌▌▌▌                            │
│       (varm = T+, kall = T-, höjd = pulse_width, opac = amp)     │
│ B   ▌▌▌  ▌  ▌▌  ▌▌▌▌▌  ▌▌▌▌                                      │
│ C   ▌▌  ▌▌▌  ▌  ▌▌  ▌▌▌▌▌▌                                       │
│ D   ▌  ▌▌▌▌  ▌▌▌  ▌  ▌▌▌                                         │
└────────────────────────────────────────────────────────────────────┘
```

### Per-electrode-row layout
- 4 fasta rader (A, B, C, D) — alltid synliga, oavsett vilka elcons aktiva
- En puls = en `<rect>` (eller canvas-rect) på alla aktiva electrode-rader
- Bredd = `pulseWidthMicros` skalat till SVG-units
- Höjd = full row-height (justerbar via amp om vi vill)
- Färg = polaritet (varm/kall, t.ex. orange/blå)
- Opacitet = `amplitudeNorm` (0..1)

### Visual encoding lock
- **Polaritet → färg** (varm/kall)
- **Pulse width → bredd** av rect
- **Amplitude → opacitet** av rect (eller höjd, men opacitet matchar UX-mockup-mönstret bättre)
- **Time → x-position**
- **Electrode → y-rad**

Detta är en deklarativ, hardware-truthful visualisering. Ingen interpolation,
inga step-lines mellan pulser, inga sample-buffrar.

## What's deleted vs kept vs new

### Deleted
- `docs/designs/ALPHA2_DESCRIPTOR_OSCILLOSCOPE.md`
- `src/mock-firmware/waveform.ts` (WaveformGenerator)
- `test/mock-firmware/waveform.test.ts`
- `src/ui/Oscilloscope.svelte` (current per-elcon implementation)
- `src/ui/descriptor-timing.ts` (mean-helpers som gömmer deltas)

### Kept (verifiering ingår i eng-review)
- `src/protocol/descriptor.ts` — wire-format, matchar PulseTrainDescr.md
- `src/protocol/neodk-client.ts` — transport, matchar neodk.js
- `src/protocol/hardware-bounds.ts` — gränser från burst.h
- `src/patterns/types.ts`, `builtins.ts`, `runner.ts` — 5 firmware-patterns
- `src/mock-firmware/firmware.ts` — frame-protokoll, attribute-routing
- `src/safety/*` — ramp-controller, max-ceiling, single-chokepoint clamp
- `src/synth/*` — mixer-input-modell (channels, LFOs, cables, engine)
- `src/ui/Monitor.svelte` — utökas med Vcap/Iprim-rader
- `src/ui/synth/*` — Knob, MixerChannel, LFOModule, CableLayer, Mixer-panel
- `src/ui/PatternRunnerBar.svelte` — kvar som test-source
- `src/dev/test-helpers.ts` — RPA-hooks (utan waveform-specifika)

### New
- `docs/designs/BETA_OSCILLOSCOPE.md` (denna doc)
- `src/oscilloscope/types.ts` — FiredPulse, PrimaryVoltageStep, frame-types + `streamTime()` pure helper
- `src/oscilloscope/expand.ts` — pure: descriptor + delta + state → FiredPulse[]
- `src/oscilloscope/voltage-state.ts` — pure: voltageHistory + streamTime → effective voltage
- `src/oscilloscope/frame-builder.ts` — pure: dispatched + voltage-history + now → frame
- `src/oscilloscope/electrode-mapping.ts` — pure: FiredPulse → ElectrodeRowPulse[]
- `src/ui/Oscilloscope.svelte` — ny komponent, läser app.oscilloscopeFrame
- `test/oscilloscope/expand.test.ts`
- `test/oscilloscope/voltage-state.test.ts`
- `test/oscilloscope/frame-builder.test.ts`
- `test/oscilloscope/electrode-mapping.test.ts`
- `test/oscilloscope/types.test.ts` — streamTime() helper

OBS: ingen ny `voltages-simulation.ts` (eng-review T2 — vi utökar existerande `src/mock-firmware/voltage-sim.ts` istället för att skapa ny).

### Modified
- `src/ui/stores.svelte.ts`:
  - Ta bort `app.waveformBuffers`, `app.waveformNowMicros`, `app.activeTraces`
  - Lägg till `app.oscilloscopeFrame`, `app.streamTimeOriginMicros`
  - Konvertera `app.dispatchedDescriptors` till `$state.raw`
  - Frame-timer (30Hz setInterval) som anropar frame-builder och sätter app.oscilloscopeFrame
  - PURGE dispatched-buffer + reset stream-origin vid runPattern/startMixer (löser origin-reset-inkonsistens)
- `src/ui/Mixer.svelte`:
  - Auto-show electrode-rows (alltid visa A/B/C/D, ingen elcon-filtering)
- `src/mock-firmware/voltage-sim.ts`:
  - Lägg till `onPulseFired(amp_byte, phase, simNowMicros)` för per-puls-vcap-dipp
  - Bevara existing intensity-baseline + RC-recovery
- `src/mock-firmware/firmware.ts`:
  - Ta bort waveform-generator-bridge (waveform.ts borttagen)
  - Anropa voltage-sim.onPulseFired() vid descriptor-dispatch
  - Emit voltages-events vid 30Hz från voltage-sim.read()
- `src/ui/Monitor.svelte`:
  - Säkerställ Vcap/Iprim-sparklines visas (om inte redan där)

## Tests

### Unit (pure functions, deterministiska)
- `expand.test.ts`:
  - nr=1, no deltas → 1 FiredPulse med descriptor-värden
  - nr=10, delta_pw=4 → 10 pulses med pw evolverande 20→29 (i ¼µs-units)
  - nr=10, delta_pace=200 → 10 pulses med pace evolverande, streamTime ackumuleras
  - Clamp: pw clampas till MIN/MAX (`burst.h`-gränser)
- `voltage-state.test.ts`:
  - Initial: voltage=0
  - After IntensityPercent=50: voltage = ?? (mappa via firmware-formel)
  - After descriptor amp=200: voltage = 8000mV
  - After descriptor amp=0: voltage unchanged
  - Multiple events, ordered by streamTime
- `electrode-mapping.test.ts`:
  - elcon=[A, B], phase=0 → [{A: pos}, {B: neg}]
  - elcon=[AC, BD], phase=0 → [{A: pos}, {C: pos}, {B: neg}, {D: neg}]
  - elcon=[AC, BD], phase=1 → flipped (A/C neg, B/D pos)
- `frame-builder.test.ts`:
  - End-to-end: dispatched → expanded → mapped → frame
  - Window filter: events utanför 6s-fönster ej inkluderade
  - Stream-time normalization: events får streamTime relativt origin

### Integration (efter implementation)
- Pattern Toggle körs → Oscilloscope visar 4 elektrod-rader med rätt
  pulse-pattern (verifierbart mot patterns312/Toggle.csv om vi har replay-test)
- Mixer pace=10ms, modulering aktiv → pulses syns evenly distribuerade
- amplitude=0 descriptor → primary voltage trace ej step:ar (inherits)

## Stream-time origin handling (post eng-review)

Använd `descriptor.startTimeMicros` (stream-clock-domän) som tidsbas, INTE `dispatchedAtMicros` (wall-clock). Synth-engine och pattern-runner sätter redan startTime relativt session-start.

```typescript
// stores.svelte.ts
class AppState {
  // ...
  streamTimeOriginMicros = $state<number | null>(null);
  // dispatchedDescriptors är $state.raw — perf-låst
  dispatchedDescriptors = $state.raw<DispatchedDescriptor[]>([]);
  // ...
}

function startStream() {
  // PURGE buffer (eng-review locked: undviker origin-reset-inkonsistens)
  app.dispatchedDescriptors = [];
  app.streamTimeOriginMicros = null;
  // ... start engine/runner
}

// I sink:
function onDispatch(d: PtDescriptor) {
  if (app.streamTimeOriginMicros === null) {
    // Ankor vid första descriptors stream-time
    app.streamTimeOriginMicros = d.startTimeMicros;
  }
  // dispatchedAtMicros = wall-clock för debug/CSV-export endast
  // streamTime härleds via descriptor.startTimeMicros - origin i frame-builder
  const next = [...app.dispatchedDescriptors, {
    descriptor: d,
    dispatchedAtMicros: performance.now() * 1000,
    queueIdx: (d.phase & 1) as 0 | 1,
  }];
  // Trim om över cap
  if (next.length > DISPATCHED_BUFFER_CAP) next.splice(0, next.length - DISPATCHED_BUFFER_CAP);
  app.dispatchedDescriptors = next;
}

// I oscilloscope/types.ts (single source of truth)
export function streamTime(
  descriptorStartTimeMicros: number,
  originMicros: number | null,
): number {
  if (originMicros === null) return 0;
  return descriptorStartTimeMicros - originMicros;
}
```

För batch-mode (framtid): samma kod fungerar — `descriptor.startTimeMicros` kommer vara framtida värde, origin = lägsta startTime, alla pulses normaliseras relativt det.

## Locked decisions (post eng-review 2026-05-02)

### Architecture
- **`app.dispatchedDescriptors` använder `$state.raw`** — undviker deep-proxy-overhead vid 200Hz emit. Mutationer kräver reassign men frame-builder läser hela arrayen ändå. (Eng-review T1.)
- **Direkt rip-and-replace på main**, ingen feature flag, ingen legacy-katalog. Accepterar reversibility-cost. (Eng-review reversibility-fråga.)
- **Frame-builder som separat modul behålls** (inte $derived-alternativ). Explicit pipeline för testbarhet. (Eng-review cross-model T1.)
- **Stream-time origin baseras på `descriptor.startTimeMicros`** (stream-clock-domän), INTE `dispatchedAtMicros` (wall-clock). Synth-engine och pattern-runner sätter redan `descriptor.startTimeMicros` relativt session-start. Origin = `firstDescriptor.startTimeMicros`, alla pulses-streamtimes är `descriptor.startTimeMicros - origin`. (Outside-voice finding 2.)
- **Dispatched-buffer PURGE vid stream-start** (runPattern, startMixer). Löser origin-reset-inkonsistensen från outside-voice finding 1. (Open Q1 resolved as: purge.)

### Code quality
- **`app.activeTraces`-toggle borttaget** för v1. Bygg vid behov.
- **Pure-modul-konvention** via JSDoc-header per fil i `src/oscilloscope/*`.
- **Stream-time helper** centraliseras i `src/oscilloscope/types.ts`. Single source of truth för wall→stream-konvertering.

### Voltage simulation
- **Utöka existing `src/mock-firmware/voltage-sim.ts`** med `onPulseFired(amp_byte, phase, now)`-metod. Lägg per-puls-dipp ovanpå existing intensity-baseline-RC-modell. INGEN ny modul (file-collision undviks). (Eng-review T2.)
- Mock-firmware emit-rate för voltages-events: 30Hz lock.

### Telemetri
- **Vcap-trace läser från real `app.voltageHistory`** (Vcap_mV-fältet), INTE host-side-approximation. Mock-firmware måste skicka realistiska Vcap-events via voltage-sim.ts-utökningen. (Eng-review T2 + outside voice finding 3.)

### Sequencing
- **Implementation-ordning enligt steg 1-15** men acceptera temporärt broken main mellan commits. Push först när build+test grön. (Eng-review T3.)

### Validation
- **`phase` bits 2..1 hard-reject** i client-side validering. Matchar firmware (`bsp_stm32g071.c:840 return false`).
- **Delta-application: hedra spec, dokumentera firmware-divergens** (firmware har Burst_applyDeltas-anrop utkommenterat). Vid clamp tillämpas `MIN_PULSE_WIDTH_¼µs=8` och `MAX_PULSE_WIDTH_¼µs=800` per `inc/burst.h`.

## Outside-voice findings noted (informational)

- **Polaritet→färg är UX-val, inte hardware-truth**: phase=0/1 driver olika H-bridge gates (CCR1/CCR2). Per-electrode strömriktning är samma fysiska kvantitet, bara biphasic-pair-första-halvan flippar. Vår "varm/kall"-encoding är användarfriendly approximation, inte fysisk sanning. OK för v1; dokumenteras.
- **UX-encoding ovaliderat med riktiga användare**: privata hobby-projekt så ingen N=2 user-test. Acceptabelt scope för v1.

## Open questions for eng-review

1. **Ska Mixer-mode rensa `app.dispatchedDescriptors` vid Stop?** Eller behålla
   för historik? Idag rensar vi vid start. Min lutning: behåll, så Oscilloscope
   visar senaste 6s även efter Stop (rolling fortsätter, men inga nya events).

2. **Frame-builder timer: setInterval(33) eller rAF?** rAF är vsync-synkad
   (60Hz på flesta skärmar) men pausar vid hidden tab. setInterval är robust
   men kan drifta. Min lutning: setInterval(33) för förutsägbarhet, frame-builder
   är pure-function så ingen vinst med rAF för vår use-case.

3. **Canvas-redo nu, eller bara förberedd via plain-data-frame?** Frame-data är
   redan plain (inga SVG-strängar), så canvas-migration är trivial om SVG bits.
   Jag skippar canvas i v1, mäter, migrerar om perf bits.

4. **Vad händer med `app.activeTraces`-toggle (amp/vcap/pulse-width/pace)?** I
   nya modellen är det inte längre "vilka traces ritas" — vi har ett UI-koncept.
   Min lutning: ta bort den tills vi har behov, lägg till per-modul toggle senare.

5. **Mock-firmware Vcap-simulering: var?** I `MockFirmware`-klassen, periodisk
   timer som emitterar `voltages`-event. Realistisk RC-modell: Vcap baseline
   ≈ Vbat, dippar ~200-500mV vid varje puls (proportional mot amp), recoverar
   med τ ≈ 50ms. Implementation: tillstånd i firmware-sidan, dippar vid emit,
   recoverar vid timer-tick.

6. **`PatternRunnerBar` som test-source: vad emittar den till?** Idag genererar
   den PT-descriptors host-side från built-in patterns. Den modellen funkar
   fortfarande — descriptors hamnar i `app.dispatchedDescriptors`. Den blir
   wire-known-good test-trigger för nya Oscilloscope.

7. **Stream-time vs wall-time i `dispatchedAtMicros`-fältet:** Behåll wall-time
   där (det är dispatch-tidpunkten på host), beräkna stream-time on-the-fly i
   frame-builder via origin-subtraction. Renare än att förändra fältet.

8. **Behåller vi `app.intensityHistory` (eller utökar voltageHistory) med
   IntensityPercent-events?** För voltage-trace behövs både IntensityPercent
   och descriptor-amp som källor. Lättast: utöka stores.svelte.ts med en
   separat `intensityHistory: Array<{ts, percent}>`.

## Implementation order

```
1. Doc lock (denna fil + eng-review approval)        ← här nu
2. New module skeleton (src/oscilloscope/types.ts)
3. expand.ts + tests
4. voltage-state.ts + tests
5. electrode-mapping.ts + tests
6. frame-builder.ts + tests (end-to-end pure)
7. Delete old files (waveform.ts, descriptor-timing.ts, old Oscilloscope.svelte)
8. Update stores.svelte.ts (frame-state, frame-timer, stream-origin)
9. New Oscilloscope.svelte (consumes frame, SVG render)
10. Mock-firmware Vcap-simulering
11. Monitor.svelte: lägg till Vcap/Iprim-rader
12. Update tests + RPA test-helpers
13. End-to-end verifiering med PatternRunnerBar (Toggle, Jackhammer, Itch)
14. Mixer-läge re-test (pace=6.2ms case som triggade redesign)
15. Delete ALPHA2_DESCRIPTOR_OSCILLOSCOPE.md
```

Step 1-6 är pure-function-arbete, helt testbart utan UI. Stegen 7-14 har
beroenden men är linjära. Step 15 sist så vi kan referera den vid behov
under refactor.

## Non-goals (uttalat)

- **Canvas-migration**: skjuts om SVG räcker
- **Hover-tooltip / pulse-detail-panel**: framtida
- **Zoom/pan på timeline**: framtida
- **Vcap som per-elcon-trace**: explicit removed, hör hemma i Monitor
- **CSV-replay overlay**: skjuts
- **Stream-clock 71-min wraparound**: framtida (long-session-handling)
- **Multi-stream (parallella PT-streams)**: när real hardware tillgänglig
- **Per-puls Iprim/Vcap-mapping**: firmware pushar inte denna granularitet idag

## What already exists (reuse, not rebuild)

| Existerande | Hur planen återanvänder |
|---|---|
| `app.dispatchedDescriptors` (stores.svelte.ts) | Wire-truth source-of-truth, behålls (konverteras till `$state.raw`) |
| `app.voltages` + `app.voltageHistory` (stores.svelte.ts) | Vcap-trace-källa, redan populerad via `client.on('voltages')`-event |
| `src/mock-firmware/voltage-sim.ts` (VoltageSim-klass) | Utökas med `onPulseFired()`, befintlig RC-baseline + Vbat/Iprim behålls |
| `src/protocol/descriptor.ts` + `hardware-bounds.ts` | PT-descriptor wire-format, MIN/MAX-konstanter — direkt återanvänt |
| `src/protocol/neodk-client.ts` | Transport + EventEmitter, `voltages`-event redan emitterad |
| `src/patterns/runner.ts` + `builtins.ts` | PatternRunner emittar PT-descriptors → dispatched-buffer (test-source) |
| `src/synth/synth-engine.ts` + `state.ts` + `lfo.ts` | Mixer-input-modell, oförändrad |
| `src/safety/ramp-controller.ts` + `max-ceiling.ts` + `clamp.ts` | Single-chokepoint amp-clamp tillämpas i emit-sink |
| `src/ui/Monitor.svelte` | Telemetri-panel, Vcap/Iprim säkerställs |
| `src/ui/synth/*` (Knob, MixerChannel, LFOModule, CableLayer) | Composer-UI, oförändrad |
| `src/ui/PatternRunnerBar.svelte` | Test-source för Toggle/Jackhammer/etc. |
| `src/dev/test-helpers.ts` | RPA-hooks, uppdateras med nya frame-format-accessors |

## Failure modes (per nytt codepath)

| Codepath | Realistisk failure | Test? | Error handling? | Användare ser? |
|---|---|---|---|---|
| `expand.ts` med nr=65535 + delta_pw≠0 | Numeric overflow i pw-ackumulering | ✅ planerat | Clamp till MAX_PULSE_WIDTH | Korrekt clampad puls |
| `expand.ts` med nr_of_pulses=0 | Tom array (firmware rejecterar men host kan ta emot) | ✅ planerat | Returnera `[]` | Inga pulser ritas (korrekt) |
| `voltage-state.ts` empty history | undefined indexing → NaN i trace | ✅ planerat | Returnera 0 | Trace platt på 0V (korrekt) |
| `electrode-mapping.ts` elcon=[0,0] | Inga aktiva electrodes | ✅ planerat | Returnera tomt set | Inga markers ritas |
| `electrode-mapping.ts` phase ≥ 2 | Invalid stage (firmware rejecterar) | ✅ planerat | Skipa rendering | Inga markers ritas |
| `frame-builder.ts` empty dispatched | Tomt fönster vid first-run | ✅ planerat | Producera frame med tomma rows | Tomma electrode-rows |
| Frame-timer kör vid component-unmount | Timer-leak | ⚠️ regression-test | clearInterval i $effect cleanup | Ingen synlig effect, internal leak |
| `voltage-sim.onPulseFired` nan-amp | NaN propagerar till Vcap | ✅ planerat | clamp(amp, 0, 255) i sim | Trace stannar vid baseline |
| `dispatchedDescriptors`-buffer overflow | Cap=1500 nås, splicing kan vara dyr | ⚠️ perf | splice O(N), acceptabel cost | Äldsta pulser försvinner |
| Stream-origin null + descriptor anländer | streamTime returnerar 0 (alla pulses vid t=0) | ✅ planerat | Origin sätts vid första dispatch | Pulses startar vid window-vänster |
| Mock-firmware emit-rate skiljer från frame-rate | Voltage-trace stuttery | ⚠️ visual-test | 30Hz lock matchar | Trace smooth |

**Critical gap candidates:** Frame-timer leak vid component-unmount — om Oscilloscope unmountas (mode-switch t.ex.) utan att rensa intervalet → memory leak + frame-state continuera att skrivas. Mitigation: `$effect` cleanup-callback. Måste verifieras med regression-test.

## Worktree parallelization

Sequential implementation (eng-review T3 låst: ingen branch, accepterar tempo. broken main).
Pure-moduler kan teoretiskt utvecklas parallellt men deras low-cost gör sekvens enklare.

| Steg | Modul | Beror på |
|---|---|---|
| 1 | Doc lock | — |
| 2-6 | Pure modules + tester | sekventiell (dependency-träd: types → expand → voltage-state → electrode-mapping → frame-builder) |
| 7-9 | Delete old + stores update + new Oscilloscope.svelte | beror på 2-6 |
| 10 | voltage-sim.ts onPulseFired | parallel med 7-9 möjligt |
| 11 | Monitor.svelte Vcap/Iprim | beror på 10 |
| 12-13 | Tests + RPA-helpers | beror på 7-11 |
| 14-15 | E2E-verifiering + delete legacy doc | beror på allt |

Inga parallella worktrees rekommenderas. Repo-mode = solo, push först när allt funkar.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run for this plan |
| Outside Voice | `/codex review` (Claude subagent) | Independent challenge | 1 | issues_found | 5 risks flagged, 3 cross-model tensions resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 9 issues, 1 critical gap (frame-timer leak), 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | brief §4 + §11 räcker som riktning |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | n/a |

**OUTSIDE VOICE:** Claude subagent flaggade 5 risker. 3 cross-model tensions resolverade via AskUserQuestion (T1=B behåll frame-builder, T2=A utöka voltage-sim, T3=C accept temporärt broken main). 2 findings (origin-reset-inkonsistens, wall-vs-stream-mixing) accepterade som korrigeringar oavsett T1.

**CROSS-MODEL:** Eng-review identifierade 5 issues, outside voice fångade 5 till. Överlapp: 0 (oberoende perspektiv). Total 10 issues, 9 låsta, 1 critical-gap-test (frame-timer leak) i regression-suite.

**UNRESOLVED:** 0

**VERDICT:** ENG CLEARED — ready to implement per locked decisions. PRE-IMPLEMENTATION: docs/designs/ALPHA2_DESCRIPTOR_OSCILLOSCOPE.md tas bort i sista commit (efter ny Oscilloscope verifierad).

## Risk register

| Risk | Mitigation |
|---|---|
| SVG paint för långsam vid 1200+ rects per frame × 4 rader | Frame-data är plain, canvas-migration enkel om bits |
| `app.dispatchedDescriptors` deep-proxy reactivity overhead vid 200Hz emit | Cap till 1500, batchning via reactive counter, alternativt $state.raw |
| Stream-time-origin sätts fel vid batch-mode (descriptor med start_time>0) | Tydligt: origin = wallNow - first.startTimeMicros, fungerar för båda lägen |
| Delta-application clampning matchar inte firmware (firmware har bug — kommenterat ut) | Vi hedrar spec, dokumenterar avvikelse mot nuvarande firmware |
| Mock Vcap-simulering avviker från real hardware | OK — när hardware finns kalibrerar vi mot riktiga voltages-events |
| Test-coverage för delta-edge-cases (clamp, sign, large nr_of_pulses) | Property-based tests för expand.ts |

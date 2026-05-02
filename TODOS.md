# TODOS

## β.1 — Real hardware bring-up

### Protocol-routing: Invoke START/STOP via NeoDKClient

**What:** Implementera `NeoDKClient.invokePtQueueStart()` och `invokePtQueueStop()` som skickar OPCode.InvokeRequest med EE_BOOLEAN_TRUE/FALSE på AI_PT_DESCRIPTOR_QUEUE. Uppdatera `runPattern`/`startMixer` i `stores.svelte.ts` så de skickar Invoke START efter första writePtDescriptor (per `sequencer.c:269` kräver real firmware att queue är non-empty innan stateStreaming triggas). Stop-flow: cancel.cancelled + await loop-exit + await invokePtQueueStop. Mock-firmware: lägg till Invoke-handler i handleDatagram för AI_PT_DESCRIPTOR_QUEUE som transitar state.PlayState. Ta bort mockFw.onPulseFired-hacket (mock-only kod) — voltage-sim aktiveras nu via protokollet.

**Why:** Fixar två arch-issues som outside voice flaggade men sköts till real-hardware-bring-up: (1) DAW->mock direct-invoke bypass:ar Transport (bryter protocol boundary), (2) real firmware kommer aldrig att leverera output utan Invoke START — vår host-emit-mode skulle silent-fail på riktig hardware. Att fixa nu via mock säkerställer att första real-hw-bring-up bara funkar.

**Context:** Phase A i `docs/designs/BETA_DAW_VIZ_BOUNDARY.md` skissade detta men reducerades till one-liner per outside voice's strategic-miscalibration-feedback. Routingen sparades till denna TODO. Outside voice's Risk A: ordering måste vara write-first → START (inte START-first). Outside voice's Risk B: PlayState notify spam — gate notify på state-change (only fire if old != new).

**Effort:** M (CC ~2h)
**Priority:** P2 (när real NeoDK ansluts; inte blockerande för mock-driven β.0)
**Depends on:** Real hardware + verifiering mot riktig firmware-state-machine

### β.0 polish: DAW/Viz boundary-clarity comments

**What:** Top-of-file JSDoc-headers per modul i `src/synth/`, `src/oscilloscope/`, `src/ui/` som klargör layer-roll (DAW composition / Viz consumption / Bridge state). Plus rensa dead-comments från α2-eran i stores.svelte.ts (referenser till waveform.ts-flödet).

**Why:** Codebase navigerings-klarhet. Sänker on-boarding-cost när hjälpare/AI-coder kommer in i projektet.

**Context:** Phase B i BETA_DAW_VIZ_BOUNDARY.md, deferred. Inga funktionella ändringar.

**Effort:** XS (CC ~30 min)
**Priority:** P3

### β.1 prep: Channel-identity i DispatchedDescriptor

**What:** Utöka `DispatchedDescriptor` med `meta?: { sourceTag?: string }` host-side metadata. Synth-engine och pattern-runner sätter sourceTag (channel.id eller pattern.name). Viz använder för subtle color-coding av multi-channel mixer.

**Why:** Multi-channel mixer (β.1-mål) behöver visualisera channel-identitet. Utan detta blandar pulser från olika channels in i samma rad utan visuell distinktion.

**Context:** Phase C i BETA_DAW_VIZ_BOUNDARY.md, deferred. Användarens directive "Mixer HELT skilt från viz" gör off-protocol metadata till en design-fråga som behöver tas igen vid β.1.

**Effort:** S (CC ~1h)
**Priority:** P3 (vid β.1 multi-channel-arbete)

## Pattern Engine (γ-prep — supersedes β-prep efter β-mixer-plan 2026-05-01)

### Pattern + Bank + Scene data-structures + JSON-schema

**What:** TS-types och Zod-validering för `Pattern` (en sekvens av PT-descriptors med en längd), `Bank` (samling pattern), `Scene` (en konfiguration av aktiva patterns + parametrar). Ingen UI än.

**Why:** γ-wedge är scene-launcher + pattern-bibliotek. Att starta γ med datalagret redan på plats sparar dagar av "vad är ens en pattern?" och retrofit-arbete.

**Context:** CEO plan cherry-pick #3 (DEFERRED från α2). β-mixer (live-jam) tar inte upp persist; γ tar upp pattern-bibliotek + scene-launcher. Bygger ovanpå `src/fileformat/`-schemat etablerat i α.

**Effort:** S (CC ~1-2h)
**Priority:** P3
**Depends on:** β-mixer shippad (för att veta vad en "scene" är i mixer-context)

### Web MIDI API skeleton

**What:** `MIDIController`-modul (`src/midi/controller.ts`) som listar tillgängliga MIDI-inputs, lyssnar på message events, och routar dem till en EventEmitter. Inga mappings till performance-controls — bara råa events.

**Why:** Stim-som-instrument-visionen är att solo-användare ska kunna styra mixer-knobbar och LFO-rate med en MIDI-controller (en hand). Att ha skelettet på plats betyder β.1 kan börja med "hook upp en knob till intensity" istället för att börja med Web MIDI API discovery.

**Context:** CEO plan cherry-pick #4 (DEFERRED från α2). Web MIDI API är browser-built-in. Liten modul (~100 rader). Kräver `navigator.requestMIDIAccess()` permission-handshake på första-användning.

**Effort:** XS (CC ~30min)
**Priority:** P2
**Depends on:** β-mixer shippad (för att ha knobs att binda till)

## β-deferred items (från CEO plan 2026-05-01)

### E4 — Routing-validering (kortslutnings-skydd)

**What:** Logik som detekterar elektrod-kortslutningar mellan multipla mixer-channels. Multi-channel scenario: Channel A spelar AC>BD vid t=100ms, Channel B spelar AC<BD vid t=100ms → samma elektroder aktiva med motsatt polaritet samtidigt = potentiell kortslutning på switch matrix.

**Why:** Hardware-säkerhet. β.0 förlitar sig på att firmware-side queue + hardware-routing hanterar per-burst, men edge cases (interleaved channels med overlapping elcons) kräver dedicated design-runda.

**Context:** Behöver design-runda — inte bara "samma elcon" är problem, utan tids-överlapp av aktiva elcon-set kan skapa transient kortslutningar. Möjliga lösningar: (a) priority-system (E5 nedan), (b) channel-mute när konflikt, (c) firmware-utökning för multi-channel-aware queue.

**Effort:** M (human ~3 dagar / CC ~4h)
**Priority:** P1 (när real hardware testas — annars P2 i mock)
**Depends on:** β-mixer multi-channel + real NeoDK hardware för validering

### E5 — Priority overrides för channel-konflikter

**What:** När routing-validering (E4) detekterar konflikt: lägre-prio channel mute:as eller throttlas tills konflikten löses. UI: prio-slider per channel.

**Why:** Användaren behöver deterministiskt veta vilken channel som vinner vid konflikt — inte random "first-come-first-served".

**Context:** Bygger på E4. Kan göras enkelt (1-N integer prio per channel) eller komplext (per-knob prio, channel-grouping). Start enkelt.

**Effort:** S (CC ~2h)
**Priority:** P2
**Depends on:** E4 (routing-validering måste vara på plats)

### E7 — LFO sync-modes (free / tempo / one-shot)

**What:** Utöka LFO med mode-selector. **Free:** kontinuerlig fas (β.0-default). **Tempo:** sync till global BPM (kräver BPM-state). **One-shot:** envelope-mode, triggas av event, kör cykel sen tystnar.

**Why:** Performance-känsla. Free-mode är OK för β.0 men sync-modes ger rytmisk kontroll och envelope-mode möjliggör "key-triggered" effekter.

**Context:** Tempo-sync förutsätter global BPM som inte finns i β.0. One-shot kan implementeras utan BPM. Phase-tracking redan på plats (LFO.phase) så modes blir state-machine ovanpå.

**Effort:** S (CC ~2h)
**Priority:** P3
**Depends on:** β.0 LFO-fundament + (för tempo) global BPM-state

### E8 — Save mixer-state till .stimdaw v1

**What:** Utöka filformat med mixer-config (channels, LFOs, cables, knob-positions). Reload återställer hela rigget.

**Why:** Reproducerbarhet. Användaren bygger ett mixer-rig de gillar, vill spara det och plocka upp senare.

**Context:** Bygger på `src/fileformat/io.ts` befintliga Zod-schema. Bump version till v1, lägg till migration v0 → v1 (existing v0 har bara safety-defaults, mixer-state defaultas till tom).

**Effort:** S (CC ~2h)
**Priority:** P3 (γ-prep snarare än β.0)
**Depends on:** β.0 mixer shippad (känner full datamodell)

## β.1 polish (post-β.0)

### Knob halo (visualisera mod-swing-range)

**What:** Runt varje modulerad knob: en svag halo/ring som visar minimum-och-maximum-värdet LFOn modulerar inom. Knob-position själva rör sig inte (Reason-style), men användaren ser swing-range.

**Why:** Visual feedback för "vad kommer den här knobben göra över tid". Utan halo måste man kolla på Oscilloscope för att se mod-swing.

**Effort:** XS (CC ~1h)
**Priority:** P2 (β.1)

### LFO mini-scope inside LFO-panel

**What:** Liten waveform-display direkt i LFO-modulen som visar shape × rate × amount. ~80×40px svg.

**Why:** Live-feedback för LFO-tweaking utan att leta efter resultatet i mixer-output.

**Effort:** S (CC ~1-2h)
**Priority:** P3 (β.1)

### Undo / redo

**What:** Stack av MixerState-snapshots. Ctrl+Z back, Ctrl+Y forward. Cap till 50 entries.

**Why:** Live-jam-fail-recovery. "Oj, drog fel cable" — undo.

**Effort:** S (CC ~2h)
**Priority:** P3 (β.1)

### Keyboard shortcuts

**What:** Space = play/stop, Esc = STOP (samma som button), Cmd+S = save (när E8 finns).

**Why:** DAW-norm.

**Effort:** XS (CC ~30min)
**Priority:** P3 (β.1)

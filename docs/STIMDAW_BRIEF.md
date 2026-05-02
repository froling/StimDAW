# StimDAW — Project Brief

> Vision, projekt-kontext, scope-locks. Läs detta först när du tar över.
>
> **Hardware-spec och protokoll** finns i [HARDWARE.md](HARDWARE.md).
> **Aktuell kod-arkitektur** finns i [ARCHITECTURE.md](ARCHITECTURE.md).
> **Ship-historik och design-rationale** finns i [designs/](designs/).

---

## Vad är StimDAW?

En DAW-likt klient för **NeoDK** — en open-source e-stim dev-board ([Onwrikbaar/NeoDK](https://github.com/Onwrikbaar/NeoDK)). StimDAW exponerar hela protokollets djup, inte bara det enkla intensity/pattern-UI:t som följer med firmware.

**Långsiktig vision:** modulär realtidsdrift av pulse train descriptors, med visuell timeline-redigering som låter användaren komponera komplexa stimuleringsförlopp som musik i en DAW.

**Mental modell:** stim som live-instrument, inte som verktyg där man redigerar JSON-filer. Mixer + LFOs + patch-cables (Reason-paradigm) ger "spela boxen" istället för "programmera boxen".

---

## Användarens kontext

- **Privat hobby-projekt.** Separerat från Anome AB, byggt på fritid.
- **Hårdvaran är beställd, ej levererad än:** 5 PCB + 2 PCBA från JLCPCB. THT-komponenter och tillbehör (Xicon transformator, Cliff FC68131 jack, JST XH-kontakter, FSMRA6JH knapp, Gainta G404 låda, FTDI USB-TTL-kabel) från Mouser. Pomona 2 mm guld-pluggar för elektrodkontakter.
- **Power-konfiguration:** 9V PP3 i G404:s inbyggda batteri-kompartment (ger ~80V max output, accepterad kompromiss för enklast bygge). 12V wall-wart kan kopplas via DC-jack senare för full prestanda.
- **All utveckling mock-driven** tills hårdvara landar. Mock-firmware implementerar protokollet enligt spec, inkl. Vcap-RC-modell + per-puls-Vcap-dipp.

---

## Scope-locks (HÅRDA non-goals)

Beslutat 2026-04-29, omförhandlas inte utan väldigt stark anledning:

- **NeoDK-only.** Ingen abstraktion för andra e-stim-protokoll (zc95, FOC-Stim, ET-312, e-stim-pl). Protokoll-lagret är NeoDK-specifikt — ingen generic `Protocol`-interface, inga adapter-lager.
- **Single device.** En NeoDK i taget. Inget device-manager, ingen multi-port-skanning.
- **Generic e-stim platform — NEJ.** Vi bygger inte "en DAW för alla e-stim-enheter". Vi bygger ett verktyg för den hardware vi har.
- **Inte mikrosekund-resolution waveform.** Oscilloscope visar dispatched-descriptors (per-puls-events), inte sample-buffer. Sub-sample-rendering ligger på γ-roadmap om någonsin.

---

## Repo-struktur

- StimDAW = egen klient, eget release-tempo
- Modifierar inte firmware eller hårdvara → ingen fork-soppa
- NeoDK ligger som git submodule under `reference/NeoDK/` (för protokoll-spec, firmware-källkod att referera, patterns312-CSVs)

---

## DAW-likt streaming-mönster

```
User input → Generator graph → Scheduler → UART writer → Firmware queue
                                    ↑
                                    │
                  AI_PT_DESCRIPTOR_QUEUE notifications (back-pressure)
```

- **Generators** = moduler (LFO, envelope, pattern lib, manual knob) som producerar deskriptorer on-demand utifrån current state
- **Scheduler** = håller ~50 ms framtidsbuffert, lyssnar på back-pressure från enheten
- **Aldrig pre-generera hela låten** — generators evaluerar "nästa deskriptor" lat så att UI-ändringar slår igenom inom buffer-fönstret

Konkretiseringen: Mixer med Reason-paradigm (knob-position rör sig inte under mod, LFO oscillerar runt user-set base, patch-cables binder LFO→knob med per-cable depth). Se [ARCHITECTURE.md](ARCHITECTURE.md) för aktuell impl.

---

## UI-vision (prioriterad ordning)

Ordningen reflekterar vad som ger ett shippable verktyg snabbast:

1. ✅ **Live monitoring** — Vbat/Vcap/Ipri som rolling sparkline-grafer (α1)
2. ✅ **CLI passthrough** — knappar för alla `/X`-kommandon + fri text-input (α1)
3. ✅ **Pattern runner** — alla 5 firmware-patterns med loop-mode (α2)
4. ✅ **Oscilloscope** — 4 fasta electrode-rader (A/B/C/D) + Sensation Envelope + spatial PolarFlow (β)
5. ✅ **Mixer** — Reason-style modular synth med channels + LFOs + cables (β)
6. ⏳ **Composer + timeline editor** — DAW-style drag-to-edit ⭐ (γ)
7. ⏳ **Library** — spara/ladda `.stimdaw`-filer (γ)
8. ⏳ **OTA firmware update + diagnostics** (post-γ)

### Timeline-koncept (γ-mål)

```
        0ms    500ms   1000ms  1500ms  2000ms
   A    │ ●●│▌▌▌▌│       │       │  ▌▌▌▌│       ──►
   B    │   │    │▌▌▌▌▌▌│       │      │       ──►
   C    │   │    │      │▌▌▌▌▌▌│  ▌▌▌▌│       ──►
   D    │   │    │      │      │      │▌▌▌▌▌▌│ ──►
        ↑playhead (live från CLOCK_MICROS)
```

- **Tre tidszoner:** Past (dimmed) | Committed (locked, in firmware queue) | Planned (editable, future descriptors)
- **Färg = polaritet** (T+ varm, T− kall)
- **Höjd = pulse_width**, **opacitet = amplitude**
- **Stripeshöjd = burst length**
- **Hover** = full deskriptor-tooltip
- **Click on Planned zone** = öppna i Composer

(Aktuell Oscilloscope renderar redan electrode-rader per dispatched descriptors. Composer = framtida edit-mode.)

---

## Kontextuella punkter

- **Designerns filosofi** (NeoDK-författare Mark de Rooi): "Innovation in e-stim has been virtually nonexistent for 25 years." Vill gå bortom kanal-orienterade TENS-style waveforms.
- **Firmware-status:** "production-ready hardware, far from finished firmware" enligt README. Vissa attribut (FIRMWARE_UPDATE, NEO_SERVICE_*) kan vara stub:ar — verifiera vid implementation.
- **Säkerhet:** NeoDK kan generera potentiellt dödliga spänningar. Hostens UI är **andra** försvarslinjen efter firmwarens hårda gränser. Bygg defensivt — single-chokepoint amp-clamp + ramp-controller + max-ceiling + STOP-watchdog (allt impl i `src/safety/`).
- **Topologin är inte 4 differentiella kanaler** — det är 4 enkelpoliga elektroder + switch matrix (en transformator). Mental modell: tänk MIDI med per-puls electrode routing, inte kanalbaserad TENS. Se [HARDWARE.md §1](HARDWARE.md#1-topologi--viktigt-att-förstå-rätt) för detaljer.
- **`start_time_µs` är hörnstenen för advanced functionality** — det är vad som möjliggör parallellitet, jitter-fri rytm, och idempotent re-send. Inte bara "när ska detta spelas" utan ett designval för deterministisk timing. Se [HARDWARE.md §4](HARDWARE.md#4-stream-lifecycle-och-start_time_µs-semantik-) för stream lifecycle.

---

## Roadmap-kontext

Versioneringen följer wedge-paradigmet (CEO + eng-review per wedge):

- **α1 (2026-04-29)** — Mock-driven foundation: protocol stack + safety + monitor + CLI
- **α2 (2026-04-30)** — Pattern runner + Oscilloscope (per-elcon) + CSV-export
- **β (2026-05-03)** — Modular synth (Mixer + LFO + cables) + frame-builder oscilloscope-rewrite (4 fasta electrode-rader) + spatial PolarFlow + DAW/Viz boundary cleanup + RPA test-helpers
- **γ (next)** — Composer + timeline editor + scene launcher + pattern library + MIDI-mappings (att planeras post-hardware-arrival)

Aktuell shipping-detalj: [CHANGELOG.md](../CHANGELOG.md). Plannerade items: [TODOS.md](../TODOS.md).

---

## Tekniska val (besluta)

Stacken är låst sedan α1: **Vite + TypeScript + Svelte 5 (runes) + Bun + Web Serial API**.

Återstående tekniska beslut för γ:

- **Timeline-rendering:** Canvas (Konva) eller SVG-skala? β:s Oscilloscope renderar SVG och håller upp till 1500 pulser per frame; canvas-migration trivial om SVG bits.
- **Generator graph design** — synth-engine är ett första steg. För γ: ska Composer:s timeline ha egen generator eller delegera till synth-engine?
- **Scene/pattern-bibliotek storage** — utöka `.stimdaw`-formatet eller separat library-fil?
- **MIDI-mappings:** Web MIDI API skeleton finns i TODOS, hur exponeras knob-bindings? Scene-trigger?

---

## Empirisk verifiering kvar

När hårdvara landar — frågor som måste verifieras (lista i [HARDWARE.md §10](HARDWARE.md#10-empirisk-verifiering--frågor-för-bring-up)):

1. Sub-kö-mappning per phase
2. AI_PT_DESCRIPTOR_QUEUE-notifikationsfrekvens
3. Beteende vid simultana `start_time_µs` på samma fas
4. Reordering-tolerans
5. Invoke START-ordering (real firmware kräver queue non-empty)
6. PlayState notify-spam-mönster

---

*Slut på brief. Ny session i StimDAW-mappen kan nu läsa detta + HARDWARE.md + ARCHITECTURE.md och har samma kontext som föregående session.*

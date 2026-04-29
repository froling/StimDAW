# StimDAW — Project Brief

> Snapshot av kontext, arkitekturbeslut och teknisk spec från initial diskussion 2026-04-29. Läs detta först när du tar över.

## Vad är StimDAW?

En DAW-likt klient för **NeoDK** — en open-source e-stim dev-board (https://github.com/Onwrikbaar/NeoDK). StimDAW exponerar hela protokollets djup, inte bara det enkla intensity/pattern-UI som följer med NeoDK.

**Långsiktig vision:** modulär realtidsdrift av pulse train descriptors, med visuell timeline-redigering som låter användaren komponera komplexa stimuleringsförlopp som musik i en DAW.

## Användarens kontext

- **Hårdvaran är beställd:** 5 PCB + 2 PCBA från JLCPCB. THT-komponenter och tillbehör (Xicon transformator, Cliff FC68131 jack, JST XH-kontakter, FSMRA6JH knapp, Gainta G404 låda, FTDI USB-TTL-kabel) från Mouser. Pomona 2 mm guld-pluggar för elektrodkontakter.
- **Power-konfiguration:** 9V PP3 i G404:s inbyggda batterikompartment (ger ~80V max output, accepterad kompromiss för enklast bygge). 12V wall-wart kan kopplas via DC-jack senare för full prestanda.
- **Arkitektur:** StimDAW är ett **separat repo**, inte fork av NeoDK. NeoDK ligger som git submodule under `reference/NeoDK/`.

## Arkitekturbeslut

### Repo-struktur
- StimDAW = egen klient, eget release-tempo
- Modifierar inte firmware eller hårdvara → ingen fork-soppa
- Kan teoretiskt stötta andra e-stim-protokoll i framtiden (zc95, FOC-Stim, etc.)

### DAW-likt streaming-mönster
```
User input → Generator graph → Scheduler → UART writer → Firmware queue
                                    ↑
                                    │
                  AI_PT_DESCRIPTOR_QUEUE notifications (back-pressure)
```

- **Generators** = moduler (ramp, LFO, envelope, spatial router, pattern lib) som producerar deskriptorer on-demand utifrån current state
- **Scheduler** = håller ~50 ms framtidsbuffert, lyssnar på back-pressure från enheten
- **Aldrig pre-generera hela låten** — generators evaluerar "nästa deskriptor" lat så att UI-ändringar slår igenom inom buffer-fönstret

## Protokoll-sammanfattning

### Frame-struktur (referens: `reference/NeoDK/UI/neodk.js`)
- 8-byte header + payload (max 512 bytes)
- Service Types: Debug (0), Datagram (1)
- Frame Types: None (0), Ack (1), Sync (3), Data (4)
- CRC8 på header, CRC16-CCITT på payload
- Sekvensnummer + ACK för reliable delivery
- 115200 bps over UART (3.3V TTL via TRS-jack)

### Attribute-API (Datagram NST)

15 attribut definierade i firmware (`reference/NeoDK/firmware/inc/attributes.h`):

| ID | Namn | Ops | Anteckning |
|---|---|---|---|
| 2 | FIRMWARE_VERSION | Read | Versionssträng |
| 3 | VOLTAGES | Read | 6 bytes: Vbat_mV, Vcap_mV, Iprim_mA |
| 4 | CLOCK_MICROS | Read | Uptime, för clock-sync |
| 5 | ALL_PATTERN_NAMES | Read | Inbyggda mönster |
| 6 | CURRENT_PATTERN_NAME | R/W/Sub | Aktivt mönster |
| 7 | INTENSITY_PERCENT | R/W/Sub | 0–100 master gain |
| 8 | PLAY_PAUSE_STOP | R/W/Sub | "play"/"pause"/"stop" |
| 9 | BOX_NAME | R/W | User-defined namn |
| 10 | **PT_DESCRIPTOR_QUEUE** | Write | ⭐ Stream pulse train descriptors hit |
| 11 | HEARTBEAT_INTERVAL_SECS | R/W | 0–3600 sek |
| 12 | BOOTLOADER_VERSION | Read | – |
| 13 | FIRMWARE_UPDATE | Write | OTA via UART |
| 14–16 | NEO_SERVICE_* | R/W | Generic service-anrop |

**Opcodes:** ReadRequest=2, SubscribeRequest=3, ReportData=5, WriteRequest=6, InvokeRequest=8

### Debug CLI (Debug NST, text-baserat)

Skickas som `/X`-kommandon på debug-kanalen (`reference/NeoDK/firmware/src/debug_cli.c`):

| Cmd | Funktion |
|---|---|
| `/?` | Hjälp |
| `/0`–`/9` | Sätt intensity 0/10..90 % |
| `/u`/`/d` | Up/down ±2 % |
| `/b` | Simulera knapptryck |
| `/n` | Nästa pattern |
| `/s` | Stop |
| `/l` | Toggla LED |
| `/v` | Print firmware version |
| `/a` | Trigga ADC-läsning |
| `/w` | Tillåt re-sync |
| `/q` | Quit |

## Pulse Train Descriptors

### Struktur (8–16 bytes, little-endian)

Spec: `reference/NeoDK/PulseTrainDescr.md`

```
meta             u8   Type/version flags (set to 0 for now)
sequence_number  u8   For diagnostics, wraps at 255
phase            u8   bits 2..1 = output stage (always 0 on NeoDK)
                      bit 0 = polarity
pulse_width_µs   u8   Pulse duration (max 200 µs)
start_time_µs    u32  Absolute time (relative to stream start)
electrode_set[2] u8×2 Bitmask: which of A/B/C/D on + and − sides
nr_of_pulses     u16  Burst length
pace_¼ms         u8   Time between pulses (in 0.25 ms units)
amplitude        u8   0–255 (0 = "keep previous")
delta_pulse_width_¼µs  i8  Linear ramp on pulse_width, applied per pulse
delta_pace_µs    i8   Linear ramp on pace, applied per pulse
```

### Dynamik

- **Inom en deskriptor:** linjär ramp på pulse_width och pace, ALLT annat statiskt
- **Mellan deskriptorer:** vad som helst (amplitude, electrode_set, phase)
- **amplitude = 0** betyder "behåll föregående deskriptors amplitude"

### NeoDK-specifika hårdvaruegenskaper (verifierade i schematik)

- **Switch matrix på kortet:** 4× TLP268J opto-triacs (U4–U7)
- `electrode_set` är **fullt funktionell** — använd den
- **9 elektrodkonfigurationer:** A-B, C-B, AC-B, A-D, C-D, AC-D, A-BD, C-BD, AC-BD
- **Phase bits 2..1:** ignoreras på NeoDK (bara 1 transformator), använd alltid 0
- **Phase bit 0:** polaritet, fullt användbar

## Buffert-arkitektur

### På firmware-sidan (verifierat i kod)

- **2 sub-köer**, en per fas (`reference/NeoDK/firmware/src/sequencer.c:445`)
- **20 deskriptor-slots vardera** (`PtdQueue_new(20)`)
- Subscribe på `AI_PT_DESCRIPTOR_QUEUE` → reaktiva push-notifikationer med fritt utrymme i båda köerna
- **Overflow droppas tyst** (`PE_BUFFER_FULL` loggas men ingen retry) — host måste inte överbelasta

### Recommended target buffer

| Mål | Tid framåt | Användning |
|---|---|---|
| Aggressiv | 15–25 ms | Risky vid GC/OS-jitter |
| **Sweet spot** ⭐ | **30–50 ms** | Under perceptionsgräns, klarar normal jitter |
| BLE/wireless | 50–100 ms | Märkbart drag |

**Kritiskt:** buffer-djup mäts i **tid**, inte slot-antal. En deskriptor kan vara 0,2 ms eller 6 sekunder. Hosten måste tracka `Σ(nr_of_pulses × pace)` för pending deskriptorer.

### Scheduler-pseudokod

```
on tick (var 5–10 ms):
    pending_time_ms = sum(d.nr_of_pulses × d.pace_ms for d in queue)
    free_q0, free_q1 = subscribed_state()

    while pending_time_ms < TARGET_BUFFER_MS:  # ~50 ms
        next_desc = generator_graph.next(now())
        if free[phase_to_queue(next_desc.phase)] < SAFETY_MARGIN:
            break  # vänta, kö nästan full
        send_descriptor(next_desc)
        pending_time_ms += next_desc.duration_ms
```

### Failure modes att hantera

| Scenario | Åtgärd |
|---|---|
| UART dropout | Re-sync, re-skicka senaste 50 ms |
| Host freeze >50 ms | Adaptive buffer increase till 100 ms |
| Clock drift | Heartbeat med `AI_CLOCK_MICROS` varje sekund |
| Två faser desyncar | Tracka båda nqbf separat, balanserad scheduling |

## UI-sketch (prioriterad ordning)

1. **Live monitoring** — Vbat/Vcap/Ipri som rolling sparkline-grafer
2. **CLI passthrough** — knappar för alla `/X`-kommandon + fri text-input
3. **Queue visualisering (read-only)** — timeline med 4 elektrodbanor
4. **Composer + timeline editor** — DAW-style drag-to-edit ⭐
5. **Library** — spara/ladda `.stimdaw`-filer
6. **OTA firmware update + diagnostics**

### Timeline-koncept

```
        0ms    500ms   1000ms  1500ms  2000ms
   A    │ ●●│▌▌▌▌│       │       │  ▌▌▌▌│       ──►
   B    │   │    │▌▌▌▌▌▌│       │      │       ──►
   C    │   │    │      │▌▌▌▌▌▌│  ▌▌▌▌│       ──►
   D    │   │    │      │      │      │▌▌▌▌▌▌│ ──►
        ↑playhead (live från CLOCK_MICROS)
```

- **Tre tidszoner:** Past (dimmed) | Committed (locked, in firmware queue) | Planned (editable, future descriptors)
- **Färg = amplitude**, **höjd = pulse_width**, **stripeshöjd = burst length**
- **Hover** = full deskriptor-tooltip
- **Click on Planned zone** = öppna i Composer

## Säkerhetsskydd som UI:t ska ha

- **Ramp-up-spärr** — om intensity ökar >10 %/sek, kräv bekräftelse
- **Output-spike-larm** — Vcap > 12V eller Ipri > 1A → röd visuell larm
- **Watchdog** — heartbeat timeout → auto-pause + dialog
- **Stor synlig ESC/STOP-knapp** alltid i header

## Tekniska val (att bestämma)

- **Stack:** TypeScript (säkert) + Vue 3 eller React eller Svelte? Tauri (Rust+webview) eller Electron eller pure web?
- **Timeline-rendering:** D3.js (max flexibilitet) eller Visx (React-style) eller Konva (canvas-baserat snabbt)
- **Telemetry-grafer:** Plotly.js (out-of-box) eller chart.js eller egen
- **Serial transport:** Web Serial API (om browser-baserat) eller node-serialport (om Tauri/Electron)
- **State management:** Pinia (Vue) eller Zustand (React)
- **Generator graph:** custom DSL? Audio-graph-likt API? Eller plain JS-funktioner som returnerar deskriptorer?

## Filer att djupdyka i NeoDK-submodulen

| Fil | Vad |
|---|---|
| `reference/NeoDK/UI/neodk.js` | Komplett protokoll-impl i JS (kopiera/portera till TS) |
| `reference/NeoDK/PulseTrainDescr.md` | Officiell deskriptor-spec |
| `reference/NeoDK/firmware/inc/attributes.h` | Alla 15 attribut-IDs + struct-defs |
| `reference/NeoDK/firmware/src/debug_cli.c` | CLI-kommandon (källa för CLI-flikens UI) |
| `reference/NeoDK/firmware/src/sequencer.c` | Kö-hantering, scheduler-events på firmware-sidan |
| `reference/NeoDK/firmware/src/controller.c` | Attribut-handling, opcode dispatch |
| `reference/NeoDK/Design.md` | Hårdvaru-design (switch matrix, transformator, säkerhet) |
| `reference/NeoDK/firmware/SetupDK.md` | Setup för firmware-utveckling (om vi vill modifiera) |

## Öppna frågor / nästa steg

1. **Tech stack-beslut** (se "Tekniska val" ovan)
2. **Generator graph design** — plug-in-system? Hardcoded moduler? Hur exponerar vi parametrar för automation?
3. **`.stimdaw`-filformat** — JSON med versioning? Diffable för git?
4. **Multi-device support** — flera NeoDK samtidigt på olika serial ports?
5. **Tester** — hur testa scheduler-logik utan riktig hårdvara? Mock-firmware?
6. **Säkerhetsmodellen** — vilka safety checks är hard-coded vs. user-overridable?

## Kontextuella punkter

- **Designerns filosofi** (NeoDK-författare): "Innovation in e-stim has been virtually nonexistent for 25 years." Vill gå bortom kanal-orienterade TENS-style waveforms.
- **Firmware-status:** "production-ready hardware, far from finished firmware" enligt README. Vissa attribut (FIRMWARE_UPDATE, NEO_SERVICE_*) kan vara stub:ar — verifiera vid implementation.
- **Säkerhet:** NeoDK kan generera potentiellt dödliga spänningar. Hostens UI är **andra** försvarslinjen efter firmwarens hårda gränser. Bygg defensivt.

---

*Slut på brief. Den nya Claude-sessionen i StimDAW-mappen kan nu läsa detta + NeoDK-submodulen och har samma kontext som föregående session.*

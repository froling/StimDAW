# StimDAW — Project Brief

> Snapshot av kontext, arkitekturbeslut och teknisk spec.
> Initial diskussion 2026-04-29 → utökad med fördjupningar 2026-04-30/05-01.
> Läs detta först när du tar över.

---

## 1. Vad är StimDAW?

En DAW-likt klient för **NeoDK** — en open-source e-stim dev-board (https://github.com/Onwrikbaar/NeoDK). StimDAW exponerar hela protokollets djup, inte bara det enkla intensity/pattern-UI som följer med NeoDK.

**Långsiktig vision:** modulär realtidsdrift av pulse train descriptors, med visuell timeline-redigering som låter användaren komponera komplexa stimuleringsförlopp som musik i en DAW.

## 2. Användarens kontext

- **Hårdvaran är beställd:** 5 PCB + 2 PCBA från JLCPCB. THT-komponenter och tillbehör (Xicon transformator, Cliff FC68131 jack, JST XH-kontakter, FSMRA6JH knapp, Gainta G404 låda, FTDI USB-TTL-kabel) från Mouser. Pomona 2 mm guld-pluggar för elektrodkontakter.
- **Power-konfiguration:** 9V PP3 i G404:s inbyggda batterikompartment (ger ~80V max output, accepterad kompromiss för enklast bygge). 12V wall-wart kan kopplas via DC-jack senare för full prestanda.
- **Arkitektur:** StimDAW är ett **separat repo**, inte fork av NeoDK. NeoDK ligger som git submodule under `reference/NeoDK/`.

## 3. Arkitekturbeslut

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

---

## 4. NeoDK Hardware Topology — VIKTIGT att förstå rätt

### 4 enkelpoliga utgångar, INTE 4 differentiella kanaler

NeoDK har **4 enkelpoliga elektrodutgångar** (A, B, C, D = en wire vardera, en JST-pin vardera). De är **inte** 4 separata kanaler med var sin + och −.

```
JST J4    ──── pin 1 ──── Elektrod A  (en wire)
          ──── pin 2 ──── Elektrod B  (en wire)
JST J5    ──── pin 1 ──── Elektrod C  (en wire)
          ──── pin 2 ──── Elektrod D  (en wire)
```

### En transformator + switch matrix

```
              ┌──────[T+]──────┐
              │                 │  via opto-triacs (TLP268J × 4)
              │   any subset of {A,B,C,D}
   Transformator
   (Xicon 42TU200)
              │   any other subset of {A,B,C,D}
              │                 │  via opto-triacs
              └──────[T−]──────┘
```

**Per puls** anger deskriptorn:
- `electrode_set[0]` = bitmask av elektroder som ansluts till **T+**
- `electrode_set[1]` = bitmask av elektroder som ansluts till **T−**
- `phase` bit 0 = vänd polariteten (samma elektrodgrupper men T+ blir T−)

**Kritiskt:** vid varje given mikrosekund flyter ström i **EN** krets. NeoDK simulerar multi-kanals-känsla genom att snabbt växla mellan elektrodkonfigurationer puls för puls.

### 9 möjliga elektrodkonfigurationer

A-B, C-B, AC-B, A-D, C-D, AC-D, A-BD, C-BD, AC-BD (samtliga kan reverseras med `phase` bit 0)

### UI-implikation

Composer-fliken ska INTE presentera "4 kanaler med + och −" — det är vilseledande. Bättre modell:

```
┌────────────────────────────────────────┐
│  Per-puls electrode routing            │
│         A    B    C    D                │
│   +    [✓]  [ ]  [✓]  [ ]  ← T+ side   │
│   −    [ ]  [✓]  [ ]  [✓]  ← T− side   │
│   Polarity: ◉ Normal  ○ Reversed       │
└────────────────────────────────────────┘
```

Timeline-vyn ska visa **pulser per elektrod-trådbana** (A/B/C/D), färgad efter om elektroden är på + (varm färg) eller − (kall färg) vid den pulsen.

---

## 5. Protokoll-sammanfattning

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
| 4 | CLOCK_MICROS | Read | Stream-uptime (för clock-sync, wraparound-detektering) |
| 5 | ALL_PATTERN_NAMES | Read | Inbyggda mönster (5 st, se §10) |
| 6 | CURRENT_PATTERN_NAME | R/W/Sub | Aktivt mönster |
| 7 | INTENSITY_PERCENT | R/W/Sub | 0–100 master gain |
| 8 | PLAY_PAUSE_STOP | R/W/Sub | "play"/"pause"/"stop" |
| 9 | BOX_NAME | R/W | User-defined namn |
| 10 | **PT_DESCRIPTOR_QUEUE** | Write/Invoke | ⭐ Stream pulse train descriptors hit |
| 11 | HEARTBEAT_INTERVAL_SECS | R/W | 0–3600 sek |
| 12 | BOOTLOADER_VERSION | Read | – |
| 13 | FIRMWARE_UPDATE | Write | OTA via UART |
| 14–16 | NEO_SERVICE_* | R/W | Generic service-anrop |

**Opcodes:** ReadRequest=2, SubscribeRequest=3, ReportData=5, WriteRequest=6, **InvokeRequest=8** (används för stream START/STOP, se §7)

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

---

## 6. Pulse Train Descriptors

### Struktur (8–16 bytes, little-endian)

Spec: `reference/NeoDK/PulseTrainDescr.md`

```
meta             u8   Type/version flags (set to 0 for now)
sequence_number  u8   For diagnostics, wraps at 255
phase            u8   bits 2..1 = output stage (always 0 on NeoDK)
                      bit 0 = polarity
pulse_width_µs   u8   Pulse duration (max 200 µs hard limit)
start_time_µs    u32  ABSOLUT tid mot stream-klockan (se §7)
electrode_set[2] u8×2 Bitmask: which of A/B/C/D on + and − sides
nr_of_pulses     u16  Burst length (max 65535)
pace_¼ms         u8   Time between pulses (in 0.25 ms units)
amplitude        u8   0–255 (0 = "keep previous")
delta_pulse_width_¼µs  i8  Linear ramp on pulse_width, applied per pulse
delta_pace_µs    i8   Linear ramp on pace, applied per pulse
```

### Field maximums (för validering i UI)

| Fält | Typ | Max | Anmärkning |
|---|---|---|---|
| `nr_of_pulses` | uint16 | 65 535 | Pulser per burst |
| `pulse_width_µs` | uint8 | 255 µs | Men 200 µs är hård säkerhetsgräns från Design.md |
| `pace_¼ms` | uint8 | 255 (= 63,75 ms) | Min nonzero = 0,25 ms = 250 µs |
| `amplitude` | uint8 | 255 (= 100% av max) | 0 = "behåll föregående" |
| `start_time_µs` | uint32 | ~71 minuter | Wraparound, kräver stream-restart |
| `delta_pulse_width_¼µs` | int8 | ±127 (= ±31,75 µs) | Per puls; saturerar vid 0 eller 255 |
| `delta_pace_µs` | int8 | ±127 µs | Per puls |
| `sequence_number` | uint8 | 255 | Wrappar (för diagnostik) |
| `phase` bits 2..1 | – | NeoDK ignorerar (har 1 transformator) | Sätt alltid 00 |
| `phase` bit 0 | – | Polaritet | Fullt användbar |

### Dynamik

- **Inom en deskriptor:** linjär ramp på `pulse_width` och `pace`, ALLT annat statiskt
- **Mellan deskriptorer:** vad som helst (amplitude, electrode_set, phase)
- **`amplitude = 0`** betyder "behåll föregående deskriptors amplitude"

### Praktiska burst-tider

| pace | nr_of_pulses=65535 | Användning |
|---|---|---|
| 1 (0,25 ms) | ~16 sek | Hög-frekvens "buzzing" |
| 80 (20 ms, "TENS") | ~22 minuter | Klassisk TENS |
| 255 (64 ms) | ~70 minuter | Långsam pulserande |

**Rekommendation för StimDAW:** korta bursts (5–50 pulser, 25–500 ms) ger bra realtids-kontroll. Långa bursts (>500 ms) blockerar UI-änd-rings-respons.

---

## 7. Stream Lifecycle och `start_time_µs`-semantik ⭐

Detta är en konceptuell hörnsten — missförstås lätt.

### Stream-klockan startar vid Invoke START

```
Tid:          T₁              T₂                  T₃
              │               │                   │
HOST:    ─────●───────────────●───────────────────●──►
              │               │                   │
              │ "queue 5      │ "InvokeRequest    │ "queue more
              │  descriptors  │  TRUE on          │  descriptors"
              │  with         │  PT_DESCRIPTOR_   │
              │  start_time   │  QUEUE"           │
              │  0..2000ms"   │                   │
              ▼               ▼                   ▼
FIRMWARE: ────●───────────────●═══════════════════●═══════►
              │   queue       │   stream-clock    │
              │   accepter    │   STARTAR HÄR     │   descriptor
              │   (ingen      │   t=0 = NU        │   för t=2000ms
              │   spelar än)  │                   │   queueas
```

### Stream START/STOP

Skickas som **InvokeRequest** (opcode 8) på `AI_PT_DESCRIPTOR_QUEUE`:
- `EE_BOOLEAN_TRUE` (data byte = 1) = **START stream**
- `EE_BOOLEAN_FALSE` (data byte = 0) = **STOP stream**

(Sett i `reference/NeoDK/firmware/src/controller.c:228–234`)

### Vad `start_time_µs` är (och inte är)

❌ **INTE** "tid sedan UART-meddelandet skickades"
❌ **INTE** "tid sedan firmware bootade" (det är `CLOCK_MICROS`)
❌ **INTE** "tid sedan föregående deskriptor"

✅ **JA**: tid relativt **stream-klockan** som startar vid Invoke START

### Klockans nollpunkt — den subtila detaljen

Firmware kalibrerar klockan vid Invoke START så att **första deskriptorn fyrar exakt vid sitt `start_time_µs`** ([sequencer.c:160](firmware/src/sequencer.c:160)):

```c
BSP_startSequencerClock(burst.start_time_µs - 200);
```

Praktisk följd: "stream-klockans 0" = "första deskriptorns start_time".
**Vanligast och enklast:** låt första deskriptorn ha `start_time = 0` och ackumulera uppåt.

### Tre arbetsflöden

#### Mode A: Batch upload
```
1. Host queue 100 deskriptorer (start_time = 0, 50, 100, ..., 5000 ms)
2. Host: Invoke START
3. Firmware spelar 5 sekunder
4. Host: Invoke STOP
```
Bra för förinspelade `.stimdaw`-filer, demos.

#### Mode B: Realtime stream (DAW-mönstret)
```
1. Host queue 5 deskriptorer (fyller buffer 0..200ms)
2. Host: Invoke START
3. Loop: lyssna på AI_PT_DESCRIPTOR_QUEUE-notifikationer,
   generera nästa deskriptor (start_time = current + ~50ms), queue.
4. Host: Invoke STOP när användaren stoppar
```
Bra för UI med live-knappar, automation, modulation.

#### Mode C: Hybrid (vanligast i praktiken)
```
1. Host pre-queue ett "intro pattern" (3 sek)
2. Host: Invoke START
3. Under tiden: live-modulerade deskriptorer för t > 3s
4. Användaren ändrar parameter → host justerar framtida deskriptorer
5. Slutligen: queue ett "outro" och Invoke STOP
```

### Varför `start_time_µs` finns (5 användningar)

1. **Parallella bursts på olika faser** — TENS-emulering kräver två pulståg som överlappar med 180 µs offset
2. **Tysta luckor utan dummy-deskriptorer** — sätt bara `start_time = previous_end + gap`
3. **Precis rytmik och kvantisering** — 120 BPM → start_time = 0, 500_000, 1_000_000, 1_500_000
4. **UART dropout-resilience** — re-send samma deskriptorer; firmware ignorerar de vars tid passerats
5. **Synkroniserad host-side automation** — LFO/envelope-värden samplade vid deskriptors `start_time` ger deterministisk fas

### Sub-köerna är PARALLELLA, inte alternerande

- 2 sub-köer (`reference/NeoDK/firmware/src/sequencer.c:445`)
- En per fas (phase bits)
- Båda spelar **simultant** baserat på sina egna deskriptorers `start_time_µs`
- StimDAW måste tracka båda separat för back-pressure

### Long-session handling (>71 min)

Eftersom `start_time_µs` är uint32 wrappar den vid ~71 min 35 sek. Hantering:

1. Subscribe på `CLOCK_MICROS`
2. Vid t = ~65 min: pre-queue några deskriptorer för t = ~70 min
3. Vid t = ~70 min: Invoke STOP, sedan Invoke START → klockan nollställs
4. Hosten håller en "epoch counter" så användaren ser korrekt total session-tid

För <70 min sessioner: ignorera, använd absolut tid.

---

## 8. Buffert-arkitektur

### På firmware-sidan (verifierat i kod)

- **2 sub-köer**, en per fas (`sequencer.c:445`)
- **20 deskriptor-slots vardera** (`PtdQueue_new(20)`, `sequencer.c:383`)
- Subscribe på `AI_PT_DESCRIPTOR_QUEUE` → reaktiva push-notifikationer med fritt utrymme i båda köerna
- **Overflow droppas tyst** (`PE_BUFFER_FULL` loggas men ingen retry) — host måste själv inte överbelasta

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
| UART dropout | Re-sync, re-skicka senaste 50 ms (idempotent tack vare absolut start_time_µs) |
| Host freeze >50 ms | Adaptive buffer increase till 100 ms |
| Clock drift | Heartbeat med `AI_CLOCK_MICROS` varje sekund |
| Två faser desyncar | Tracka båda nqbf separat, balanserad scheduling |
| Stream-klocka närmar sig 71 min | Pre-queue restart, see §7 long-session handling |

---

## 9. Vad som är öppet kontra stängt i NeoDK

### Helt öppet (CERN-OHL-W weakly reciprocal)
- All hårdvara (Eagle CAD, BOM, gerbers)
- Firmware-applikationskoden (`firmware/src/*.c`, `firmware/inc/*.h`)
- UI-koden (`UI/*`)
- All dokumentation (Design.md, PulseTrainDescr.md, README.md)
- `firmware/maolib/inc/*.h` (bara headers)

### Stängt (binär leverans)
- **`firmware/maolib/libmao_g071.a`** — Mark de Rooi:s "Active Object framework"
  - Innehåller bl.a.: `PtdQueue`, `EventQueue`, `CircBuffer`, `NetFrame`-implementationer
  - Bara API-ytan (headers) är publik
  - Källkod finns INTE på GitHub
  - Lagligt enligt CERN-OHL-W (svagt reciprokal gäller hårdvara, inte mjukvara)

### Konsekvenser för StimDAW

**Black-box-antaganden för:**
- Exakt hur `phase` bits mappar mot 2 sub-köer
- Overflow/reordering-semantik för `PtdQueue`
- Internal scheduling (när exakt fyrar firmware en burst relativt clock-tick?)

**Strategier:**
1. **Bygg defensivt** mot dokumenterad protokoll-spec, inte mot intern implementation
2. **Verifiera empiriskt** med riktig hårdvara — viktiga frågor:
   - Hur reagerar firmware på två deskriptorer med samma `start_time_µs`?
   - Vad händer om phase-bits 2..1 sätts > 0?
   - Hur snabbt kommer `AI_PT_DESCRIPTOR_QUEUE`-notifikationer (real-time eller buffrade)?
3. **Bygg mock-firmware** baserat på dokumenterad spec → utveckla utan hårdvara
4. **Vid behov:** kontakta Mark direkt
   - Discord: **@Onwrikbaar**
   - E-post: **onwrikbaar@hotmail.com**

---

## 10. Inbyggda patterns att referera/portera

5 mönster är hardcoded i firmware ([firmware/src/patterns.c](firmware/src/patterns.c)):

| # | Namn | Vad den gör | Pace | Steg | Reps |
|---|---|---|---|---|---|
| 1 | **Jackhammer** | AC↔BD (alla elektroder samtidigt, alternerande riktning) | MAX_PULSE_PACE_µs | 3 | 200 |
| 2 | **Toggle** | A↔B följt av C↔D, sedan tillbaka | 25 ms | 5 | 300 |
| 3 | **CrossToggle** | Diagonal: A↔D, B↔C, C↔B, D↔A | 20 ms | 5 | 200 |
| 4 | **Circle** | 18-stegs "roterande" sekvens | 30 ms | 9 | 40 |
| 5 | **Scratch that itch** | Snabb A↔B/C↔D växling, fokuserat | 8 ms | 11 | 5000 |

### Format

Varje pattern är en lista av `[elektrode_set_+, elektrode_set_-]`-par. Konstanter:
```
EL_A = 1   EL_C  = 4   EL_AC = 5
EL_B = 2   EL_D  = 8   EL_BD = 10
```

Samma bitmask-format som `electrode_set` i pulse train descriptors.

### Skillnad mot pulse train descriptors

Inbyggda patterns är ett **enklare format**:
- Ingen amplitude-kontroll i mönstret (bara global `IntensityPercent`)
- Inga linjära ramper
- Ingen `start_time_µs` — sekventiell pace
- Ingen `phase` — alltid stage 0

De är "patterns v1". Pulse train descriptors är "patterns v2" — vad StimDAW byggs runt.

### Hur StimDAW kan använda dem

1. **Importera som "starter pack"** i library-fliken (översätt till `.stimdaw` JSON)
2. **Visualisera som test-data** — alla 5 är deterministiska, perfekta för att verifiera timeline-renderern
3. **Som benchmark** för "compare against built-in" funktion

### Säkerhetsvalidering att replikera

`patterns.c:checkPattern()` validerar att inget elektrod är på båda sidor (kortslutning):
```c
if ((elcon[0] & elcon[1]) != 0) → "short in elcon"
```

StimDAW:s composer ska göra samma client-side validering före send.

---

## 11. UI-sketch (prioriterad ordning)

1. **Live monitoring** — Vbat/Vcap/Ipri som rolling sparkline-grafer
2. **CLI passthrough** — knappar för alla `/X`-kommandon + fri text-input
3. **Queue visualisering (read-only)** — timeline med 4 elektrodbanor
4. **Composer + timeline editor** — DAW-style drag-to-edit ⭐
5. **Library** — spara/ladda `.stimdaw`-filer (incl. de 5 inbyggda som starter pack)
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
- **Färg = polaritet** (T+ = varm, T− = kall)
- **Höjd = pulse_width**, **opacitet = amplitude**
- **Stripeshöjd = burst length**
- **Hover** = full deskriptor-tooltip
- **Click on Planned zone** = öppna i Composer

---

## 12. Säkerhetsskydd som UI:t ska ha

- **Ramp-up-spärr** — om intensity ökar >10 %/sek, kräv bekräftelse
- **Output-spike-larm** — Vcap > 12V eller Ipri > 1A → röd visuell larm
- **Watchdog** — heartbeat timeout → auto-pause + dialog
- **Stor synlig ESC/STOP-knapp** alltid i header
- **Composer client-side validation:**
  - Ingen elektrod på båda + och − sidor (kortslutning)
  - Minst 1 elektrod på varje sida (annars ingen ström)
  - `pulse_width ≤ 200 µs` (Design.md säkerhetsgräns)
  - `phase` bits 2..1 = 0 (NeoDK saknar fler stages)
  - `start_time_µs` strikt monotont stigande inom samma sub-kö
- **Stream-state monitoring:**
  - Larm om committed buffer underflows (audio dropout)
  - Larm om out-of-order start_times skickas

---

## 13. Tekniska val (att bestämma)

- **Stack:** TypeScript (säkert) + Vue 3 / React / Svelte? Tauri (Rust+webview) / Electron / pure web?
- **Timeline-rendering:** D3.js (max flexibilitet) / Visx (React-style) / Konva (canvas-baserat snabbt)
- **Telemetry-grafer:** Plotly.js (out-of-box) / chart.js / egen
- **Serial transport:** Web Serial API (browser) / node-serialport (Tauri/Electron)
- **State management:** Pinia (Vue) / Zustand (React)
- **Generator graph:** custom DSL? Audio-graph-likt API? Plain JS-funktioner som returnerar deskriptorer?
- **`.stimdaw` filformat:** JSON med versioning? Diffable för git?

---

## 14. Filer att djupdyka i NeoDK-submodulen

### Öppet — kan läsas/refereras

| Fil | Vad |
|---|---|
| `reference/NeoDK/UI/neodk.js` | Komplett protokoll-impl i JS (kopiera/portera till TS) |
| `reference/NeoDK/PulseTrainDescr.md` | Officiell deskriptor-spec |
| `reference/NeoDK/firmware/inc/attributes.h` | Alla 15 attribut-IDs + struct-defs |
| `reference/NeoDK/firmware/src/debug_cli.c` | CLI-kommandon (källa för CLI-flikens UI) |
| `reference/NeoDK/firmware/src/sequencer.c` | Kö-hantering, scheduler-events, stream-klocka |
| `reference/NeoDK/firmware/src/controller.c` | Attribut-handling, opcode dispatch (Read/Write/Invoke-routing) |
| `reference/NeoDK/firmware/src/patterns.c` | De 5 inbyggda patterns (för portering till StimDAW library) |
| `reference/NeoDK/Design.md` | Hårdvaru-design (switch matrix, transformator, säkerhet) |
| `reference/NeoDK/firmware/SetupDK.md` | Setup för firmware-utveckling |

### Stängt — bara headers tillgängliga

| Fil | Vad saknas |
|---|---|
| `reference/NeoDK/firmware/maolib/inc/ptd_queue.h` | Implementation av `PtdQueue` är binär |
| `reference/NeoDK/firmware/maolib/inc/eventqueue.h` | Active Object event-system, binärt |
| `reference/NeoDK/firmware/maolib/inc/circbuffer.h` | Cirkulär buffer, binärt |
| `reference/NeoDK/firmware/maolib/inc/net_frame.h` | Frame protokoll-lager, binärt |
| `reference/NeoDK/firmware/maolib/libmao_g071.a` | All "maolib"-implementation, ARM-objektkod |

För StimDAW spelar detta ingen roll så länge protokollet på UART-tråden behandlas som kontraktet.

---

## 15. Öppna frågor / nästa steg

1. **Tech stack-beslut** (se §13)
2. **Generator graph design** — plug-in-system? Hardcoded moduler? Hur exponerar vi parametrar för automation?
3. **`.stimdaw`-filformat** — JSON med versioning? Diffable för git?
4. **Multi-device support** — flera NeoDK samtidigt på olika serial ports?
5. **Tester** — hur testa scheduler-logik utan riktig hårdvara? Mock-firmware som implementerar protokollet?
6. **Säkerhetsmodellen** — vilka safety checks är hard-coded vs. user-overridable?
7. **Empirisk verifiering** med riktig hårdvara av:
   - Sub-kö-mappning (vilka phase-bits → vilken sub-kö?)
   - Notifikationsfrekvens för `AI_PT_DESCRIPTOR_QUEUE`
   - Beteende vid simultana `start_time_µs` på samma fas
   - Reordering-tolerans (out-of-order writes)

---

## 16. Kontextuella punkter

- **Designerns filosofi** (NeoDK-författare Mark de Rooi): "Innovation in e-stim has been virtually nonexistent for 25 years." Vill gå bortom kanal-orienterade TENS-style waveforms.
- **Firmware-status:** "production-ready hardware, far from finished firmware" enligt README. Vissa attribut (FIRMWARE_UPDATE, NEO_SERVICE_*) kan vara stub:ar — verifiera vid implementation.
- **Säkerhet:** NeoDK kan generera potentiellt dödliga spänningar. Hostens UI är **andra** försvarslinjen efter firmwarens hårda gränser. Bygg defensivt.
- **Topologin är inte 4 differentiella kanaler** — det är 4 enkelpoliga elektroder + switch matrix. Mental modell: tänk MIDI med per-puls electrode routing, inte kanalbaserad TENS.
- **`start_time_µs` är hörnstenen för advanced functionality** — det är vad som möjliggör parallellitet, jitter-fri rytm, och idempotent re-send. Inte bara "när ska detta spelas" utan ett designval för deterministisk timing.

---

*Slut på brief. Den nya Claude-sessionen i StimDAW-mappen kan nu läsa detta + NeoDK-submodulen och har samma kontext som föregående session.*

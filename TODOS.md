# TODOS

## Pattern Engine (β-prep)

### Pattern + Bank + Scene data-structures + JSON-schema

**What:** TS-types och Zod-validering för `Pattern` (en sekvens av PT-descriptors med en längd), `Bank` (samling pattern), `Scene` (en konfiguration av aktiva patterns + parametrar). Ingen UI än.

**Why:** β-wedge är pattern-player. Att starta β med datalagret redan på plats och validerat sparar dagar av "vad är ens en pattern?" och retrofit-arbete.

**Context:** CEO plan cherry-pick #3 (DEFERRED). Bygger ovanpå `src/fileformat/`-schemat som etableras i α. Naturlig ordning: implementera typerna + schemavalideringen + några unit-tester, sedan bygga upp UI över i β.

**Effort:** S
**Priority:** P2
**Depends on:** α `src/fileformat/`-modulen

### Web MIDI API skeleton

**What:** `MIDIController`-modul (`src/midi/controller.ts`) som listar tillgängliga MIDI-inputs, lyssnar på message events, och routar dem till en EventEmitter. Inga mappings till performance-controls — bara råa events.

**Why:** Pattern-player-visionen är att solo-användare ska kunna styra med en MIDI-controller (en hand). Att ha skelettet på plats betyder β kan börja med "hook upp en knob till intensity" istället för att börja med Web MIDI API discovery.

**Context:** CEO plan cherry-pick #4 (DEFERRED). Web MIDI API är browser-built-in. Liten modul (~100 rader). Kräver `navigator.requestMIDIAccess()` permission-handshake på första-användning.

**Effort:** XS
**Priority:** P2
**Depends on:** α-implementation klar (för att inte lägga till komplexitet i α)

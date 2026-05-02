/**
 * Pure module. No Svelte imports, no $state, no I/O.
 *
 * Mappa en FiredPulse till per-electrode markers. Varje puls aktiverar
 * 1-4 elektroder beroende på elcon, polariteten på varje rad bestäms av
 * (elcon-sida, phase).
 *
 * Phase semantik (per `firmware/src/bsp_stm32g071.c:832-840`):
 *   phase=0 → CCR1 fires (forward through transformer)
 *   phase=1 → CCR2 fires (reverse — opposite gate sequence)
 *
 * UX-encoding (per eng-review): vid phase=0 ritas pos_mask som "varm" (T+
 * side, CCR1-driven), neg_mask som "kall" (T- side). Phase=1 flippar
 * encoding för att markera biphasic-pair-första-halvan-flip. Detta är en
 * användarfriendly approximation, INTE strict hardware-truth — per-electrode
 * strömriktning är samma fysiska kvantitet, bara CCR-channel skiljer.
 *
 * Hård invariant: `(pos & neg) === 0` (annars kortslutning, firmware
 * loggar `"short in elcon"`). Vi rejekterar tyst i mapping (returnerar
 * tom array) — validering ska ske före.
 */
import type { FiredPulse, ElectrodeRowPulse } from './types';
import { ELECTRODE_DEFS } from './types';

/**
 * Mappa en FiredPulse till en lista av (electrode-bit, ElectrodeRowPulse)-par.
 * Caller (frame-builder) groupar dem per electrode-rad.
 *
 * Returnerar en lista av exakt N entries där N = popcount(pos | neg).
 * Tom om elcon=[0,0] eller short detected (pos & neg ≠ 0).
 *
 * @param pulse - från expand.ts
 * @returns array av {bit, rowPulse} där bit är 1|2|4|8 (electrode-bit)
 */
export function mapPulseToElectrodes(pulse: FiredPulse): {
  bit: 1 | 2 | 4 | 8;
  rowPulse: ElectrodeRowPulse;
}[] {
  const [posMask, negMask] = pulse.elcon;

  // Reject shorts tyst — caller bör validera, men defense-in-depth
  if ((posMask & negMask) !== 0) return [];

  // Reject phase ≥ 2 (firmware rejekterar via `else return false` på bsp:840)
  if (pulse.phase !== 0 && pulse.phase !== 1) return [];

  // Phase=0: pos_mask → 'pos' (warm), neg_mask → 'neg' (cold)
  // Phase=1: pos_mask → 'neg' (cold), neg_mask → 'pos' (warm)
  const flipPolarity = pulse.phase === 1;

  // Wire-truth: descriptor.amplitude byte (0..255) som går på protokollet.
  // Per eng-review 2026-05-02: ampNorm = wire-byte / 255, INTE Vcap-telemetri.
  const amplitudeNorm = clamp01(pulse.descriptorAmplitude / 255);

  const out: { bit: 1 | 2 | 4 | 8; rowPulse: ElectrodeRowPulse }[] = [];

  for (const def of ELECTRODE_DEFS) {
    if ((posMask & def.bit) !== 0) {
      out.push({
        bit: def.bit,
        rowPulse: {
          streamTimeMicros: pulse.streamTimeMicros,
          pulseWidthMicros: pulse.pulseWidthMicros,
          polarity: flipPolarity ? 'neg' : 'pos',
          amplitudeNorm,
          sourceDescriptorSeq: pulse.sourceDescriptorSeq,
        },
      });
    } else if ((negMask & def.bit) !== 0) {
      out.push({
        bit: def.bit,
        rowPulse: {
          streamTimeMicros: pulse.streamTimeMicros,
          pulseWidthMicros: pulse.pulseWidthMicros,
          polarity: flipPolarity ? 'pos' : 'neg',
          amplitudeNorm,
          sourceDescriptorSeq: pulse.sourceDescriptorSeq,
        },
      });
    }
    // bit i varken pos eller neg → electrode inactive för denna puls, skippa
  }

  return out;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

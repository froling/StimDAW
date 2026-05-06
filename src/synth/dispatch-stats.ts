/**
 * Dispatch-rate metrics — räknar descriptor-genomströmning över tid.
 *
 * Pure function-modul (inga Svelte-runes, ingen DOM). UI/store binder till
 * resultaten men beräkningen är testbar isolerat.
 *
 * Användning: anropas från frame-tick (30Hz) med senaste dispatched-buffer
 * och nuvarande wall-time. Returnerar antal descriptors inom rolling fönster
 * + uppskattad wire-bandwidth.
 *
 * Kapacitets-kontext (NeoDK):
 *   - PtQueue per phase = 20 slots × 2 phases = 40 totalt
 *   - Firmware drainar i emit-takt — om host levererar snabbare än det blir overflow
 *   - Rule of thumb: håll DPS < 40 för stabil ström, < 60 sekunds-burst OK
 */

const DEFAULT_WINDOW_MICROS = 1_000_000; // 1 sekund

/**
 * Genomsnittlig wire-storlek per descriptor i bytes. Räknar både
 * descriptor-payload (10..16 bytes, avg 13) + datagram-overhead
 * (PACKET_HEADER_SIZE 4 + ATTRIBUTE_ACTION_SIZE 4 + frame-encoding ~3) ≈ 24 bytes.
 *
 * Approximation — exakt storlek varierar per descriptor men varianserna är
 * små (max 16 - min 10 = 6 bytes på descriptor-payload, resten är fast).
 */
const AVG_BYTES_PER_DESCRIPTOR = 24;

export interface DispatchRateInput {
  readonly dispatchedAtMicros: number;
}

export interface DispatchRate {
  /** Antal descriptors inom rolling fönster (default 1s) → descriptors/sec. */
  readonly dps: number;
  /** Approximativ wire-bandwidth: dps × AVG_BYTES_PER_DESCRIPTOR. */
  readonly bytesPerSec: number;
}

/**
 * Räkna dispatched descriptors inom rolling fönster bakåt från nowMicros.
 *
 * @param descriptors  Insertion-ordered (äldst först, nyast sist) — frame-
 *   builder garanterar denna ordning.
 * @param nowMicros  Wall-time vid sample-tidpunkt (performance.now() × 1000).
 * @param windowMicros  Default 1_000_000 = 1 sekund.
 *
 * Iterar bakifrån för O(rate × window) i stället för O(N) — viktigt eftersom
 * dispatchedDescriptors kan ha tusentals entries över längre körningar.
 */
export function computeDispatchRate(
  descriptors: readonly DispatchRateInput[],
  nowMicros: number,
  windowMicros: number = DEFAULT_WINDOW_MICROS,
): DispatchRate {
  if (descriptors.length === 0 || windowMicros <= 0) {
    return { dps: 0, bytesPerSec: 0 };
  }
  const cutoffMicros = nowMicros - windowMicros;
  let count = 0;
  for (let i = descriptors.length - 1; i >= 0; i--) {
    const d = descriptors[i];
    if (!d || d.dispatchedAtMicros < cutoffMicros) break;
    count++;
  }
  // Skala till per-sekund om window inte är exakt 1s
  const dps = Math.round((count * 1_000_000) / windowMicros);
  return { dps, bytesPerSec: dps * AVG_BYTES_PER_DESCRIPTOR };
}

/**
 * Tone-thresholds för DPS-mätaren. Återanvänds av UI-tester och MonitorBar.
 *
 * - 'ok' (< 40): comfortable headroom
 * - 'warn' (40-60): närmar sig PtQueue-overflow-risk
 * - 'alarm' (> 60): firmware-drops sannolikt
 */
export type DispatchTone = 'ok' | 'warn' | 'alarm';

export function dispatchRateTone(dps: number): DispatchTone {
  if (dps > 60) return 'alarm';
  if (dps > 40) return 'warn';
  return 'ok';
}

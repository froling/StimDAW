/**
 * Embedded ET-312 patterns312 CSV-data.
 *
 * Vite ?raw-imports gör att CSV-text hamnar i bundle vid build-tid. Bara
 * mindre patterns embeddas (<100KB). Större (Orgasm_min/max) lazy-fetchas
 * från public/patterns312/ för att inte blåsa upp initial bundle.
 *
 * Storleksbudget vid skrivande:
 *   Intense: 2 KB  (47 pulser)
 *   Toggle:  60 KB (1232 pulser)
 *   Total:   ~62 KB embedded — acceptable bundle-impact
 *
 * Cachar parse-resultatet så upprepade play-actions inte re-parsas.
 */
import intenseCsv from '../../../reference/NeoDK/patterns312/Intense.csv?raw';
import toggleCsv from '../../../reference/NeoDK/patterns312/Toggle.csv?raw';
import { parsePatterns312Csv, type RecordedPulse } from '../csv-format';

const cache = new Map<string, readonly RecordedPulse[]>();

function loadCached(key: string, csvText: string): readonly RecordedPulse[] {
  const hit = cache.get(key);
  if (hit) return hit;
  const parsed = Object.freeze(parsePatterns312Csv(csvText));
  cache.set(key, parsed);
  return parsed;
}

export async function loadIntense(): Promise<readonly RecordedPulse[]> {
  return loadCached('intense', intenseCsv);
}

export async function loadToggle312(): Promise<readonly RecordedPulse[]> {
  return loadCached('toggle312', toggleCsv);
}

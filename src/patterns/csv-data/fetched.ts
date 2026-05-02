/**
 * Lazy-fetched ET-312 patterns312 CSV-data.
 *
 * Större CSVs (Orgasm_min ~720 KB, Orgasm_max ~5.2 MB) ligger i
 * public/patterns312/ och fetchas vid första play-action. Skipper bundle-
 * inflate; user betalar nedladdning bara om de använder pattern.
 *
 * Cachar parse-resultatet i minnet så upprepade play-actions inte
 * re-fetchas eller re-parsas.
 */
import { parsePatterns312Csv, type RecordedPulse } from '../csv-format';

const cache = new Map<string, readonly RecordedPulse[]>();
const inflight = new Map<string, Promise<readonly RecordedPulse[]>>();

async function fetchAndParse(url: string, key: string): Promise<readonly RecordedPulse[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  // Dedupa concurrent loads (om user dubbel-klickar play)
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<readonly RecordedPulse[]> => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    const parsed = Object.freeze(parsePatterns312Csv(text));
    cache.set(key, parsed);
    inflight.delete(key);
    return parsed;
  })();

  inflight.set(key, promise);
  return promise;
}

export function loadOrgasmMin(): Promise<readonly RecordedPulse[]> {
  return fetchAndParse('/patterns312/Orgasm_min.csv', 'orgasm-min');
}

export function loadOrgasmMax(): Promise<readonly RecordedPulse[]> {
  return fetchAndParse('/patterns312/Orgasm_max.csv', 'orgasm-max');
}

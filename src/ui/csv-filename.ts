/**
 * Pure CSV-filnamns-byggare — framework-fri så den kan unit-testas utan
 * Svelte runtime ($state är compiler-macro som inte funkar i bun test).
 */

/**
 * Bygg filsystem-vänligt CSV-filnamn. Slugar pattern-namnet och
 * stoppar in en ISO-stämpel utan kolon/punkter/millisekunder.
 *
 * Exempel:
 *   buildCsvFilename('Toggle 300×', new Date('2026-04-30T15:32:11Z'))
 *     → 'stimdaw-toggle-300-20260430T153211.csv'
 */
export function buildCsvFilename(patternName: string | null | undefined, now: Date): string {
  const slugged = (patternName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const patternSlug = slugged === '' ? 'no-pattern' : slugged;
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  return `stimdaw-${patternSlug}-${iso}.csv`;
}

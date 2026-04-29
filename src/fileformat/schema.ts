import { z } from 'zod';

/**
 * `.stimdaw` filformat v0.
 *
 * Versionsfältet är en literal — discriminated union när vi får v1. Migration-
 * harness existerar från dag 1 (`migrate.ts`) så att v0 → v1 är en
 * funktion som läggs till när schemat ändras.
 */

export const SettingsV0 = z.object({
  /** Ramp-up tid i ms från 0 till lastKnown vid reconnect (A5=A: 5s default). */
  rampUpDurationMs: z.number().int().min(0).max(60_000).default(5000),
  /** Hard absolute amplitude ceiling 0–100% (R3=A: 50% default). */
  maxCeilingPercent: z.number().int().min(0).max(100).default(50),
});
export type SettingsV0 = z.infer<typeof SettingsV0>;

export const StimDAWFileV0 = z.object({
  version: z.literal(0),
  createdAt: z.string().datetime().optional(),
  settings: SettingsV0,
  cliHistory: z.array(z.string()).max(200).default([]),
});
export type StimDAWFileV0 = z.infer<typeof StimDAWFileV0>;

export const CURRENT_VERSION = 0 as const;

/** Discriminated union — when v1 lands, becomes [StimDAWFileV0, StimDAWFileV1]. */
export const StimDAWFile = z.discriminatedUnion('version', [StimDAWFileV0]);
export type StimDAWFile = z.infer<typeof StimDAWFile>;

/** Default state file (used when nothing on disk yet). */
export function defaultStimDAWFile(): StimDAWFileV0 {
  return {
    version: 0,
    createdAt: new Date().toISOString(),
    settings: SettingsV0.parse({}),
    cliHistory: [],
  };
}

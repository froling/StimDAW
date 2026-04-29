import { StimDAWFile, type SettingsV0, type StimDAWFileV0 } from './schema';
import { migrate } from './migrate';
import { scrubObject } from '../safety/identity-scrubber';
import { createLogger } from '../log';

const log = createLogger('fileformat');

const SETTINGS_LS_KEY = 'stimdaw:v0:settings';

interface FileSystemFileHandleLike {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<{ text(): Promise<string> }>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}

interface OpenFilePickerOptions extends SaveFilePickerOptions {
  multiple?: boolean;
}

declare global {
  interface Window {
    showSaveFilePicker?: (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
    showOpenFilePicker?: (opts?: OpenFilePickerOptions) => Promise<FileSystemFileHandleLike[]>;
  }
}

// ── Settings persistence (localStorage) ─────────────────────────────────────

/**
 * Auto-persist settings on every change. Survives app reload (A5=A: säkerhets-
 * kritiska defaults måste persistera). Per outside-voice finding #14 körs all
 * data genom identity-scrubber innan write — ingen path/username läcker.
 */
export function saveSettings(settings: SettingsV0): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const wrapped = { version: 0 as const, settings };
    const scrubbed = scrubObject(wrapped);
    localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(scrubbed));
  } catch (e) {
    log.warn('saveSettings failed:', e);
  }
}

/** Returns saved settings or null if none / corrupt. Caller uses defaults on null. */
export function loadSettings(): SettingsV0 | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SETTINGS_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = StimDAWFile.safeParse({ ...parsed, cliHistory: [] });
    if (!result.success) {
      log.warn('loadSettings: schema mismatch, ignoring', result.error.issues);
      return null;
    }
    return result.data.settings;
  } catch (e) {
    log.warn('loadSettings failed:', e);
    return null;
  }
}

// ── .stimdaw file IO (FS Access API, browser-only) ──────────────────────────

export interface FileSaveResult {
  success: boolean;
  reason?: string;
}

export type FileLoadResult =
  | { ok: true; state: StimDAWFileV0 }
  | { ok: false; reason: string };

export async function saveToFile(state: StimDAWFileV0): Promise<FileSaveResult> {
  if (typeof window === 'undefined' || !window.showSaveFilePicker) {
    return { success: false, reason: 'FS Access API not available in this browser' };
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'session.stimdaw',
      types: [
        {
          description: 'StimDAW session',
          accept: { 'application/json': ['.stimdaw'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    const scrubbed = scrubObject(state);
    await writable.write(JSON.stringify(scrubbed, null, 2));
    await writable.close();
    return { success: true };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { success: false, reason: 'cancelled' };
    }
    return { success: false, reason: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function loadFromFile(): Promise<FileLoadResult> {
  if (typeof window === 'undefined' || !window.showOpenFilePicker) {
    return { ok: false, reason: 'FS Access API not available in this browser' };
  }
  try {
    const handles = await window.showOpenFilePicker({
      types: [
        {
          description: 'StimDAW session',
          accept: { 'application/json': ['.stimdaw'] },
        },
      ],
      multiple: false,
    });
    const handle = handles[0];
    if (!handle) return { ok: false, reason: 'no file selected' };
    const file = await handle.getFile();
    const text = await file.text();
    const raw = JSON.parse(text);
    const migrated = migrate(raw);
    return { ok: true, state: migrated };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: e instanceof Error ? e.message : 'unknown' };
  }
}

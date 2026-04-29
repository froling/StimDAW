import { StimDAWFile, CURRENT_VERSION, type StimDAWFileV0 } from './schema';

export class MigrationError extends Error {
  constructor(
    public fromVersion: number,
    public toVersion: number,
    message: string,
  ) {
    super(`Migration ${fromVersion} → ${toVersion} failed: ${message}`);
    this.name = 'MigrationError';
  }
}

/**
 * Migrate parsed JSON (any known version) up to CURRENT_VERSION.
 * Throws MigrationError on unknown/future version or corrupt structure.
 *
 * V0 → V0 är en no-op. Harness exists så v0 → v1 är en funktion add:ad
 * till MIGRATIONS-map när nästa schemaversion landar.
 */
export function migrate(parsed: unknown): StimDAWFileV0 {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MigrationError(-1, CURRENT_VERSION, 'input is not an object');
  }
  const obj = parsed as { version?: unknown };
  if (obj.version === undefined) {
    throw new MigrationError(-1, CURRENT_VERSION, 'missing version field');
  }
  if (typeof obj.version !== 'number') {
    throw new MigrationError(-1, CURRENT_VERSION, `version is ${typeof obj.version}, not number`);
  }

  let current: { version: number; [key: string]: unknown } = obj as {
    version: number;
    [key: string]: unknown;
  };

  while (current.version < CURRENT_VERSION) {
    const fn = MIGRATIONS[current.version];
    if (!fn) {
      throw new MigrationError(current.version, CURRENT_VERSION, 'no migration registered');
    }
    current = fn(current);
  }

  if (current.version > CURRENT_VERSION) {
    throw new MigrationError(
      current.version,
      CURRENT_VERSION,
      'file is newer than this client',
    );
  }

  // Final validation pass
  const result = StimDAWFile.safeParse(current);
  if (!result.success) {
    throw new MigrationError(
      current.version,
      CURRENT_VERSION,
      `validation failed: ${result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}`,
    );
  }
  return result.data as StimDAWFileV0;
}

type Migrator = (input: { version: number; [key: string]: unknown }) => {
  version: number;
  [key: string]: unknown;
};

const MIGRATIONS: Record<number, Migrator> = {
  // No migrations yet. v0 → v1 will be added when v1 schema exists.
};

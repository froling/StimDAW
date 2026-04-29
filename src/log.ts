export type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: Level = 'info';

export function setLogLevel(level: Level): void {
  minLevel = level;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(module: string): Logger {
  const prefix = `[${module}]`;
  const make =
    (level: Level, sink: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
      sink(prefix, ...args);
    };
  return {
    debug: make('debug', console.debug),
    info: make('info', console.info),
    warn: make('warn', console.warn),
    error: make('error', console.error),
  };
}

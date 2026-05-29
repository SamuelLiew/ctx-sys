/**
 * Injectable logger interface replacing bare console.* calls in library code.
 * CLI files intentionally keep console.* for terminal output.
 */

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Default logger. Debug is silent by default. Everything that *does*
 * log goes to stderr — never stdout — so the MCP stdio transport
 * (which owns stdout for JSON-RPC) is never polluted by library logs
 * (v2 F1.4: stdio hygiene).
 *
 * CLI commands that intentionally render to stdout do so through
 * `CLIOutput` in cli/init.ts, not through this logger.
 */
function stderr(msg: string, args: unknown[]): void {
  const line = args.length === 0 ? `${msg}\n` : `${msg} ${args.map(a => safeStringify(a)).join(' ')}\n`;
  process.stderr.write(line);
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const consoleLogger: Logger = {
  debug: () => {},
  info:  (msg, ...args) => stderr(msg, args),
  warn:  (msg, ...args) => stderr(msg, args),
  error: (msg, ...args) => stderr(msg, args),
};

/** Silent logger for tests and library consumers who want no output. */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Log level names in ascending severity order. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, silent: 4
};

/**
 * Create a logger that filters messages below the given minimum level.
 * v2 F1.4: every level lands on stderr — never stdout — for stdio hygiene.
 */
export function createLogger(minLevel: LogLevel = 'warn'): Logger {
  const min = LEVEL_ORDER[minLevel];
  return {
    debug: min <= 0 ? (msg, ...a) => stderr(msg, a) : () => {},
    info:  min <= 1 ? (msg, ...a) => stderr(msg, a) : () => {},
    warn:  min <= 2 ? (msg, ...a) => stderr(msg, a) : () => {},
    error: min <= 3 ? (msg, ...a) => stderr(msg, a) : () => {},
  };
}

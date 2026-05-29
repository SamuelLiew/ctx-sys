/**
 * v2 F2.2: first-call loading indicator.
 *
 * The first embedding call after a backend starts can take 30–60s as
 * the model loads into memory. withLoadingIndicator wraps any
 * provider operation; if it hasn't returned in `delayMs` (default 3s),
 * it prints a one-line stderr notice and resolves the indicator when
 * the operation finishes. Suppressed on subsequent calls — the caller
 * decides when to reset by constructing a new indicator instance.
 *
 * Uses stderr (never stdout) to stay compatible with the F1.4 stdio
 * hygiene contract.
 */

export interface LoadingIndicatorOptions {
  /** How long to wait before printing the 'Loading…' line (ms). */
  delayMs?: number;
  /** Override the message; default mentions the model name + estimate. */
  message?: string;
  /**
   * Stream for the indicator. Defaults to process.stderr.write so the
   * stdio-hygiene contract (no library output on stdout) holds. Tests
   * can pass a buffer-like stream to capture.
   */
  write?: (chunk: string) => void;
}

/**
 * Wrap an async operation with a 'first call may take a minute' notice
 * that fires only if the operation hasn't returned within delayMs.
 */
export async function withLoadingIndicator<T>(
  modelName: string,
  op: () => Promise<T>,
  options: LoadingIndicatorOptions = {},
): Promise<T> {
  const delay = options.delayMs ?? 3000;
  const write = options.write ?? ((chunk: string) => { process.stderr.write(chunk); });
  const msg = options.message ?? `Loading model '${modelName}' (first call, this can take ~1 minute)…\n`;
  let printed = false;
  const timer = setTimeout(() => {
    write(msg);
    printed = true;
  }, delay);
  try {
    return await op();
  } finally {
    clearTimeout(timer);
    if (printed) write(`Model '${modelName}' loaded.\n`);
  }
}

/**
 * v2 F2.2: preflight check for backend-touching commands.
 *
 * Every CLI command that talks to an embedding/completion provider
 * (index / search / context / embed / serve) calls preflightProvider()
 * before doing any work. The check is cheap (a single healthCheck()
 * round trip with a 3s timeout) and gives users a clean one-line
 * failure mode instead of a deep stack trace from the first real
 * embed call when something's broken.
 *
 * Output uses the CtxError fix shape (F2.1) so messages are
 * indistinguishable from real-error recovery hints.
 */

import { EmbeddingProvider, ProviderHealth } from './types';

export interface PreflightOptions {
  /**
   * When true, the function returns the failure ProviderHealth instead
   * of throwing. Doctor uses this to render multi-check status; CLI
   * commands let it throw.
   */
  doNotThrow?: boolean;
  /** Override the timeout (default 3s, matching healthCheck()). */
  timeoutMs?: number;
}

/**
 * Run a preflight check against an embedding provider. Throws a clear
 * one-line error with a recovery hint when the provider isn't healthy.
 */
export async function preflightProvider(
  provider: EmbeddingProvider,
  options: PreflightOptions = {},
): Promise<ProviderHealth> {
  const health = await (provider.healthCheck
    ? provider.healthCheck()
    : fallbackHealthFromIsAvailable(provider));
  if (health.status === 'ok') return health;
  if (options.doNotThrow) return health;
  const msg = [
    `Embedding provider preflight failed (${provider.name}): ${health.detail ?? health.status}`,
    health.fix ? `Fix: ${health.fix}` : null,
  ].filter(Boolean).join('\n');
  throw new Error(msg);
}

async function fallbackHealthFromIsAvailable(provider: EmbeddingProvider): Promise<ProviderHealth> {
  const ok = await provider.isAvailable().catch(() => false);
  return ok
    ? { status: 'ok' }
    : {
        status: 'unknown',
        detail: `Provider ${provider.name} reports unavailable (no structured healthCheck)`,
        fix: 'Check provider configuration and connectivity.',
      };
}

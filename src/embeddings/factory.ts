import { EmbeddingProvider, ProviderConfig } from './types';
import { LocalEmbeddingProvider } from './local-provider';
import { Logger, consoleLogger } from '../utils/logger';

/**
 * Factory for creating embedding providers.
 */
export class EmbeddingProviderFactory {
  /**
   * Create an embedding provider from configuration.
   */
  static async create(config: ProviderConfig): Promise<EmbeddingProvider> {
    if (config.provider === 'local') {
      return LocalEmbeddingProvider.create({
        baseUrl: '',
        model: config.model || 'mxbai-embed-large'
      });
    }
    throw new Error(`Only local provider is supported. Received: ${config.provider}`);
  }

  /**
   * Create a provider with fallback if primary is unavailable.
   */
  static async createWithFallback(
    primary: ProviderConfig,
    fallback: ProviderConfig,
    logger: Logger = consoleLogger
  ): Promise<EmbeddingProvider> {
    const primaryProvider = await this.create(primary);

    if (await primaryProvider.isAvailable()) {
      return primaryProvider;
    }

    logger.warn('Primary embedding provider unavailable, using fallback');
    return await this.create(fallback);
  }
}

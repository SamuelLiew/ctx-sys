import { EmbeddingProvider, ProviderConfig } from './types';
import { LocalEmbeddingProvider } from './local-provider';
import { OpenAIEmbeddingProvider } from './openai';
import { OpenAICompatibleEmbeddingProvider } from './openai-compatible';
import { Logger, consoleLogger } from '../utils/logger';

/**
 * Factory for creating embedding providers.
 */
export class EmbeddingProviderFactory {
  /**
   * Create an embedding provider from configuration. v2 F2.2: now
   * supports 'openai-compatible' for any local server that speaks the
   * OpenAI embeddings shape (vLLM / LM Studio / llamafile / LiteLLM /
   * llama.cpp's --api-style openai).
   */
  static async create(config: ProviderConfig): Promise<EmbeddingProvider> {
    switch (config.provider) {
      case 'local':
        return LocalEmbeddingProvider.create({
          baseUrl: '',
          model: config.model || 'all-MiniLM-L6-v2'
        });

      case 'ollama':
        return LocalEmbeddingProvider.create({
          baseUrl: config.baseUrl || '',
          model: config.model
        });

      case 'openai':
        if (!config.apiKey) {
          throw new Error('OpenAI API key required');
        }
        return new OpenAIEmbeddingProvider({
          apiKey: config.apiKey,
          model: config.model
        });

      case 'openai-compatible':
        if (!config.baseUrl) {
          throw new Error('openai-compatible provider requires `baseUrl` (e.g. http://localhost:8080/v1)');
        }
        return new OpenAICompatibleEmbeddingProvider({
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.apiKey,
        });

      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
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

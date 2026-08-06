/**
 * Provider factory for creating and managing embedding and summarization providers.
 * Supports automatic fallback when primary provider is unavailable.
 */

import {
  EmbeddingProvider,
  LocalEmbeddingProvider,
  MockEmbeddingProvider
} from '../embeddings';
import { LLMSummarizer } from '../summarization';
import { ConfigManager } from '../config';
import { Logger, consoleLogger } from '../utils/logger';

/**
 * Configuration for a model provider.
 */
export interface ModelProviderConfig {
  provider: 'local' | 'mock';
  model: string;
}

/**
 * Health status of a provider.
 */
export interface ProviderHealth {
  available: boolean;
  lastChecked: Date;
  error?: string;
}

/**
 * Provider factory options.
 */
export interface ProviderFactoryOptions {
  /** ConfigManager instance (optional, will create default if not provided) */
  configManager?: ConfigManager;
  /** Health check cache TTL in milliseconds (default: 5 minutes) */
  healthCacheTTL?: number;
  /** Logger instance */
  logger?: Logger;
}

/**
 * Factory for creating embedding and summarization providers.
 */
export class ProviderFactory {
  private configManager: ConfigManager;
  private embeddingProviders: Map<string, EmbeddingProvider> = new Map();
  private summarizationProviders: Map<string, LLMSummarizer> = new Map();
  private healthCache: Map<string, ProviderHealth> = new Map();
  private healthCacheTTL: number;
  private logger: Logger;

  constructor(options: ProviderFactoryOptions = {}) {
    this.configManager = options.configManager ?? new ConfigManager({ inMemoryOnly: true });
    this.healthCacheTTL = options.healthCacheTTL ?? 5 * 60 * 1000; // 5 minutes
    this.logger = options.logger ?? consoleLogger;
  }

  /**
   * Get an embedding provider.
   */
  async getEmbeddingProvider(config?: ModelProviderConfig): Promise<EmbeddingProvider> {
    const resolvedConfig = config ?? await this.getDefaultEmbeddingConfig();
    const key = this.getProviderKey('embedding', resolvedConfig);

    if (this.embeddingProviders.has(key)) {
      return this.embeddingProviders.get(key)!;
    }

    const provider = await this.createEmbeddingProvider(resolvedConfig);
    this.embeddingProviders.set(key, provider);
    return provider;
  }

  /**
   * Get an embedding provider with automatic fallback.
   */
  async getEmbeddingProviderWithFallback(
    primary?: ModelProviderConfig,
    fallback?: ModelProviderConfig
  ): Promise<EmbeddingProvider> {
    const primaryConfig = primary ?? await this.getDefaultEmbeddingConfig();
    const fallbackConfig = fallback ?? { provider: 'mock' as const, model: 'mock-embed' };

    try {
      const primaryProvider = await this.getEmbeddingProvider(primaryConfig);

      if (await this.checkHealth(primaryProvider)) {
        return primaryProvider;
      }

      this.logger.warn(`Primary embedding provider ${primaryConfig.provider}:${primaryConfig.model} unavailable, using fallback`);
    } catch (error) {
      this.logger.warn(`Failed to create primary embedding provider: ${error}`);
    }

    return this.getEmbeddingProvider(fallbackConfig);
  }

  /**
   * Get a summarization provider.
   */
  async getSummarizationProvider(config?: ModelProviderConfig): Promise<LLMSummarizer> {
    const resolvedConfig = config ?? await this.getDefaultSummarizationConfig();
    const key = this.getProviderKey('summarization', resolvedConfig);

    if (this.summarizationProviders.has(key)) {
      return this.summarizationProviders.get(key)!;
    }

    const provider = await this.createSummarizationProvider(resolvedConfig);
    this.summarizationProviders.set(key, provider);
    return provider;
  }

  /**
   * Get a summarization provider with automatic fallback.
   */
  async getSummarizationProviderWithFallback(
    primary?: ModelProviderConfig,
    fallback?: ModelProviderConfig
  ): Promise<LLMSummarizer> {
    const primaryConfig = primary ?? await this.getDefaultSummarizationConfig();
    const fallbackConfig = fallback ?? { provider: 'mock' as const, model: 'mock-summarizer' };

    try {
      const primaryProvider = await this.getSummarizationProvider(primaryConfig);

      if (await this.checkSummarizationHealth(primaryProvider)) {
        return primaryProvider;
      }

      this.logger.warn(`Primary summarization provider ${primaryConfig.provider}:${primaryConfig.model} unavailable, using fallback`);
    } catch (error) {
      this.logger.warn(`Failed to create primary summarization provider: ${error}`);
    }

    return this.getSummarizationProvider(fallbackConfig);
  }

  /**
   * Check if an embedding provider is healthy.
   */
  async checkHealth(provider: EmbeddingProvider): Promise<boolean> {
    const key = `${provider.name}:${provider.modelId}`;
    const cached = this.getCachedHealth(key);

    if (cached !== undefined) {
      return cached;
    }

    try {
      const available = await provider.isAvailable();
      this.setCachedHealth(key, available);
      return available;
    } catch (error) {
      this.setCachedHealth(key, false, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Check if a summarization provider is healthy.
   */
  async checkSummarizationHealth(provider: LLMSummarizer): Promise<boolean> {
    const key = `summarizer:${provider.name ?? 'unknown'}`;
    const cached = this.getCachedHealth(key);

    if (cached !== undefined) {
      return cached;
    }

    try {
      await provider.summarizeSymbol({
        name: 'test',
        type: 'function',
        qualifiedName: 'test',
        startLine: 1,
        endLine: 1
      });
      this.setCachedHealth(key, true);
      return true;
    } catch (error) {
      this.setCachedHealth(key, false, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Get health status for all cached providers.
   */
  getHealthStatus(): Map<string, ProviderHealth> {
    return new Map(this.healthCache);
  }

  /**
   * Clear health cache.
   */
  clearHealthCache(): void {
    this.healthCache.clear();
  }

  /**
   * Clear all provider caches.
   */
  clearAll(): void {
    this.embeddingProviders.clear();
    this.summarizationProviders.clear();
    this.healthCache.clear();
  }

  /**
   * Create an embedding provider.
   */
  private async createEmbeddingProvider(config: ModelProviderConfig): Promise<EmbeddingProvider> {
    switch (config.provider) {
      case 'local':
        return LocalEmbeddingProvider.create({
          baseUrl: '',
          model: config.model
        });

      case 'mock':
        return new MockEmbeddingProvider();

      default:
        throw new Error(`Unknown embedding provider: ${config.provider}`);
    }
  }

  /**
   * Create a summarization provider.
   */
  private async createSummarizationProvider(config: ModelProviderConfig): Promise<LLMSummarizer> {
    switch (config.provider) {
      case 'mock':
      default:
        return new MockSummarizationProvider();
    }
  }

  /**
   * Get default embedding config from ConfigManager.
   */
  private async getDefaultEmbeddingConfig(): Promise<ModelProviderConfig> {
    const config = await this.configManager.loadGlobal();
    return {
      provider: config.defaults.embeddings.provider as ModelProviderConfig['provider'],
      model: config.defaults.embeddings.model
    };
  }

  /**
   * Get default summarization config from ConfigManager.
   */
  private async getDefaultSummarizationConfig(): Promise<ModelProviderConfig> {
    const config = await this.configManager.loadGlobal();
    return {
      provider: config.defaults.summarization.provider as ModelProviderConfig['provider'],
      model: config.defaults.summarization.model
    };
  }

  /**
   * Generate a unique key for a provider.
   */
  private getProviderKey(type: string, config: ModelProviderConfig): string {
    return `${type}:${config.provider}:${config.model}`;
  }

  /**
   * Get cached health status.
   */
  private getCachedHealth(key: string): boolean | undefined {
    const cached = this.healthCache.get(key);
    if (!cached) return undefined;

    const age = Date.now() - cached.lastChecked.getTime();
    if (age > this.healthCacheTTL) {
      this.healthCache.delete(key);
      return undefined;
    }

    return cached.available;
  }

  /**
   * Set cached health status.
   */
  private setCachedHealth(key: string, available: boolean, error?: string): void {
    this.healthCache.set(key, {
      available,
      lastChecked: new Date(),
      error
    });
  }
}

/**
 * Mock summarization provider for testing.
 */
export class MockSummarizationProvider implements LLMSummarizer {
  readonly name = 'mock';
  public failOnCall = false;

  async summarizeSymbol(symbol: any, _context?: string): Promise<string> {
    if (this.failOnCall) {
      throw new Error('Mock provider configured to fail');
    }
    return `Mock summary for ${symbol.name}`;
  }

  async summarizeFile(parseResult: any): Promise<string> {
    if (this.failOnCall) {
      throw new Error('Mock provider configured to fail');
    }
    return `Mock file summary for ${parseResult.filePath ?? 'unknown file'}`;
  }
}

/**
 * Default provider factory instance.
 */
export const defaultProviderFactory = new ProviderFactory();

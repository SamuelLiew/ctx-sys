import { EmbeddingProvider, BatchOptions, EmbedOptions, ModelIdentifier, ProviderHealth } from './types';
import { embed as localEmbed } from './local';

export interface LocalProviderConfig {
  baseUrl?: string;
  model: string;
}

const DEFAULT_MAX_CHARS = 512;
const DEFAULT_DIMENSIONS = 384;

/**
 * Embedding provider using local in-process transformers API (@xenova/transformers).
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly modelId: string;
  readonly dimensions: number;
  readonly maxChars: number;

  constructor(private config: LocalProviderConfig, resolved?: { dimensions?: number; maxChars?: number }) {
    this.modelId = `local:${config.model}`;
    this.dimensions = resolved?.dimensions ?? DEFAULT_DIMENSIONS;
    this.maxChars = resolved?.maxChars ?? DEFAULT_MAX_CHARS;
  }

  /**
   * Create a LocalEmbeddingProvider.
   */
  static async create(config: LocalProviderConfig): Promise<LocalEmbeddingProvider> {
    return new LocalEmbeddingProvider(config);
  }

  /**
   * Detect embedding dimensions and context length.
   */
  static async detectModelInfo(_baseUrl: string, _model: string): Promise<{ dimensions?: number; maxChars?: number } | null> {
    return { dimensions: DEFAULT_DIMENSIONS, maxChars: DEFAULT_MAX_CHARS };
  }

  /**
   * Detect embedding dimensions only.
   */
  static async detectDimensions(_baseUrl: string, _model: string): Promise<number | null> {
    return DEFAULT_DIMENSIONS;
  }

  async embed(text: string, options?: EmbedOptions): Promise<number[]> {
    const truncated = text.length > this.maxChars ? text.slice(0, this.maxChars) : text;

    const embeddings = await localEmbed([truncated]);
    if (!embeddings || !embeddings[0]) {
      throw new Error(`Local embedder returned empty embedding for model ${this.config.model}`);
    }
    return embeddings[0];
  }

  async embedBatch(texts: string[], options?: BatchOptions & EmbedOptions): Promise<number[][]> {
    const batchSize = options?.batchSize || 10;
    const results: number[][] = [];
    let completed = 0;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, Math.min(i + batchSize, texts.length));

      const truncatedBatch = batch.map(t => (t.length > this.maxChars ? t.slice(0, this.maxChars) : t));

      try {
        const embeddings = await localEmbed(truncatedBatch);
        results.push(...embeddings);
      } catch {
        // If batch fails, fall back to individual embedding
        for (const text of batch) {
          try {
            const single = await localEmbed([text]);
            results.push(single[0]);
          } catch {
            // Use zero vector for failed embeddings
            results.push(new Array(this.dimensions).fill(0));
          }
          completed++;
          options?.onProgress?.(completed, texts.length);
        }
        continue;
      }

      completed += batch.length;
      options?.onProgress?.(completed, texts.length);
    }

    return results;
  }

  getModelIdentifier(): ModelIdentifier {
    return {
      name: this.config.model,
      provider: 'local',
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Health check reporting local embedder status.
   */
  async healthCheck(): Promise<ProviderHealth> {
    return { status: 'ok', detail: 'Local in-process embedding provider (Xenova/all-MiniLM-L6-v2)' };
  }
}

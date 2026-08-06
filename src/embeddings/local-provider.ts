import { EmbeddingProvider, BatchOptions, EmbedOptions, ModelIdentifier, ProviderHealth } from './types';
import { embed as localEmbed } from './local';

export interface LocalProviderConfig {
  baseUrl?: string;
  model: string;
}

const DEFAULT_MAX_CHARS = 512;
const DEFAULT_DIMENSIONS = 1024; // mxbai-embed-large

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

  static async create(config: LocalProviderConfig): Promise<LocalEmbeddingProvider> {
    return new LocalEmbeddingProvider(config);
  }

  static async detectModelInfo(): Promise<{ dimensions?: number; maxChars?: number } | null> {
    return { dimensions: DEFAULT_DIMENSIONS, maxChars: DEFAULT_MAX_CHARS };
  }

  static async detectDimensions(): Promise<number> {
    return DEFAULT_DIMENSIONS;
  }

  async embed(text: string, options?: EmbedOptions): Promise<number[]> {
    const truncated = text.length > this.maxChars ? text.slice(0, this.maxChars) : text;
    const embeddings = await localEmbed([truncated]);
    if (!embeddings?.[0]) {
      throw new Error(`Local embedder returned empty embedding for model ${this.config.model}`);
    }
    return embeddings[0];
  }

  async embedBatch(texts: string[], options?: BatchOptions & EmbedOptions): Promise<number[][]> {
    const batchSize = options?.batchSize || 50;
    const results: number[][] = [];
    let completed = 0;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map(t =>
        t.length > this.maxChars ? t.slice(0, this.maxChars) : t
      );

      try {
        const embeddings = await localEmbed(batch);
        results.push(...embeddings);
        completed += batch.length;
      } catch (batchErr) {
        // Fallback: one-by-one to isolate failures without poisoning vector DB
        for (const text of batch) {
          const single = await localEmbed([text]);
          if (!single?.[0]) {
            throw new Error(`Failed to generate embedding for text block: ${batchErr}`);
          }
          results.push(single[0]);
          completed++;
        }
      }
      options?.onProgress?.(completed, texts.length);
    }

    return results;
  }

  getModelIdentifier(): ModelIdentifier {
    return { name: this.config.model, provider: 'local' };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: 'ok',
      detail: `Local in-process embedding provider (${this.config.model}, ${this.dimensions}-dim)`
    };
  }
}

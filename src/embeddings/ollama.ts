import { EmbeddingProvider, BatchOptions, EmbedOptions, ModelIdentifier, ProviderHealth } from './types';
import { embed as localEmbed } from './local';

interface OllamaConfig {
  baseUrl: string;
  model: string;
}

/**
 * Normalize base URL: replace localhost with 127.0.0.1 to avoid
 * IPv6 resolution issues on macOS where Ollama only listens on IPv4.
 */
function normalizeBaseUrl(url: string): string {
  return url.replace('://localhost', '://127.0.0.1');
}

/**
 * Max input lengths (in characters) for known embedding models.
 */
const MODEL_MAX_CHARS: Record<string, number> = {
  'nomic-embed-text': 4000,
  'mxbai-embed-large': 1024,
  'all-minilm': 700,
  'bge-base': 1024,
  'bge-large': 1024
};

const DEFAULT_MAX_CHARS = 1024;

const MODEL_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 384,
  'mxbai-embed-large': 384,
  'all-minilm': 384,
  'bge-base': 384,
  'bge-large': 384
};

/**
 * Model-specific prompt prefixes for query vs document embedding.
 */
const MODEL_PREFIXES: Record<string, { query: string; document: string }> = {
  'nomic-embed-text': {
    query: 'search_query: ',
    document: 'search_document: '
  },
  'mxbai-embed-large': {
    query: 'Represent this sentence for searching relevant passages: ',
    document: ''
  }
};

/**
 * Embedding provider using local transformers API.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly modelId: string;
  readonly dimensions: number;
  readonly maxChars: number;

  private baseModel: string;

  constructor(private config: OllamaConfig, resolved?: { dimensions?: number; maxChars?: number }) {
    this.config.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.modelId = `local:${config.model}`;
    this.baseModel = config.model.split(':')[0];
    this.dimensions = 384;
    this.maxChars = resolved?.maxChars
      ?? MODEL_MAX_CHARS[this.baseModel]
      ?? DEFAULT_MAX_CHARS;
  }

  /**
   * Create a LocalEmbeddingProvider.
   */
  static async create(config: OllamaConfig): Promise<LocalEmbeddingProvider> {
    return new LocalEmbeddingProvider(config);
  }

  /**
   * Detect embedding dimensions and context length.
   */
  static async detectModelInfo(_baseUrl: string, _model: string): Promise<{ dimensions?: number; maxChars?: number } | null> {
    return { dimensions: 384, maxChars: 1024 };
  }

  /**
   * Detect embedding dimensions only.
   */
  static async detectDimensions(_baseUrl: string, _model: string): Promise<number | null> {
    return 384;
  }

  /**
   * Apply model-specific prefix to text based on whether it's a query or document.
   */
  private applyPrefix(text: string, isQuery: boolean): string {
    const prefixes = MODEL_PREFIXES[this.baseModel];
    if (!prefixes) return text;
    const prefix = isQuery ? prefixes.query : prefixes.document;
    return prefix + text;
  }

  async embed(text: string, options?: EmbedOptions): Promise<number[]> {
    const prefixed = this.applyPrefix(text, options?.isQuery ?? false);
    const truncated = prefixed.length > this.maxChars ? prefixed.slice(0, this.maxChars) : prefixed;

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
    const isQuery = options?.isQuery ?? false;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, Math.min(i + batchSize, texts.length));

      // Apply model-specific prefixes and truncate
      const truncatedBatch = batch.map(t => {
        const prefixed = this.applyPrefix(t, isQuery);
        return prefixed.length > this.maxChars ? prefixed.slice(0, this.maxChars) : prefixed;
      });

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

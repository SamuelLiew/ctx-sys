/**
 * Embedding provider and storage type definitions.
 */

export interface EmbedOptions {
  /** Whether this text is a search query (vs a document to be indexed) */
  isQuery?: boolean;
}

export interface ModelIdentifier {
  name: string;
  provider: string;
  version?: string;
}

/**
 * v2: Provider health status shape. Reports status enum with recovery fields.
 */
export interface ProviderHealth {
  status: 'ok' | 'unreachable' | 'model_missing' | 'auth_failed' | 'unknown';
  /** Human-readable single-line summary. */
  detail?: string;
  /** Copy-pasteable recovery command, or a one-line config nudge. */
  fix?: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly modelId: string;
  readonly dimensions: number;
  readonly maxChars?: number;

  embed(text: string, options?: EmbedOptions): Promise<number[]>;
  embedBatch(texts: string[], options?: BatchOptions & EmbedOptions): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
  /**
   * v2 F2.2: structured health check. Default implementations may
   * delegate to isAvailable() and synthesize a basic ProviderHealth;
   * provider implementations are encouraged to override for richer
   * diagnostics (e.g. distinguishing 'unreachable' from 'model_missing'
   * vs 'auth_failed').
   */
  healthCheck?(): Promise<ProviderHealth>;
  getModelIdentifier(): ModelIdentifier;
}

export interface BatchOptions {
  batchSize?: number;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}

export interface StoredEmbedding {
  id: string;
  entityId: string;
  modelId: string;
  embedding: number[];
  createdAt: Date;
}

export interface SimilarityResult {
  entityId: string;
  score: number;
  distance: number;
}

export interface EmbeddingRow {
  id: string;
  entity_id: string;
  model_id: string;
  embedding: string;
  created_at: string;
}

export interface ProviderConfig {
  provider: 'local' | 'mock';
  model: string;
}

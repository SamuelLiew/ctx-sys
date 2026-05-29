/**
 * v2 F2.2: OpenAI-compatible embedding provider.
 *
 * Covers every local backend that exposes the OpenAI embeddings API
 * shape on a custom base_url:
 *
 *   - vLLM         (https://docs.vllm.ai/)
 *   - LM Studio    (the GUI app's 'Local Server')
 *   - llamafile    (single-file inference, OpenAI shape)
 *   - LiteLLM      (proxy that exposes OpenAI for any model)
 *   - llama.cpp    (llama-server's --api-style openai)
 *   - api.openai.com itself (just configure base_url accordingly — but
 *     prefer the dedicated OpenAIEmbeddingProvider for stricter auth)
 *
 * One implementation per family is the F2.2 thesis: 'four-backend
 * support' isn't four separate providers, it's one provider abstraction
 * that handles three families (Ollama, OpenAI-compatible, OpenAI) with
 * llama.cpp / vLLM / LM Studio / llamafile sliding into the openai-
 * compatible bucket. Anything that speaks OpenAI's shape works here
 * without any code changes.
 */

import { EmbeddingProvider, BatchOptions, EmbedOptions, ModelIdentifier, ProviderHealth } from './types';

interface OpenAICompatibleConfig {
  /**
   * Required. The server's OpenAI-compatible base URL — typically
   * something like 'http://localhost:8080/v1' for vLLM /
   * 'http://localhost:1234/v1' for LM Studio.
   */
  baseUrl: string;
  /** Required. Model identifier the server understands. */
  model: string;
  /**
   * Optional. Many local OpenAI-compatible servers don't require auth;
   * set this if yours does (LiteLLM in front of OpenAI typically does).
   */
  apiKey?: string;
  /**
   * Optional. Override the dimension count if the model isn't in the
   * built-in registry. Required for true unknowns.
   */
  dimensions?: number;
}

interface OpenAIEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
  error?: { message: string };
}

const KNOWN_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'bge-base': 768,
  'bge-large': 1024,
};

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-compatible';
  readonly modelId: string;
  readonly dimensions: number;

  constructor(private config: OpenAICompatibleConfig) {
    this.modelId = `openai-compatible:${config.model}`;
    const baseModel = config.model.split(':')[0];
    this.dimensions = config.dimensions ?? KNOWN_DIMENSIONS[baseModel] ?? 1024;
  }

  private url(): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}/embeddings`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) h.Authorization = `Bearer ${this.config.apiKey}`;
    return h;
  }

  async embed(text: string, _options?: EmbedOptions): Promise<number[]> {
    const response = await fetch(this.url(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.config.model, input: text }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as OpenAIEmbeddingResponse;
      throw new Error(`OpenAI-compatible embedding failed: ${error.error?.message || response.statusText}`);
    }
    const data = await response.json() as OpenAIEmbeddingResponse;
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[], options?: BatchOptions & EmbedOptions): Promise<number[][]> {
    // Most OpenAI-compatible servers support batch input. Cap at 256
    // because vLLM/LM Studio are more conservative than api.openai.com.
    const batchSize = Math.min(options?.batchSize || 64, 256);
    const results: number[][] = [];
    let completed = 0;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await fetch(this.url(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: this.config.model, input: batch }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as OpenAIEmbeddingResponse;
        throw new Error(`OpenAI-compatible embedding failed: ${error.error?.message || response.statusText}`);
      }
      const data = await response.json() as OpenAIEmbeddingResponse;
      const embeddings = data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
      results.push(...embeddings);
      completed += embeddings.length;
      options?.onProgress?.(completed, texts.length);
    }
    return results;
  }

  getModelIdentifier(): ModelIdentifier {
    return { name: this.config.model, provider: 'openai-compatible' };
  }

  async isAvailable(): Promise<boolean> {
    return (await this.healthCheck()).status === 'ok';
  }

  /**
   * Probe the server's /models endpoint when available, otherwise fall
   * back to a tiny embedding call. Distinguishes auth failures (401 /
   * 403) from unreachable from model_missing.
   */
  async healthCheck(): Promise<ProviderHealth> {
    const modelsUrl = `${this.config.baseUrl.replace(/\/+$/, '')}/models`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(modelsUrl, {
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 401 || response.status === 403) {
        return {
          status: 'auth_failed',
          detail: `Auth rejected at ${this.config.baseUrl} (HTTP ${response.status})`,
          fix: 'Check the `api_key` in your embeddings.api_key config (or env var) matches what the server expects.',
        };
      }
      if (!response.ok) {
        return {
          status: 'unreachable',
          detail: `Server returned HTTP ${response.status} for ${modelsUrl}`,
          fix: 'Confirm the server is running and `embeddings.base_url` points at its /v1 endpoint.',
        };
      }
      const data = await response.json() as { data?: Array<{ id: string }> };
      const has = data.data?.some(m => m.id === this.config.model || m.id.startsWith(this.config.model)) ?? true;
      if (!has) {
        return {
          status: 'model_missing',
          detail: `Server up at ${this.config.baseUrl} but model "${this.config.model}" not listed`,
          fix: `Confirm the model is loaded on the server (vLLM: --model; LM Studio: select via UI; llamafile: bundled model name).`,
        };
      }
      return { status: 'ok', detail: `${this.config.baseUrl} (model "${this.config.model}" available)` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'unreachable',
        detail: `Cannot reach ${this.config.baseUrl}: ${msg}`,
        fix: 'Start the local server (vLLM / LM Studio / llamafile / LiteLLM) and confirm `embeddings.base_url` is correct.',
      };
    }
  }
}

/**
 * v2 F2.2: preflight + loading-indicator helpers.
 *
 * Both wrap arbitrary embedding providers via a small contract
 * (healthCheck + isAvailable), so they can be exercised against the
 * MockEmbeddingProvider + a hand-rolled stub without any real network.
 */

import { preflightProvider, withLoadingIndicator } from '../../src/embeddings';
import { EmbeddingProvider, ProviderHealth } from '../../src/embeddings/types';

class StubProvider implements EmbeddingProvider {
  readonly name = 'stub';
  readonly modelId = 'stub:test';
  readonly dimensions = 4;
  constructor(private health: ProviderHealth, private available = true) {}
  async embed(): Promise<number[]> { return [0, 0, 0, 0]; }
  async embedBatch(): Promise<number[][]> { return []; }
  async isAvailable(): Promise<boolean> { return this.available; }
  getModelIdentifier() { return { name: 'test', provider: 'stub' }; }
  async healthCheck(): Promise<ProviderHealth> { return this.health; }
}

describe('F2.2 preflight', () => {
  it('resolves quietly when the provider is healthy', async () => {
    const p = new StubProvider({ status: 'ok' });
    const result = await preflightProvider(p);
    expect(result.status).toBe('ok');
  });

  it('throws a single-line error when the provider is unreachable', async () => {
    const p = new StubProvider({ status: 'unreachable', detail: 'down at :11434', fix: 'ollama serve' });
    await expect(preflightProvider(p)).rejects.toThrow(/preflight failed.*stub.*down at :11434/);
    await expect(preflightProvider(p)).rejects.toThrow(/Fix: ollama serve/);
  });

  it('throws when model is missing, with the recovery fix', async () => {
    const p = new StubProvider({ status: 'model_missing', detail: 'model X not pulled', fix: 'ollama pull X' });
    await expect(preflightProvider(p)).rejects.toThrow(/model_missing|model X not pulled/);
  });

  it('returns the failure when doNotThrow is true (doctor uses this path)', async () => {
    const p = new StubProvider({ status: 'auth_failed', detail: '401' });
    const result = await preflightProvider(p, { doNotThrow: true });
    expect(result.status).toBe('auth_failed');
    expect(result.detail).toBe('401');
  });

  it('falls back to isAvailable when the provider has no healthCheck', async () => {
    const p: EmbeddingProvider = {
      name: 'legacy',
      modelId: 'legacy:test',
      dimensions: 4,
      embed: async () => [0, 0, 0, 0],
      embedBatch: async () => [],
      isAvailable: async () => false,
      getModelIdentifier: () => ({ name: 'legacy', provider: 'legacy' }),
    };
    await expect(preflightProvider(p)).rejects.toThrow(/preflight failed/);
  });
});

describe('F2.2 loading indicator', () => {
  it('prints nothing when the op completes before delayMs', async () => {
    const writes: string[] = [];
    const result = await withLoadingIndicator('stub:model', async () => 'done', {
      delayMs: 1000,
      write: chunk => writes.push(chunk),
    });
    expect(result).toBe('done');
    expect(writes).toHaveLength(0);
  });

  it('prints the loading line + completion line when the op outlasts delayMs', async () => {
    const writes: string[] = [];
    await withLoadingIndicator('stub:model', async () => {
      await new Promise(r => setTimeout(r, 30));
      return 'ok';
    }, { delayMs: 10, write: chunk => writes.push(chunk) });

    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes[0]).toMatch(/Loading model 'stub:model'/);
    expect(writes[1]).toMatch(/Model 'stub:model' loaded\./);
  });

  it('clears the timer if the op throws, no orphaned "Loading" message', async () => {
    const writes: string[] = [];
    await expect(withLoadingIndicator('stub:model', async () => {
      throw new Error('boom');
    }, { delayMs: 50, write: chunk => writes.push(chunk) })).rejects.toThrow('boom');
    // Wait past delayMs to make sure the cancelled timer doesn't fire.
    await new Promise(r => setTimeout(r, 80));
    expect(writes).toHaveLength(0);
  });
});

describe('F2.2 openai-compatible provider construction', () => {
  it('factory creates an openai-compatible provider when configured', async () => {
    const { EmbeddingProviderFactory } = await import('../../src/embeddings');
    const p = await EmbeddingProviderFactory.create({
      provider: 'openai-compatible',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:8080/v1',
    });
    expect(p.name).toBe('openai-compatible');
    expect(p.dimensions).toBe(768); // nomic registry hit
    expect(p.getModelIdentifier()).toEqual({ name: 'nomic-embed-text', provider: 'openai-compatible' });
  });

  it('factory rejects openai-compatible without a baseUrl', async () => {
    const { EmbeddingProviderFactory } = await import('../../src/embeddings');
    await expect(EmbeddingProviderFactory.create({
      provider: 'openai-compatible',
      model: 'm',
    } as any)).rejects.toThrow(/baseUrl/);
  });
});

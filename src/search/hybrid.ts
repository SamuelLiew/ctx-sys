import * as path from 'path';
import { ConfigManager } from '../config';
import { DatabaseConnection } from '../db/connection';
import { EntityStore } from '../entities';
import { EmbeddingManager } from '../embeddings/manager';
import { OllamaEmbeddingProvider } from '../embeddings/ollama';

export interface SearchHybridOptions {
  project?: string;
  db?: string;
  limit?: number;
  type?: string;
  threshold?: number;
}

export async function searchHybrid(query: string, options: SearchHybridOptions = {}): Promise<any[]> {
  const projectPath = path.resolve(options.project || '.');
  const configManager = new ConfigManager();
  const config = await configManager.resolve(projectPath);

  const dbPath = options.db || config.database.path;
  const db = new DatabaseConnection(dbPath);
  await db.initialize();

  try {
    const projectId = config.projectConfig.project.name || path.basename(projectPath);
    const entityStore = new EntityStore(db, projectId);
    const limit = options.limit ? Number(options.limit) : 10;
    const threshold = options.threshold !== undefined ? Number(options.threshold) : 0.3;

    try {
      const ollamaProvider = await OllamaEmbeddingProvider.create({
        baseUrl: config.providers?.ollama?.base_url || 'http://localhost:11434',
        model: config.defaults?.embeddings?.model || 'all-minilm'
      });
      const embeddingManager = new EmbeddingManager(db, projectId, ollamaProvider);
      const similar = await embeddingManager.findSimilar(query, {
        limit,
        threshold,
        entityTypes: options.type ? [options.type] : undefined
      });

      const results = [];
      for (const result of similar) {
        const entity = await entityStore.get(result.entityId);
        if (entity) {
          results.push({ entity, score: result.score });
        }
      }

      if (results.length > 0) {
        return results;
      }
    } catch {
      // Fall back to keyword search if vector search fails
    }

    const keywordResults = entityStore.searchWithScores(query, {
      limit,
      type: options.type as any
    });
    return keywordResults;
  } finally {
    db.close();
  }
}

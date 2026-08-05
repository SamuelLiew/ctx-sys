import * as path from 'path';
import { ConfigManager } from '../config';
import { AppContext } from '../context';

export interface SearchHybridOptions {
  project?: string;
  db?: string;
  limit?: number;
  type?: string;
  threshold?: number;
  appContext?: AppContext;
}

export async function searchHybrid(query: string, options: SearchHybridOptions = {}): Promise<any[]> {
  const projectPath = path.resolve(options.project || '.');
  const configManager = new ConfigManager();
  const config = await configManager.resolve(projectPath);

  const dbPath = options.db || config.database.path;

  const ownsContext = !options.appContext;
  const appContext = options.appContext || new AppContext(dbPath);
  if (ownsContext) {
    await appContext.initialize();
  }

  try {
    const projectId = config.projectConfig.project.name || path.basename(projectPath);
    const entityStore = appContext.getEntityStore(projectId);
    const limit = options.limit ? Number(options.limit) : 10;
    const threshold = options.threshold !== undefined ? Number(options.threshold) : 0.3;

    try {
      const embeddingManager = await appContext.getEmbeddingManager(projectId, config.projectConfig);
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
    if (ownsContext) {
      await appContext.close();
    }
  }
}

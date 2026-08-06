import * as path from 'path';
import { ConfigManager } from '../config';
import { AppContext } from '../context';
import { CoreService } from '../services/core-service';

export interface AssembleContextOptions {
  project?: string;
  db?: string;
  tokens?: number;
  maxTokens?: number;
  type?: string;
  sources?: boolean;
  expand?: boolean;
  appContext?: AppContext;
}

export async function assembleContext(query: string, options: AssembleContextOptions = {}): Promise<any> {
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
    const coreService = new CoreService(appContext);

    const maxTokens = options.tokens || options.maxTokens || 4000;
    const includeTypes = options.type ? options.type.split(',').map(t => t.trim()) : undefined;

    const result = await coreService.queryContext(projectId, query, {
      maxTokens,
      includeTypes,
      includeSources: options.sources !== false,
      expand: options.expand
    });

    return result;
  } finally {
    if (ownsContext) {
      await appContext.close();
    }
  }
}

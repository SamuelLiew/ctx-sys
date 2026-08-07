/**
 * CLI command for searching the index.
 */

import { Command } from 'commander';
import * as path from 'path';
import { ConfigManager } from '../config';
import { DatabaseConnection } from '../db/connection';
import { EntityStore, Entity, EntityType } from '../entities';
import { EmbeddingManager } from '../embeddings/manager';
import { LocalEmbeddingProvider } from '../embeddings';
import { CLIOutput, defaultOutput } from './init';

/**
 * Search result for CLI display.
 */
interface SearchResultItem {
  entity: Entity;
  score: number;
}

/**
 * Create the search command.
 */
export function createSearchCommand(output: CLIOutput = defaultOutput): Command {
  const command = new Command('search')
    .description('Search the indexed codebase')
    .argument('<query>', 'Search query')
    .option('-p, --project <path>', 'Project directory', '.')
    .option('-l, --limit <n>', 'Maximum number of results', '10')
    .option('-t, --type <type>', 'Filter by entity type (function, class, file, etc.)')
    .option('--no-semantic', 'Keyword search only (no embeddings)')
    .option('--threshold <n>', 'Minimum similarity score for semantic search', '0.3')
    .option('--format <format>', 'Output format (text, json)', 'text')
    .option('-d, --db <path>', 'Custom database path')
    .addHelpText('after', `
Examples:
  ctx-sys search "auth middleware"          # hybrid: vector + keyword
  ctx-sys search "TODO" --no-semantic       # keyword-only
  ctx-sys search "logger" --type function   # filter by entity type
  ctx-sys search "..." --format json        # machine-readable output

See also:
  ctx-sys context "..."  # assembled context with source attribution
`)
    .action(async (query: string, options) => {
      try {
        const projectPath = path.resolve(options.project);
        await runSearch(query, projectPath, options, output);
      } catch (error) {
        output.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}

/**
 * Run the search operation.
 */
async function runSearch(
  query: string,
  projectPath: string,
  options: {
    limit?: string;
    type?: string;
    semantic?: boolean;
    threshold?: string;
    format?: string;
    db?: string;
    quiet?: boolean;
  },
  output: CLIOutput
): Promise<void> {
  const configManager = new ConfigManager();
  const config = await configManager.resolve(projectPath);

  // Set up database connection
  const dbPath = options.db || config.database.path;
  const db = new DatabaseConnection(dbPath);
  await db.initialize();

  try {
    // Set up entity store with project ID
    const projectId = config.projectConfig.project.name || path.basename(projectPath);
    const entityStore = new EntityStore(db, projectId);

    const limit = parseInt(options.limit || '10', 10);
    let results: SearchResultItem[];

    const useSemantic = options.semantic !== false;

    if (useSemantic) {
      // Vector similarity search using embeddings (default: on)
      try {
        const localProvider = await LocalEmbeddingProvider.create({
          baseUrl: '',
          model: config.defaults?.embeddings?.model || 'mxbai-embed-large'
        });
        const embeddingManager = new EmbeddingManager(db, projectId, localProvider);

        const threshold = parseFloat(options.threshold || '0.3');
        let similar;

        similar = await embeddingManager.findSimilar(query, {
          limit,
          threshold,
          entityTypes: options.type ? [options.type] : undefined
        });

        // Resolve entities for each result
        results = [];
        for (const result of similar) {
          const entity = await entityStore.get(result.entityId);
          if (entity) {
            results.push({ entity, score: result.score });
          }
        }
      } catch (err) {
        // Graceful fallback to keyword search if Ollama unavailable
        if (!options.quiet) {
          output.log(`Semantic search unavailable, falling back to keyword search`);
          output.log(`  (${err instanceof Error ? err.message : String(err)})\n`);
        }
        results = entityStore.searchWithScores(query, {
          limit,
          type: options.type as EntityType | undefined
        });
      }
    } else {
      // Keyword search only (--no-semantic)
      results = entityStore.searchWithScores(query, {
        limit,
        type: options.type as EntityType | undefined
      });
    }

    // Format output
    switch (options.format) {
      case 'json':
        outputJson(results, output);
        break;
      case 'text':
      default:
        outputText(results, query, output);
        break;
    }
  } finally {
    db.close();
  }
}

/**
 * Output results as plain text.
 */
function outputText(
  results: SearchResultItem[],
  query: string,
  output: CLIOutput
): void {
  if (results.length === 0) {
    output.log('No results found.');
    return;
  }

  output.log(`Found ${results.length} results for "${query}":\n`);

  for (let i = 0; i < results.length; i++) {
    const { entity, score } = results[i];
    const scorePercent = (score * 100).toFixed(1);

    output.log(`${i + 1}. ${entity.name} (${entity.type}) - ${scorePercent}% relevance`);
    output.log(`   ${entity.qualifiedName}`);

    if (entity.content) {
      const preview = entity.content.slice(0, 100).replace(/\n/g, ' ');
      output.log(`   ${preview}${entity.content.length > 100 ? '...' : ''}`);
    }

    if (entity.metadata?.filePath) {
      const metadata = entity.metadata as Record<string, unknown>;
      output.log(`   File: ${metadata.filePath}:${metadata.startLine || 0}`);
    }

    output.log('');
  }
}

/**
 * Output results as JSON.
 */
function outputJson(
  results: SearchResultItem[],
  output: CLIOutput
): void {
  const jsonOutput = results.map(({ entity, score }) => ({
    name: entity.name,
    type: entity.type,
    qualifiedName: entity.qualifiedName,
    score,
    content: entity.content,
    metadata: entity.metadata
  }));

  output.log(JSON.stringify(jsonOutput, null, 2));
}

/**
 * Export for testing.
 */
export { runSearch };

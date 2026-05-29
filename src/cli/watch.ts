/**
 * CLI command for watching and auto-reindexing.
 */

import { Command } from 'commander';
import * as path from 'path';
import { ConfigManager } from '../config';
import { DatabaseConnection } from '../db/connection';
import { EntityStore } from '../entities';
import { RelationshipStore } from '../graph/relationship-store';
import { CodebaseIndexer } from '../indexer';
import { isGitWorktree } from '../indexer/git-sync';
import { DocumentIndexer, PROSE_DOC_EXTENSIONS } from '../documents/document-indexer';
import { FileWatcher, WatchEvent } from '../watch';
import { CLIOutput, defaultOutput } from './init';

/**
 * Create the watch command.
 */
export function createWatchCommand(output: CLIOutput = defaultOutput): Command {
  const command = new Command('watch')
    .description('Watch for file changes and auto-reindex')
    .argument('[directory]', 'Project directory to watch', '.')
    .option('-d, --db <path>', 'Custom database path')
    .option('--debounce <ms>', 'Debounce delay in milliseconds', '300')
    .option('--include <patterns>', 'Comma-separated glob patterns to include')
    .option('--exclude <patterns>', 'Comma-separated glob patterns to exclude')
    .option('-q, --quiet', 'Suppress event output', false)
    .addHelpText('after', `
Examples:
  ctx-sys watch                          # follow the cwd
  ctx-sys watch ../other-project
  ctx-sys watch --include "src/**" --debounce 500

Respects indexing.content: watches code, docs, or both, routing each
changed file to the right indexer. Refuses to run inside a git worktree
(those share the main index) and excludes .yaao/ worktree churn.

Limitation: watches filesystem changes only. \`git checkout\` /
\`git pull\` / \`git rebase\` are NOT picked up by the file watcher
because git changes many files atomically; the git_hooks (default on)
call \`ctx-sys index --git-sync\` to cover that case.
`)
    .action(async (directory: string, options) => {
      try {
        const projectPath = path.resolve(directory);
        await runWatch(projectPath, options, output);
      } catch (error) {
        output.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}

/**
 * Run the watch operation.
 */
async function runWatch(
  projectPath: string,
  options: {
    db?: string;
    debounce?: string;
    include?: string;
    exclude?: string;
    quiet?: boolean;
  },
  output: CLIOutput
): Promise<void> {
  const configManager = new ConfigManager();
  const config = await configManager.resolve(projectPath);

  // Worktree gate: refuse inside a git worktree (worktrees share the main
  // index — e.g. yaao's per-task worktrees). Non-git dirs are fine to watch.
  if (isGitWorktree(projectPath)) {
    output.error('`watch` runs only in the main checkout, not a git worktree (worktrees share the main index). Run it from the main repository.');
    return;
  }

  const indexing = config.projectConfig.indexing;
  const content = indexing.content ?? 'both';

  // Set up database connection
  const dbPath = options.db || config.database.path;
  const db = new DatabaseConnection(dbPath);
  await db.initialize();

  // Set up stores + content-aware indexers (mirrors `index`/`--git-sync`).
  const projectId = config.projectConfig.project.name || path.basename(projectPath);
  const entityStore = new EntityStore(db, projectId);
  const relationshipStore = new RelationshipStore(db, projectId);
  const codeIndexer = content !== 'docs' ? new CodebaseIndexer(projectPath, entityStore) : undefined;
  const docIndexer = content !== 'code' ? new DocumentIndexer(entityStore, relationshipStore) : undefined;
  const docExtensions =
    content === 'code'
      ? []
      : indexing.doc_extensions ??
        (content === 'docs' ? PROSE_DOC_EXTENSIONS : DocumentIndexer.getSupportedExtensions());

  // Always keep yaao's worktree churn out of the main index — watch has no
  // worktree gate for *nested* dirs, only for the root it's invoked in.
  const baseExclude = options.exclude
    ? options.exclude.split(',').map(s => s.trim())
    : (config.projectConfig.indexing.ignore ?? []);
  const exclude = Array.from(new Set([...baseExclude, '.yaao', '.yaao/**']));

  // Create watcher
  const watcher = new FileWatcher(
    {
      root: projectPath,
      debounceMs: parseInt(options.debounce || '300', 10),
      include: options.include ? options.include.split(',').map(s => s.trim()) : ['**/*'],
      exclude,
      docExtensions
    },
    codeIndexer,
    docIndexer
  );

  // Set up event handlers
  watcher.on('ready', () => {
    output.success(`Watching ${projectPath} for changes...`);
    output.log('Press Ctrl+C to stop.');
    output.log('');
  });

  watcher.on('change', (event: WatchEvent) => {
    if (!options.quiet) {
      const icon = event.type === 'add' ? '+' : event.type === 'unlink' ? '-' : '~';
      output.log(`[${icon}] ${event.path}`);
    }
  });

  watcher.on('reindex', (result: { added: string[]; modified: string[]; deleted: string[] }) => {
    if (!options.quiet) {
      const total = result.added.length + result.modified.length + result.deleted.length;
      if (total > 0) {
        output.success(`Reindexed ${total} file(s)`);
      }
    }
  });

  watcher.on('error', (error: any) => {
    output.error(error.message || String(error));
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    output.log('');
    output.log('Stopping watcher...');
    watcher.stop();
    await db.close();
    output.success('Done.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start watching
  await watcher.start();

  // Keep process running
  await new Promise(() => {}); // Never resolves
}

/**
 * Export for testing.
 */
export { runWatch };

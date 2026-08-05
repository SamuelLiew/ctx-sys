/**
 * CLI command for indexing a codebase.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { CodebaseIndexer, IndexOptions, IndexResult } from '../indexer';
import { runGitSync } from '../indexer/git-sync';
import { writeGitHooks, removeGitHooks } from './init-git-hooks';
import { ConfigManager } from '../config';
import { DatabaseConnection } from '../db/connection';
import { ProjectManager } from '../project';
import { EntityStore } from '../entities';
import { RelationshipStore } from '../graph/relationship-store';
import { EmbeddingManager } from '../embeddings/manager';
import { LocalEmbeddingProvider } from '../embeddings/ollama';
import { preflightProvider, withLoadingIndicator } from '../embeddings';
import { DocumentIndexer, PROSE_DOC_EXTENSIONS } from '../documents/document-indexer';
import { InvalidInputError } from '../errors';
import { CLIOutput, defaultOutput } from './init';

type IndexContent = 'both' | 'code' | 'docs';

/**
 * Create the index command.
 */
export function createIndexCommand(output: CLIOutput = defaultOutput): Command {
  const command = new Command('index')
    .description('Index a codebase for context retrieval')
    .argument('[directory]', 'Project directory to index', '.')
    .option('-f, --force', 'Force reindex all files', false)
    .option('--full', 'Perform a full index (not incremental)', false)
    .option('--concurrency <n>', 'Number of concurrent files to process', '5')
    .option('--include <patterns>', 'Comma-separated glob patterns to include')
    .option('--exclude <patterns>', 'Comma-separated glob patterns to exclude')
    .option('-q, --quiet', 'Suppress progress output', false)
    .option('-d, --db <path>', 'Custom database path')
    .option('--no-doc', 'Skip documentation indexing (alias for --content code)')
    .option('--content <mode>', "What to index: 'both' (default), 'code', or 'docs' (documentation only)")
    .option('--doc-path <path>', 'Index specific doc file or directory')
    .option('--no-embed', 'Skip embedding generation')
    .option('--embed-batch-size <n>', 'Batch size for embedding generation', '50')
    .option('--use-gitignore', 'v2 F1.1: layer .gitignore on top of .ctxignore (default off)')
    .option('--no-ctxignore', 'v2 F1.1: skip .ctxignore for this run')
    .option('--git-sync', 'v2: re-index only files changed since the last indexed commit (diff-driven; respects indexing.content)', false)
    .option('--from-git-hook', 'v2: invoked from a git hook (silent; never fails the git operation)', false)
    .option('--threshold <n>', 'v2: with --git-sync, files-changed count above which we fall through to a full re-index', '200')
    .addHelpText('after', `
Examples:
  ctx-sys index                        # incremental update of the current dir
  ctx-sys index --force                # re-index from scratch
  ctx-sys index --no-embed --no-doc    # AST entities only (skip embeddings + docs)
  ctx-sys index --content docs         # documentation only (skip code indexing)
  ctx-sys index --include "src/**"     # only walk a subset
  ctx-sys index --use-gitignore        # also respect .gitignore patterns
  ctx-sys index --git-sync             # diff-driven re-sync since last indexed commit (also runs from git hooks)

See also:
  ctx-sys context "..."   # query the index
`)
    .action(async (directory: string, options) => {
      try {
        const projectPath = path.resolve(directory);
        if (options.gitSync) {
          await runGitSync(projectPath, options, output);
        } else {
          await runIndex(projectPath, options, output);
        }
      } catch (error) {
        // From a git hook we must never fail the user's git operation; errors
        // land in the log the hook redirects to.
        if (options.fromGitHook) {
          process.exit(0);
        }
        output.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}

/**
 * Run the indexing operation.
 */
async function runIndex(
  projectPath: string,
  options: {
    force?: boolean;
    full?: boolean;
    concurrency?: string;
    include?: string;
    exclude?: string;
    quiet?: boolean;
    db?: string;
    doc?: boolean;
    content?: string;
    docPath?: string;
    embed?: boolean;
    embedBatchSize?: string;
    useGitignore?: boolean;
    ctxignore?: boolean;
  },
  output: CLIOutput
): Promise<void> {
  const configManager = new ConfigManager();
  const config = await configManager.resolve(projectPath);

  // v2: reconcile git hooks to match indexing.git_hooks (declarative). `index`
  // is the command users run anyway, so hook state follows config without a
  // separate step. Only ctx-sys-managed hooks are touched; non-git dirs skip.
  if (fs.existsSync(path.join(projectPath, '.git'))) {
    const wantHooks = (config.projectConfig.indexing as { git_hooks?: boolean }).git_hooks !== false;
    const capture: CLIOutput = { log: () => {}, error: (m) => output.error(m), success: () => {} };
    if (wantHooks) {
      const res = writeGitHooks(projectPath, capture, {});
      if (!options.quiet && res.written.length > 0) {
        output.success(`Installed ${res.written.length} git hook(s) (indexing.git_hooks: true).`);
      }
      if (!options.quiet) {
        for (const w of res.warnings) output.log(`  git-hook: ${w.reason}`);
      }
    } else {
      const res = removeGitHooks(projectPath, capture);
      if (!options.quiet && res.removed.length > 0) {
        output.log(`Removed ${res.removed.length} ctx-sys git hook(s) (indexing.git_hooks: false).`);
      }
    }
  }

  // Set up database connection
  const dbPath = options.db || config.database.path;
  const db = new DatabaseConnection(dbPath);
  await db.initialize();

  try {
    // Set up entity store (use project name as ID)
    const projectId = config.projectConfig.project.name || path.basename(projectPath);

    // Ensure project is registered and tables exist
    const projectManager = new ProjectManager(db);
    const existingProject = await projectManager.getByName(projectId);
    if (!existingProject) {
      try {
        await projectManager.create(projectId, projectPath);
      } catch {
        db.createProject(projectId);  // fallback if name validation fails
      }
    }

    const entityStore = new EntityStore(db, projectId);
    const relationshipStore = new RelationshipStore(db, projectId);

    // v2: resolve what to index. --content wins; --no-doc is back-compat for
    // 'code'; otherwise fall back to indexing.content config (default 'both').
    const cfgIndexing = config.projectConfig.indexing as {
      use_gitignore?: boolean;
      use_ctxignore?: boolean;
      ignore?: string[];
      content?: IndexContent;
      doc_extensions?: string[];
    };
    let content: IndexContent;
    if (options.content !== undefined) {
      if (options.content !== 'both' && options.content !== 'code' && options.content !== 'docs') {
        throw new InvalidInputError(
          `--content must be 'both', 'code', or 'docs' (got '${options.content}')`,
          "Pass one of: --content both | --content code | --content docs.",
        );
      }
      content = options.content;
    } else if (options.doc === false) {
      content = 'code';
    } else {
      content = cfgIndexing.content ?? 'both';
    }

    // Index code (AST entities + relationships) unless we're in docs-only mode.
    if (content !== 'docs') {
      // Create indexer with relationship extraction
      const indexer = new CodebaseIndexer(projectPath, entityStore, undefined, undefined, relationshipStore);

      // Build index options. v2 F1.1: useGitignore / useCtxignore come
      // from CLI flags first, then project config, then sensible defaults
      // (.gitignore off, .ctxignore on).
      const indexOptions: IndexOptions = {
        force: options.force,
        concurrency: parseInt(options.concurrency || '5', 10),
        include: options.include ? options.include.split(',').map(s => s.trim()) : undefined,
        exclude: options.exclude
          ? options.exclude.split(',').map(s => s.trim())
          : config.projectConfig.indexing.ignore,
        useGitignore: options.useGitignore ?? cfgIndexing.use_gitignore ?? false,
        useCtxignore: options.ctxignore ?? cfgIndexing.use_ctxignore ?? true,
      };

      // Add progress callback if not quiet
      if (!options.quiet) {
        let lastPercent = -1;
        indexOptions.onProgress = (current: number, total: number, file: string) => {
          const percent = Math.floor((current / total) * 100);
          if (percent !== lastPercent && percent % 10 === 0) {
            output.log(`Progress: ${percent}% (${current}/${total}) - ${path.basename(file)}`);
            lastPercent = percent;
          }
        };
      }

      // Run indexing
      const startTime = Date.now();
      if (!options.quiet) {
        output.log(`Indexing ${projectPath}...`);
      }

      let result: IndexResult;
      if (options.full) {
        result = await indexer.indexAll(indexOptions);
      } else {
        result = await indexer.updateIndex(indexOptions);
      }

      // Display results
      const duration = (Date.now() - startTime) / 1000;

      if (!options.quiet) {
        output.log('');
        output.success(`Indexing complete in ${duration.toFixed(2)}s`);
        output.log(`  Added: ${result.added.length} files`);
        output.log(`  Modified: ${result.modified.length} files`);
        output.log(`  Deleted: ${result.deleted.length} files`);
        output.log(`  Unchanged: ${result.unchanged.length} files`);

        if (result.errors.length > 0) {
          output.log(`  Errors: ${result.errors.length}`);
          for (const err of result.errors.slice(0, 5)) {
            output.error(`    ${err.path}: ${err.error}`);
          }
          if (result.errors.length > 5) {
            output.log(`    ... and ${result.errors.length - 5} more errors`);
          }
        }

        output.log('');
        output.log('Statistics:');
        output.log(`  Total files: ${result.stats.totalFiles}`);
        output.log(`  Total symbols: ${result.stats.totalSymbols}`);
        if (result.stats.byLanguage) {
          output.log('  By language:');
          for (const [lang, count] of Object.entries(result.stats.byLanguage)) {
            output.log(`    ${lang}: ${count}`);
          }
        }
      }

      // Explicit save after indexing (before potentially slow embedding phase)
      db.save();
    } else if (!options.quiet) {
      output.log('Documentation-only mode (indexing.content: docs) — skipping code indexing.');
    }

    // Index documentation files (skipped when content === 'code' / --no-doc).
    if (content !== 'code') {
      const docIndexer = new DocumentIndexer(entityStore, relationshipStore);

      // Which extensions count as documentation. Explicit config wins; else
      // 'docs' mode narrows to prose, while 'both' keeps the full document set.
      const docExtensions =
        cfgIndexing.doc_extensions ?? (content === 'docs' ? PROSE_DOC_EXTENSIONS : undefined);
      const dirOptions = {
        ...(docExtensions ? { extensions: docExtensions } : {}),
        ...(cfgIndexing.ignore ? { exclude: cfgIndexing.ignore } : {}),
      };

      if (options.docPath) {
        // Index specific file or directory
        const absoluteDocPath = path.resolve(options.docPath);
        const stat = fs.statSync(absoluteDocPath);

        if (!options.quiet) {
          output.log('');
          output.log(`Indexing document: ${absoluteDocPath}`);
        }

        if (stat.isDirectory()) {
          const docResult = await docIndexer.indexDirectory(absoluteDocPath, dirOptions);
          db.save();
          if (!options.quiet) {
            output.success(`Documentation indexed: ${docResult.filesProcessed} files (${docResult.filesSkipped} unchanged)`);
            output.log(`  Entities: ${docResult.totalEntities}, Relationships: ${docResult.totalRelationships}`);
          }
        } else {
          const docResult = await docIndexer.indexFile(absoluteDocPath);
          db.save();
          if (!options.quiet) {
            if (docResult.skipped) {
              output.log('Document unchanged, skipped.');
            } else {
              output.success(`Document indexed: ${docResult.entitiesCreated} entities, ${docResult.relationshipsCreated} relationships`);
            }
          }
        }
      } else {
        // Index all docs in project directory
        if (!options.quiet) {
          output.log('');
          output.log('Indexing documentation files...');
        }

        const docResult = await docIndexer.indexDirectory(projectPath, dirOptions);
        db.save();

        if (!options.quiet) {
          output.success(`Documentation indexed: ${docResult.filesProcessed} files (${docResult.filesSkipped} unchanged)`);
          output.log(`  Entities: ${docResult.totalEntities}, Relationships: ${docResult.totalRelationships}`);
          if (docResult.errors.length > 0) {
            output.log(`  Errors: ${docResult.errors.length}`);
            for (const err of docResult.errors.slice(0, 3)) {
              output.error(`    ${err}`);
            }
          }
        }
      }
    }

    // Generate embeddings (default: on, --no-embed to skip)
    if (options.embed !== false) {
      if (!options.quiet) {
        output.log('');
        output.log('Generating embeddings...');
      }

      try {
        const localProvider = await LocalEmbeddingProvider.create({
          baseUrl: '',
          model: config.defaults?.embeddings?.model || 'all-MiniLM-L6-v2'
        });

        // v2 F2.2: preflight before the work starts. Fail fast with a
        // clean message instead of a deep stack trace from the first
        // real embed call.
        await preflightProvider(localProvider);

        const embeddingManager = new EmbeddingManager(db, projectId, localProvider);

        const batchSize = parseInt(options.embedBatchSize || '50', 10);
        let totalEmbedded = 0;
        let totalSkipped = 0;
        let totalProcessed = 0;
        let totalErrors = 0;
        let firstBatch = true;

        for (const page of entityStore.listPaginated({ pageSize: 500 })) {
          // v2 F2.2: wrap the first batch with a 'Loading model'
          // indicator. Subsequent batches don't pay the model-load
          // cost so suppress the message.
          const runBatch = () => embeddingManager.embedIncremental(page, {
            batchSize,
            onProgress: (completed, _total, skipped) => {
              if (!options.quiet && completed % batchSize === 0) {
                output.log(`  Progress: ${totalProcessed + completed} embedded (${totalSkipped + skipped} unchanged)`);
              }
            }
          });
          const pageResult = firstBatch
            ? await withLoadingIndicator(localProvider.modelId, runBatch)
            : await runBatch();
          firstBatch = false;
          totalEmbedded += pageResult.embedded;
          totalSkipped += pageResult.skipped;
          totalProcessed += pageResult.total;
          totalErrors += pageResult.errors || 0;
        }

        if (!options.quiet) {
          let msg = `Embedded ${totalEmbedded}, skipped ${totalSkipped} unchanged`;
          if (totalErrors) {
            msg += `, ${totalErrors} failed`;
          }
          msg += ` (${totalProcessed} total)`;
          output.success(msg);
        }
      } catch (err) {
        output.error(`Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
        output.log('  Make sure Ollama is running: ollama serve');
      }
    }
  } finally {
    db.close();
  }
}

/**
 * Export for testing.
 */
export { runIndex };

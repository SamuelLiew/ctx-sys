/**
 * v2 F2.0: `ctx-sys reindex` — keep the index in sync with the working
 * tree across git operations the file watcher misses (checkout, pull,
 * rebase, am).
 *
 * Invoked automatically by the post-checkout/merge/rewrite/applypatch
 * hooks installed by `ctx-sys init`, and manually by users who want a
 * one-shot refresh.
 *
 * Behavior:
 *   - Computes `git diff --name-only <last-sha>..HEAD` against the SHA
 *     stored on the project row (last_sync_commit).
 *   - Empty diff → no-op.
 *   - Small diff (≤ THRESHOLD changed files, default 200) → re-index
 *     just those files via the existing incremental updateIndex path.
 *   - Large diff → mark the project stale (a follow-up commit will
 *     surface this in search/context output) and run a full re-index.
 *   - Updates last_sync_commit on success.
 */

import { execSync } from 'node:child_process';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import { ConfigManager } from '../config';
import { DatabaseConnection } from '../db/connection';
import { CodebaseIndexer } from '../indexer';
import { CLIOutput, defaultOutput } from './init';

const DEFAULT_THRESHOLD_FILES = 200;

function safeExec(cmd: string, cwd: string): string | undefined {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
}

function isMainCheckout(projectPath: string): boolean {
  const commonDir = safeExec('git rev-parse --git-common-dir', projectPath);
  const gitDir = safeExec('git rev-parse --git-dir', projectPath);
  if (!commonDir || !gitDir) return false;
  // git rev-parse may return relative paths; resolve before compare.
  const resolveRel = (p: string) =>
    path.isAbsolute(p) ? path.resolve(p) : path.resolve(projectPath, p);
  return resolveRel(commonDir) === resolveRel(gitDir);
}

export function createReindexCommand(output: CLIOutput = defaultOutput): Command {
  return new Command('reindex')
    .description('v2 F2.0: re-sync the ctx-sys index with the working tree after git ops')
    .argument('[directory]', 'Project directory', '.')
    .option('--from-git-hook', 'Invoked from a git hook (alters error/output mode)', false)
    .option('--full', 'Skip the diff path and re-index the whole tree', false)
    .option('--threshold <n>', 'Files-changed threshold above which we fall through to full re-index', String(DEFAULT_THRESHOLD_FILES))
    .option('-d, --db <path>', 'Custom database path')
    .action(async (directory: string, options) => {
      try {
        const projectPath = path.resolve(directory);
        await runReindex(projectPath, options, output);
      } catch (err) {
        if (options.fromGitHook) {
          // Hook context: never fail the user's git op. Errors land in
          // the log the hook script appends to.
          process.exit(0);
        }
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

interface ReindexOptions {
  fromGitHook?: boolean;
  full?: boolean;
  threshold?: string;
  db?: string;
}

export async function runReindex(
  projectPath: string,
  options: ReindexOptions,
  output: CLIOutput,
): Promise<void> {
  // Worktree gate. F2.0 spec: only the main checkout drives reindex.
  if (!isMainCheckout(projectPath)) {
    if (!options.fromGitHook) {
      output.log('Not the main checkout (worktree or non-git path); skipping reindex.');
    }
    return;
  }

  const head = safeExec('git rev-parse HEAD', projectPath);
  if (!head) {
    if (!options.fromGitHook) output.log('Cannot resolve HEAD; skipping reindex.');
    return;
  }

  const cfg = await new ConfigManager().resolve(projectPath);
  const dbPath = options.db ?? cfg.database.path;
  const projectId = cfg.projectConfig.project.name || path.basename(projectPath);

  const db = new DatabaseConnection(dbPath);
  await db.initialize();
  try {
    interface ProjectRow { id: string; last_sync_commit: string | null }
    const row = db.get<ProjectRow>(`SELECT id, last_sync_commit FROM projects WHERE id = ? OR name = ?`, [projectId, projectId]);
    const lastSha = row?.last_sync_commit ?? undefined;

    if (lastSha === head && !options.full) {
      if (!options.fromGitHook) output.log(`Index already at ${head.slice(0, 7)}; nothing to do.`);
      return;
    }

    let changedFiles: string[] = [];
    if (lastSha && !options.full) {
      const raw = safeExec(`git diff --name-only ${lastSha}..${head}`, projectPath);
      if (raw) {
        changedFiles = raw
          .split('\n')
          .map(s => s.trim())
          .filter(s => s.length > 0)
          .filter(s => fs.existsSync(path.join(projectPath, s)));
      }
      if (!options.fromGitHook) {
        output.log(`Diff ${lastSha.slice(0, 7)}..${head.slice(0, 7)}: ${changedFiles.length} changed file(s).`);
      }
    }

    const threshold = options.threshold ? parseInt(options.threshold, 10) : DEFAULT_THRESHOLD_FILES;
    const goingFull = options.full || !lastSha || changedFiles.length > threshold;

    const indexer = new CodebaseIndexer(projectPath, undefined as any); // entityStore filled by indexer constructor
    if (goingFull) {
      if (!options.fromGitHook) {
        output.log(lastSha
          ? `Large or first reindex (${changedFiles.length} > ${threshold} or full=true) — running full updateIndex.`
          : 'No prior index head SHA recorded — running full updateIndex.');
      }
      await indexer.updateIndex({});
    } else if (changedFiles.length === 0) {
      // last_sync_commit existed but the diff produced nothing
      // (e.g. only mode-only changes git filtered out). Update the
      // head pointer below and return.
    } else {
      if (!options.fromGitHook) output.log(`Incremental reindex of ${changedFiles.length} file(s).`);
      // updateIndex re-walks the tree and incrementally hashes each
      // file; running it scoped to changed files is the cheap path.
      // include patterns make the walker only revisit those paths.
      await indexer.updateIndex({ include: changedFiles });
    }

    db.run(
      `UPDATE projects SET last_sync_commit = ?, last_indexed_at = CURRENT_TIMESTAMP WHERE id = ? OR name = ?`,
      [head, projectId, projectId],
    );

    if (!options.fromGitHook) {
      output.success(`Reindex complete. Index at ${head.slice(0, 7)}.`);
    }
  } finally {
    await db.close();
  }
}

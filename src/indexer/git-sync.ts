/**
 * v2: git-aware incremental sync — `ctx-sys index --git-sync`.
 *
 * Keeps the index in step with the working tree across git operations the
 * file watcher misses (checkout, pull, rebase, am). Invoked automatically by
 * the post-checkout/merge/rewrite/applypatch hooks installed per
 * `indexing.git_hooks`, and manually by users who want a one-shot refresh.
 *
 * Diffs `last_sync_commit..HEAD` and re-indexes the changed files, honouring
 * `indexing.content`: code via CodebaseIndexer, documentation via
 * DocumentIndexer (prose by default in 'docs' mode, or `indexing.doc_extensions`).
 *
 *   - Empty diff / already at HEAD → no-op.
 *   - Small diff (≤ threshold changed files, default 200) → re-index just
 *     those files.
 *   - Large diff / no prior SHA / --full → full re-index of the active pipelines.
 *   - Updates last_sync_commit on success.
 */

import { execSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';

import { ConfigManager } from '../config';
import { DatabaseConnection } from '../db/connection';
import { CodebaseIndexer } from './indexer';
import { DocumentIndexer, PROSE_DOC_EXTENSIONS } from '../documents/document-indexer';
import { EntityStore } from '../entities';
import { RelationshipStore } from '../graph/relationship-store';
import { CLIOutput } from '../cli/init';

const DEFAULT_THRESHOLD_FILES = 200;

export function safeExec(cmd: string, cwd: string): string | undefined {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
}

/**
 * True only for the main checkout. Worktrees share `.git/hooks/` with the main
 * checkout, so a hook firing inside a yaao per-task worktree must not drive the
 * main index. Used by both git-sync and `watch`.
 */
export function isMainCheckout(projectPath: string): boolean {
  const commonDir = safeExec('git rev-parse --git-common-dir', projectPath);
  const gitDir = safeExec('git rev-parse --git-dir', projectPath);
  if (!commonDir || !gitDir) return false;
  const resolveRel = (p: string) =>
    path.isAbsolute(p) ? path.resolve(p) : path.resolve(projectPath, p);
  return resolveRel(commonDir) === resolveRel(gitDir);
}

export interface GitSyncOptions {
  fromGitHook?: boolean;
  full?: boolean;
  threshold?: string;
  db?: string;
}

function hasExt(file: string, extensions: string[]): boolean {
  const ext = path.extname(file).toLowerCase();
  return extensions.includes(ext);
}

export async function runGitSync(
  projectPath: string,
  options: GitSyncOptions,
  output: CLIOutput,
): Promise<void> {
  // Worktree gate: only the main checkout drives git-sync.
  if (!isMainCheckout(projectPath)) {
    if (!options.fromGitHook) {
      output.log('Not the main checkout (worktree or non-git path); skipping git-sync.');
    }
    return;
  }

  const head = safeExec('git rev-parse HEAD', projectPath);
  if (!head) {
    if (!options.fromGitHook) output.log('Cannot resolve HEAD; skipping git-sync.');
    return;
  }

  const cfg = await new ConfigManager().resolve(projectPath);
  const indexing = cfg.projectConfig.indexing;
  const content = indexing.content ?? 'both';
  const dbPath = options.db ?? cfg.database.path;
  const projectId = cfg.projectConfig.project.name || path.basename(projectPath);

  // Which extensions count as docs (mirrors index-cmd): explicit config wins;
  // else 'docs' narrows to prose, 'both' keeps the full document set.
  const docExtensions =
    indexing.doc_extensions ??
    (content === 'docs' ? PROSE_DOC_EXTENSIONS : DocumentIndexer.getSupportedExtensions());

  const db = new DatabaseConnection(dbPath);
  await db.initialize();
  try {
    interface ProjectRow { id: string; last_sync_commit: string | null }
    const row = db.get<ProjectRow>(
      `SELECT id, last_sync_commit FROM projects WHERE id = ? OR name = ?`,
      [projectId, projectId],
    );
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
    if (goingFull && !options.fromGitHook) {
      output.log(lastSha
        ? `Large or first git-sync (${changedFiles.length} > ${threshold} or full=true) — running full re-index.`
        : 'No prior index head SHA recorded — running full re-index.');
    }

    const entityStore = new EntityStore(db, projectId);
    const relationshipStore = new RelationshipStore(db, projectId);

    // Code pipeline (skipped in docs-only mode).
    if (content !== 'docs') {
      const indexer = new CodebaseIndexer(projectPath, entityStore, undefined, undefined, relationshipStore);
      if (goingFull) {
        await indexer.updateIndex({});
      } else if (changedFiles.length > 0) {
        await indexer.updateIndex({ include: changedFiles });
      }
    }

    // Documentation pipeline (skipped in code-only mode).
    if (content !== 'code') {
      const docIndexer = new DocumentIndexer(entityStore, relationshipStore);
      if (goingFull) {
        await docIndexer.indexDirectory(projectPath, {
          extensions: docExtensions,
          ...(indexing.ignore ? { exclude: indexing.ignore } : {}),
        });
      } else {
        const docFiles = changedFiles.filter(f => hasExt(f, docExtensions));
        for (const f of docFiles) {
          await docIndexer.indexFile(path.join(projectPath, f));
        }
      }
    }

    db.run(
      `UPDATE projects SET last_sync_commit = ?, last_indexed_at = CURRENT_TIMESTAMP WHERE id = ? OR name = ?`,
      [head, projectId, projectId],
    );

    if (!options.fromGitHook) {
      output.success(`git-sync complete. Index at ${head.slice(0, 7)}.`);
    }
  } finally {
    await db.close();
  }
}

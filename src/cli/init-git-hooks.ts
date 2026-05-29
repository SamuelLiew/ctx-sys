/**
 * v2 F2.0: install git hooks that keep the ctx-sys index in sync with
 * the working tree.
 *
 *   post-checkout / post-merge / post-rewrite / post-applypatch
 *     → ctx-sys reindex --from-git-hook
 *
 * Worktree-aware: each hook checks `git rev-parse --git-common-dir` /
 * `.git` so a hook firing inside `.yaao/worktrees/<run>/<task>/` is a
 * no-op. yaao runs its agents in worktrees that share `.git/hooks/`
 * with the main checkout; without the gate the hooks would hammer the
 * main checkout's index from every per-task run.
 *
 * Idempotency mirrors the F1.6 init --mcp semantics:
 *   - File absent → write the F2.0 managed script.
 *   - File present, ctx-sys marker + matching body → no-op.
 *   - File present, ctx-sys marker + non-matching body → leave alone
 *     with a warning unless --force.
 *   - File present, NOT ours → leave it alone with a warning telling
 *     the user how to add the one-line invocation themselves. Don't
 *     append silently — clobbering a user's hook is a foot-gun.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { CLIOutput } from './init';

const HOOKS = ['post-checkout', 'post-merge', 'post-rewrite', 'post-applypatch'] as const;
type HookName = typeof HOOKS[number];

const MARKER = '# ctx-sys managed';

export interface GitHookOptions {
  /** Replace a non-matching managed hook. */
  force?: boolean;
}

export interface GitHookResult {
  written: string[];
  unchanged: string[];
  warnings: Array<{ path: string; reason: string }>;
  skipped: Array<{ path: string; reason: string }>;
}

/** Build the F2.0 managed script body for a single hook. */
function hookScript(hookName: HookName): string {
  return [
    '#!/bin/sh',
    MARKER,
    `# v2 F2.0: keep ctx-sys index in sync with working tree (${hookName})`,
    '# Worktree gate: only the main checkout drives reindex.',
    'common_dir=$(git rev-parse --git-common-dir 2>/dev/null)',
    'git_dir=$(git rev-parse --git-dir 2>/dev/null)',
    'if [ -z "$common_dir" ] || [ -z "$git_dir" ]; then',
    '  exit 0',
    'fi',
    'if [ "$common_dir" != "$git_dir" ]; then',
    '  # We are in a worktree; let the main checkout handle reindex.',
    '  exit 0',
    'fi',
    '# Background, fire-and-forget. Errors land in .ctx-sys/reindex.log',
    '# so an interactive git op never gets noisy.',
    'mkdir -p .ctx-sys',
    '( ctx-sys index --git-sync --from-git-hook >>.ctx-sys/reindex.log 2>&1 ) &',
    'exit 0',
    '',
  ].join('\n');
}

function isManagedByUs(body: string): boolean {
  return body.includes(MARKER);
}

function writeHook(
  hooksDir: string,
  name: HookName,
  options: GitHookOptions,
  result: GitHookResult,
): void {
  const target = path.join(hooksDir, name);
  const desired = hookScript(name);

  if (!fs.existsSync(target)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(target, desired, { mode: 0o755 });
    result.written.push(target);
    return;
  }

  const body = fs.readFileSync(target, 'utf-8');

  if (!isManagedByUs(body)) {
    result.warnings.push({
      path: target,
      reason: `existing ${name} hook is not ctx-sys-managed — leaving alone. To wire ctx-sys in, add a line: 'ctx-sys reindex --from-git-hook &'.`,
    });
    return;
  }

  if (body === desired) {
    result.unchanged.push(target);
    return;
  }

  if (!options.force) {
    result.warnings.push({
      path: target,
      reason: `ctx-sys-managed ${name} hook differs from the F2.0 default — not overwriting. Re-run with --git-hooks --force to replace.`,
    });
    return;
  }

  fs.writeFileSync(target, desired, { mode: 0o755 });
  result.written.push(target);
}

/**
 * Install (or update) the four F2.0 git hooks under <projectPath>/.git/hooks.
 * Skips entirely if the project isn't a git repo (init handles that case
 * elsewhere with a notice).
 */
export function writeGitHooks(
  projectPath: string,
  output: CLIOutput,
  options: GitHookOptions = {},
  // Test seam: override hooks dir so tests don't need a real .git/.
  hooksDirOverride?: string,
): GitHookResult {
  const result: GitHookResult = { written: [], unchanged: [], warnings: [], skipped: [] };

  let hooksDir = hooksDirOverride ?? path.join(projectPath, '.git', 'hooks');
  if (!hooksDirOverride) {
    // Real init: bail when there's no .git/ at all.
    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) {
      result.skipped.push({ path: gitDir, reason: 'not a git repo — skipping hook install' });
      output.log('  not a git repo; skipping git-hook install (run `ctx-sys init --git-hooks` after `git init` to add them later)');
      return result;
    }
    // Bare repo (no working tree) — `.git/hooks/` doesn't make sense.
    if (fs.statSync(gitDir).isFile()) {
      // Worktree pointer file; resolve to common dir's hooks dir.
      // Not a typical init scenario; skip with a notice.
      result.skipped.push({ path: gitDir, reason: '.git is a worktree pointer; skipping hook install' });
      output.log('  detected git worktree pointer; skipping hook install (main checkout drives reindex)');
      return result;
    }
  }

  for (const name of HOOKS) {
    writeHook(hooksDir, name, options, result);
  }

  for (const w of result.written) output.success(`Wrote git hook ${path.basename(w)} to ${w}`);
  for (const u of result.unchanged) output.log(`  git hook already current at ${u}`);
  for (const warning of result.warnings) output.log(`  warning: ${warning.reason} (${warning.path})`);

  return result;
}

export const __testing = { HOOKS, MARKER, hookScript };

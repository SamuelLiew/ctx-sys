/**
 * v2 F2.0: `ctx-sys reindex` is a no-op when invoked from a git
 * worktree. Worktrees share `.git/hooks/` with the main checkout, so
 * a hook firing inside a yaao per-task worktree would otherwise hammer
 * the main checkout's index.
 *
 * Builds a real worktree via the git CLI so the rev-parse gate is
 * exercised end-to-end.
 */

import { execSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runReindex } from '../../src/cli/reindex';

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'pipe' });
}

describe('F2.0 reindex worktree gate', () => {
  let tmp: string;
  let main: string;
  let worktree: string;
  const out = { logs: [] as string[], err: [] as string[] };
  const output = {
    log: (m: string) => out.logs.push(m),
    error: (m: string) => out.err.push(m),
    success: (m: string) => out.logs.push(`✓ ${m}`),
  };

  beforeAll(() => {
    // Ensure git is available — if not, skip silently rather than fail.
    try {
      execSync('git --version', { stdio: 'pipe' });
    } catch {
      console.warn('git unavailable; F2.0 worktree gate test will be a no-op');
    }
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f20-wt-'));
    main = path.join(tmp, 'main');
    worktree = path.join(tmp, 'worktree');
    fs.mkdirSync(main, { recursive: true });

    sh('git init -q -b main', main);
    sh('git config user.email "t@t"', main);
    sh('git config user.name "t"', main);
    fs.writeFileSync(path.join(main, 'README.md'), '# initial\n');
    sh('git add README.md', main);
    sh('git commit -q -m "init"', main);
    sh(`git worktree add -q -b feature ${worktree}`, main);

    out.logs.length = 0;
    out.err.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reindex invoked inside a worktree is a no-op (does not touch the main index)', async () => {
    await runReindex(worktree, { fromGitHook: false }, output);

    expect(out.err).toHaveLength(0);
    // The user-facing log line confirms the gate fired.
    expect(out.logs.some(l => l.toLowerCase().includes('worktree') || l.toLowerCase().includes('not the main'))).toBe(true);
  });

  it('--from-git-hook mode in a worktree is fully silent (hook context)', async () => {
    await runReindex(worktree, { fromGitHook: true }, output);

    expect(out.err).toHaveLength(0);
    // Hook context: no user-facing chatter.
    expect(out.logs).toHaveLength(0);
  });
});

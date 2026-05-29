/**
 * v2: `ctx-sys index` reconciles git hooks to match indexing.git_hooks —
 * installs them when true, removes the ctx-sys-managed ones when false.
 */

import { execSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runIndex } from '../../src/cli/index-cmd';
import { CLIOutput } from '../../src/cli/init';

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'pipe' });
}

describe('index git-hook reconciliation', () => {
  let repo: string;
  let dbPath: string;
  const silent: CLIOutput = { log: () => {}, error: () => {}, success: () => {} };

  beforeAll(() => {
    try { execSync('git --version', { stdio: 'pipe' }); } catch {
      console.warn('git unavailable; reconcile test will be a no-op');
    }
  });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-hooks-reconcile-'));
    dbPath = path.join(repo, 'index.db');
    sh('git init -q -b main', repo);
    sh('git config user.email "t@t"', repo);
    sh('git config user.name "t"', repo);
    fs.writeFileSync(path.join(repo, 'README.md'), '# Project\n\nDocs.\n');
    fs.mkdirSync(path.join(repo, '.ctx-sys'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  function writeConfig(gitHooks: boolean): void {
    fs.writeFileSync(
      path.join(repo, '.ctx-sys', 'config.yaml'),
      `project:\n  name: reconcile-test\nindexing:\n  git_hooks: ${gitHooks}\n`,
    );
  }

  const hookPath = (name: string) => path.join(repo, '.git', 'hooks', name);

  it('installs hooks when indexing.git_hooks is true', async () => {
    writeConfig(true);
    await runIndex(repo, { embed: false, quiet: true, db: dbPath, full: true }, silent);
    expect(fs.existsSync(hookPath('post-merge'))).toBe(true);
    expect(fs.readFileSync(hookPath('post-checkout'), 'utf-8')).toContain('ctx-sys index --git-sync --from-git-hook');
  });

  it('removes ctx-sys-managed hooks when indexing.git_hooks is false', async () => {
    writeConfig(true);
    await runIndex(repo, { embed: false, quiet: true, db: dbPath, full: true }, silent);
    expect(fs.existsSync(hookPath('post-merge'))).toBe(true);

    writeConfig(false);
    await runIndex(repo, { embed: false, quiet: true, db: dbPath, full: true }, silent);
    for (const h of ['post-checkout', 'post-merge', 'post-rewrite', 'post-applypatch']) {
      expect(fs.existsSync(hookPath(h))).toBe(false);
    }
  });
});

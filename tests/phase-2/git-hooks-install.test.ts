/**
 * v2 F2.0: writeGitHooks installs post-checkout/merge/rewrite/applypatch
 * hooks with the F2.0 managed marker, leaves user hooks alone with a
 * warning, and honors idempotency / --force semantics matching F1.6.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeGitHooks, removeGitHooks, __testing } from '../../src/cli/init-git-hooks';

describe('F2.0 writeGitHooks', () => {
  let tmp: string;
  let hooksDir: string;
  const silentOutput = { log: () => {}, error: () => {}, success: () => {} };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f20-hooks-'));
    hooksDir = path.join(tmp, 'hooks');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function readHook(name: typeof __testing.HOOKS[number]): string {
    return fs.readFileSync(path.join(hooksDir, name), 'utf-8');
  }

  it('writes all four F2.0 hooks with the managed marker + worktree gate', () => {
    const result = writeGitHooks(tmp, silentOutput, {}, hooksDir);

    expect(result.written).toHaveLength(4);
    for (const hook of __testing.HOOKS) {
      const body = readHook(hook);
      expect(body).toContain(__testing.MARKER);
      expect(body).toContain('git rev-parse --git-common-dir');
      expect(body).toContain('ctx-sys index --git-sync --from-git-hook');
      // shebang + exec bit
      expect(body.startsWith('#!/bin/sh')).toBe(true);
      expect(fs.statSync(path.join(hooksDir, hook)).mode & 0o111).not.toBe(0);
    }
  });

  it('idempotent: re-running with matching hooks is a no-op (no mtime bump)', async () => {
    writeGitHooks(tmp, silentOutput, {}, hooksDir);
    const target = path.join(hooksDir, 'post-checkout');
    const firstMtime = fs.statSync(target).mtimeMs;
    await new Promise(r => setTimeout(r, 10));

    const second = writeGitHooks(tmp, silentOutput, {}, hooksDir);

    expect(second.warnings).toHaveLength(0);
    expect(second.unchanged).toContain(target);
    expect(fs.statSync(target).mtimeMs).toBe(firstMtime);
  });

  it('leaves a user-managed hook alone with a warning', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const target = path.join(hooksDir, 'post-merge');
    fs.writeFileSync(target, '#!/bin/sh\n# user-managed\necho hi\n', { mode: 0o755 });

    const result = writeGitHooks(tmp, silentOutput, {}, hooksDir);

    expect(result.warnings.some(w => w.path === target)).toBe(true);
    expect(result.written).not.toContain(target);
    expect(fs.readFileSync(target, 'utf-8')).toContain('# user-managed');
  });

  it('ctx-sys-managed hook differing from current default warns without --force', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const target = path.join(hooksDir, 'post-rewrite');
    fs.writeFileSync(target, `#!/bin/sh\n${__testing.MARKER}\n# old\nctx-sys index --git-sync --from-git-hook\n`, { mode: 0o755 });

    const result = writeGitHooks(tmp, silentOutput, {}, hooksDir);

    expect(result.warnings.some(w => w.path === target)).toBe(true);
    expect(result.written).not.toContain(target);
  });

  it('--force replaces a non-matching ctx-sys-managed hook', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const target = path.join(hooksDir, 'post-applypatch');
    fs.writeFileSync(target, `#!/bin/sh\n${__testing.MARKER}\n# old\n`, { mode: 0o755 });

    const result = writeGitHooks(tmp, silentOutput, { force: true }, hooksDir);

    expect(result.written).toContain(target);
    const body = fs.readFileSync(target, 'utf-8');
    expect(body).toContain(__testing.MARKER);
    expect(body).toContain('ctx-sys index --git-sync --from-git-hook');
    expect(body).not.toContain('# old');
  });

  it('skips with a notice when the project has no .git', () => {
    // No override → real path; ensure no .git/ exists.
    const result = writeGitHooks(tmp, silentOutput, {});
    expect(result.skipped.some(s => s.reason.includes('not a git repo'))).toBe(true);
    expect(result.written).toHaveLength(0);
  });
});

describe('v2 removeGitHooks', () => {
  let tmp: string;
  let hooksDir: string;
  const silentOutput = { log: () => {}, error: () => {}, success: () => {} };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-rm-hooks-'));
    hooksDir = path.join(tmp, 'hooks');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('removes the four ctx-sys-managed hooks', () => {
    writeGitHooks(tmp, silentOutput, {}, hooksDir);
    const result = removeGitHooks(tmp, silentOutput, hooksDir);
    expect(result.removed).toHaveLength(4);
    for (const hook of __testing.HOOKS) {
      expect(fs.existsSync(path.join(hooksDir, hook))).toBe(false);
    }
  });

  it('leaves a user-authored hook untouched', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const target = path.join(hooksDir, 'post-merge');
    fs.writeFileSync(target, '#!/bin/sh\n# user-managed\necho hi\n', { mode: 0o755 });

    const result = removeGitHooks(tmp, silentOutput, hooksDir);

    expect(result.removed).not.toContain(target);
    expect(result.skipped.some(s => s.path === target)).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toContain('# user-managed');
  });

  it('is a no-op when the hooks dir does not exist', () => {
    const result = removeGitHooks(tmp, silentOutput, hooksDir);
    expect(result.removed).toHaveLength(0);
  });
});

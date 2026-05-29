/**
 * v2 F1.1: .ctxignore is seeded by `ctx-sys init` and .gitignore is no
 * longer read by default.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IgnoreResolver } from '../../src/indexer/ignore-resolver';
import { writeCtxignore, SEED_CTXIGNORE } from '../../src/cli/init';

describe('F1.1 ignore-file defaults', () => {
  let tmp: string;
  const silentOutput = { log: () => {}, error: () => {}, success: () => {} };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f11-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('IgnoreResolver', () => {
    it('does not read .gitignore by default', () => {
      // .gitignore says ignore "src" — but it should be inert under the
      // new defaults.
      fs.writeFileSync(path.join(tmp, '.gitignore'), 'src\n');
      const resolver = new IgnoreResolver(tmp);
      expect(resolver.isIgnored('src/app.ts')).toBe(false);
    });

    it('honors .ctxignore by default', () => {
      fs.writeFileSync(path.join(tmp, '.ctxignore'), 'private/\n');
      const resolver = new IgnoreResolver(tmp);
      expect(resolver.isIgnored('private/secrets.ts')).toBe(true);
    });

    it('opt-in: useGitignore=true still layers .gitignore patterns', () => {
      fs.writeFileSync(path.join(tmp, '.gitignore'), 'generated/\n');
      const resolver = new IgnoreResolver(tmp, { useGitignore: true });
      expect(resolver.isIgnored('generated/api.ts')).toBe(true);
    });

    it('opt-out: useCtxignore=false skips .ctxignore', () => {
      fs.writeFileSync(path.join(tmp, '.ctxignore'), 'docs/\n');
      const resolver = new IgnoreResolver(tmp, { useCtxignore: false });
      expect(resolver.isIgnored('docs/readme.md')).toBe(false);
    });
  });

  describe('writeCtxignore (the helper init.ts uses)', () => {
    it('writes the F1.1 seed when no .ctxignore exists', () => {
      writeCtxignore(tmp, {}, silentOutput);

      const target = path.join(tmp, '.ctxignore');
      expect(fs.existsSync(target)).toBe(true);
      const body = fs.readFileSync(target, 'utf-8');
      // Spot-check a few patterns from the F1.1 seed.
      expect(body).toContain('# .ctxignore');
      expect(body).toContain('dist/');
      expect(body).toContain('.ctx-sys/');
      expect(body).toContain('.yaao/');
      expect(body).toContain('.env');
      expect(body).toEqual(SEED_CTXIGNORE);
    });

    it('leaves an existing .ctxignore untouched without force', () => {
      const target = path.join(tmp, '.ctxignore');
      fs.writeFileSync(target, '# user-managed\nmy-secrets/\n');

      writeCtxignore(tmp, {}, silentOutput);

      const body = fs.readFileSync(target, 'utf-8');
      expect(body).toContain('# user-managed');
      expect(body).toContain('my-secrets/');
      expect(body).not.toContain('# .ctxignore — patterns');
    });

    it('force overwrites the existing .ctxignore', () => {
      const target = path.join(tmp, '.ctxignore');
      fs.writeFileSync(target, '# stale\n');

      writeCtxignore(tmp, { force: true }, silentOutput);

      const body = fs.readFileSync(target, 'utf-8');
      expect(body).toContain('# .ctxignore — patterns');
      expect(body).not.toContain('# stale');
    });

    it('ignoreFile=false suppresses creation', () => {
      writeCtxignore(tmp, { ignoreFile: false }, silentOutput);
      expect(fs.existsSync(path.join(tmp, '.ctxignore'))).toBe(false);
    });
  });
});

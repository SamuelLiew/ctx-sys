/**
 * v2 F2.2: native-module checks added to `ctx-sys doctor`. The three
 * additions cover the silent-degradation cases F2.1's
 * SQLITE_VEC_UNAVAILABLE error documents.
 */

import {
  checkBetterSqlite3,
  checkSqliteVec,
  checkNodeVersion,
} from '../../src/cli/doctor';

describe('F2.2 doctor native-module checks', () => {
  it('checkBetterSqlite3 reports OK with a SQLite version on a healthy install', async () => {
    const r = await checkBetterSqlite3();
    expect(r.name).toBe('better-sqlite3');
    expect(r.status).toBe('ok');
    expect(r.detail).toMatch(/SQLite \d/);
  });

  it('checkSqliteVec reports OK or WARN — never FAIL', async () => {
    const r = await checkSqliteVec();
    expect(r.name).toBe('sqlite-vec');
    expect(['ok', 'warn']).toContain(r.status);
    if (r.status === 'warn') {
      // WARN must carry a fix pointing at the recovery path so users
      // know the impact (FTS-only fallback) and the install retry.
      expect(r.fix).toBeTruthy();
      expect(r.fix!).toMatch(/reinstall|sqlite-vec/i);
    }
  });

  it('checkNodeVersion reports OK against engines.node when current Node satisfies it', () => {
    const r = checkNodeVersion();
    expect(r.name).toBe('Node runtime');
    // Either OK or WARN (no package.json read) — never FAIL on a CI
    // image that itself satisfies the constraint.
    expect(['ok', 'warn']).toContain(r.status);
    expect(r.detail).toMatch(/\d/);
  });
});

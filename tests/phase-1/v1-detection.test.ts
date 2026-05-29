/**
 * v2 F1.0: detect ctx-sys 1.x databases at startup and throw a typed
 * V1DatabaseDetectedError with a clear upgrade-path fix hint, instead of
 * letting the user discover the breakage through cryptic SQL errors on
 * their first `ctx-sys search` after upgrade.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseConnection } from '../../src/db/connection';
import { V1DatabaseDetectedError } from '../../src/errors';

describe('F1.0 v1 database detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-v1-detect-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeV1Fixture(dbPath: string, prefix: string, tableSuffix: string): void {
    // Build a minimal v1-shaped fixture: just enough that sqlite_master
    // contains the prefixed legacy table the detector looks for.
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${prefix}_${tableSuffix} (id TEXT PRIMARY KEY)`);
    db.close();
  }

  it('throws V1DatabaseDetectedError when a v1 sessions table is present', async () => {
    const dbPath = path.join(tmpDir, 'db.sqlite');
    makeV1Fixture(dbPath, 'my_project', 'sessions');

    const conn = new DatabaseConnection(dbPath);
    await expect(conn.initialize()).rejects.toBeInstanceOf(V1DatabaseDetectedError);
  });

  it('the error carries the V1_DATABASE_DETECTED code and a non-empty fix hint', async () => {
    const dbPath = path.join(tmpDir, 'db.sqlite');
    makeV1Fixture(dbPath, 'my_project', 'checkpoints');

    const conn = new DatabaseConnection(dbPath);
    try {
      await conn.initialize();
      throw new Error('initialize() should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(V1DatabaseDetectedError);
      const typed = err as V1DatabaseDetectedError;
      expect(typed.code).toBe('V1_DATABASE_DETECTED');
      expect(typed.fix).toBeTruthy();
      expect(typed.fix!).toMatch(/delete.*\.ctx-sys/i);
      expect(typed.fix!).toMatch(/ctx-sys index/);
    }
  });

  it('detects any of the six removed table suffixes', async () => {
    const suffixes = ['sessions', 'messages', 'decisions', 'checkpoints', 'reflections', 'memory_items'];
    for (const suffix of suffixes) {
      const dbPath = path.join(tmpDir, `db-${suffix}.sqlite`);
      makeV1Fixture(dbPath, 'project', suffix);

      const conn = new DatabaseConnection(dbPath);
      await expect(conn.initialize()).rejects.toBeInstanceOf(V1DatabaseDetectedError);
    }
  });

  it('accepts a fresh (empty) database without throwing', async () => {
    const dbPath = path.join(tmpDir, 'fresh.sqlite');
    const conn = new DatabaseConnection(dbPath);
    await expect(conn.initialize()).resolves.toBeUndefined();
    await conn.close();
  });

  it('accepts a 2.x database that has no legacy tables', async () => {
    // Initialize a clean 2.x DB, then open it again — should not detect
    // anything since v2 doesn't create the removed tables.
    const dbPath = path.join(tmpDir, 'twox.sqlite');
    const first = new DatabaseConnection(dbPath);
    await first.initialize();
    await first.close();

    const second = new DatabaseConnection(dbPath);
    await expect(second.initialize()).resolves.toBeUndefined();
    await second.close();
  });
});

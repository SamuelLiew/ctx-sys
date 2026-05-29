import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runIndex } from '../../src/cli/index-cmd';
import { DatabaseConnection } from '../../src/db/connection';
import { EntityStore } from '../../src/entities';
import { CLIOutput } from '../../src/cli/init';

/**
 * v2: indexing.content / --content modes ('both' | 'code' | 'docs').
 * Verifies docs-only skips code indexing, code-only skips docs, and that
 * docs-only narrows to prose extensions by default (excludes .json).
 */
describe('index --content modes', () => {
  let tempDir: string;
  let dbPath: string;
  const silent: CLIOutput = { log: () => {}, error: () => {}, success: () => {} };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-content-mode-'));
    dbPath = path.join(tempDir, 'index.db');
    fs.writeFileSync(path.join(tempDir, 'app.ts'), 'export function hello(): number {\n  return 1;\n}\n');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Project\n\nSome documentation here.\n');
    fs.writeFileSync(path.join(tempDir, 'data.json'), '{"name": "data", "value": 42}\n');
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  });

  /** Open the on-disk index and return entity counts by type for project 'unnamed' (the default). */
  async function counts(): Promise<{ files: number; documents: number; jsonIndexed: boolean }> {
    const db = new DatabaseConnection(dbPath);
    await db.initialize();
    try {
      const store = new EntityStore(db, 'unnamed');
      return {
        files: store.count('file'),
        documents: store.count('document'),
        jsonIndexed: (await store.getByQualifiedName(path.join(tempDir, 'data.json'))) !== null,
      };
    } finally {
      db.close();
    }
  }

  it("content: 'docs' indexes documentation only and skips code", async () => {
    await runIndex(tempDir, { content: 'docs', embed: false, quiet: true, db: dbPath, full: true }, silent);
    const c = await counts();
    expect(c.files).toBe(0); // no code entities
    expect(c.documents).toBeGreaterThan(0); // README.md indexed
  });

  it("content: 'docs' defaults to prose extensions (excludes .json)", async () => {
    await runIndex(tempDir, { content: 'docs', embed: false, quiet: true, db: dbPath, full: true }, silent);
    expect((await counts()).jsonIndexed).toBe(false);
  });

  it("content: 'code' indexes code only and skips docs", async () => {
    await runIndex(tempDir, { content: 'code', embed: false, quiet: true, db: dbPath, full: true }, silent);
    const c = await counts();
    expect(c.files).toBeGreaterThan(0); // app.ts indexed
    expect(c.documents).toBe(0); // no doc entities
  });

  it("default ('both') indexes code and documents, incl. .json as a document", async () => {
    await runIndex(tempDir, { embed: false, quiet: true, db: dbPath, full: true }, silent);
    const c = await counts();
    expect(c.files).toBeGreaterThan(0);
    expect(c.documents).toBeGreaterThan(0);
    expect(c.jsonIndexed).toBe(true); // full document set in 'both' mode
  });

  it("reads content from indexing.content in .ctx-sys/config.yaml", async () => {
    fs.mkdirSync(path.join(tempDir, '.ctx-sys'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.ctx-sys', 'config.yaml'),
      'project:\n  name: unnamed\nindexing:\n  content: docs\n',
    );
    await runIndex(tempDir, { embed: false, quiet: true, db: dbPath, full: true }, silent);
    const c = await counts();
    expect(c.files).toBe(0);
    expect(c.documents).toBeGreaterThan(0);
  });

  it("rejects an invalid --content value", async () => {
    await expect(
      runIndex(tempDir, { content: 'prose', embed: false, quiet: true, db: dbPath, full: true }, silent),
    ).rejects.toThrow(/must be 'both', 'code', or 'docs'/);
  });
});

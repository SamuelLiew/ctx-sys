import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { GLOBAL_SCHEMA, createProjectTables, dropProjectTables } from './schema';
import { Logger, consoleLogger } from '../utils/logger';
import { V1DatabaseDetectedError } from '../errors';

/** v1 conversational-memory tables removed in v2 F1.0; presence of any of
 *  these is a strong signal the DB is from 1.x and must be re-indexed. */
const V1_LEGACY_TABLES = [
  'sessions',
  'messages',
  'decisions',
  'checkpoints',
  'reflections',
  'memory_items',
] as const;

/**
 * Attempt to load sqlite-vec. Returns null if unavailable (unsupported platform, missing binary).
 * Vector search will be disabled but keyword + graph search still work.
 */
function loadSqliteVec(): typeof import('sqlite-vec') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('sqlite-vec');
  } catch {
    return null;
  }
}

const sqliteVecModule = loadSqliteVec();

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/**
 * Database connection wrapper using better-sqlite3.
 * F10.10: Migrated from sql.js to enable FTS5 and native extensions.
 */
export class DatabaseConnection {
  private db: Database.Database | null = null;
  private dbPath: string;
  private initialized: boolean = false;
  private _vecAvailable: boolean = false;
  private logger: Logger;
  private stmtCache = new Map<string, Database.Statement>();
  private readonly MAX_STMT_CACHE = 200;

  constructor(dbPath: string, options?: { logger?: Logger }) {
    this.dbPath = dbPath;
    this.logger = options?.logger ?? consoleLogger;
  }

  /**
   * Initialize the database connection.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    // v2 F1.0: detect v1 schemas at startup and fail loudly with a
    // typed CtxError pointing at the upgrade path. Without this check,
    // a 1.x → 2.x upgrade would hit cryptic "no such table: sessions"
    // SQL errors on first query. Done before sqlite-vec load and before
    // any schema is applied, so it works against an unmodified v1 DB.
    DatabaseConnection.checkForV1Schema(this.db, this.dbPath);

    // Load sqlite-vec extension for native vector search
    if (sqliteVecModule) {
      try {
        sqliteVecModule.load(this.db);
        this._vecAvailable = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`sqlite-vec failed to load: ${msg}`);
        this.logger.warn('Vector search disabled. Keyword and graph search still work.');
      }
    }

    // Enable foreign keys and WAL mode for better performance
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    // Wait up to 5s for locks instead of failing immediately (multi-process safety)
    this.db.pragma('busy_timeout = 5000');

    this.initialized = true;

    // Create global schema
    this.exec(GLOBAL_SCHEMA);
  }

  /**
   * v2 F1.0: detect ctx-sys 1.x databases at startup. If any per-project
   * table contains a v1-only suffix (`_sessions`, `_messages`,
   * `_decisions`, `_checkpoints`, `_reflections`, `_memory_items`), the
   * caller is upgrading a 1.x project. Throw with a clear fix hint
   * instead of leaving the user to discover the breakage through SQL
   * errors later.
   *
   * Looking for the suffix (not the bare name) because per-project
   * tables are namespaced — see `sanitizeProjectId` + `${prefix}_…`.
   * Static so it can be called before instance state is wired up.
   */
  private static checkForV1Schema(db: Database.Database, dbPath: string): void {
    try {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table','virtual table') AND name LIKE ? ESCAPE '\\'"
        )
        .all('%\\_%') as Array<{ name: string }>;
      const legacy = new Set<string>();
      for (const row of rows) {
        for (const suffix of V1_LEGACY_TABLES) {
          if (row.name.endsWith(`_${suffix}`) || row.name === suffix) {
            legacy.add(suffix);
          }
        }
      }
      if (legacy.size > 0) {
        throw new V1DatabaseDetectedError(dbPath, Array.from(legacy).sort());
      }
    } catch (err) {
      if (err instanceof V1DatabaseDetectedError) throw err;
      // Any other failure (malformed DB, sqlite_master unreadable) is
      // not a v1-detection signal; let the rest of initialize() surface
      // it through the normal error path.
    }
  }

  /**
   * Ensure database is initialized before operations.
   */
  private ensureInitialized(): Database.Database {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Get cached prepared statement or prepare a new one.
   */
  private getStatement(sql: string): Database.Statement {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      const db = this.ensureInitialized();
      stmt = db.prepare(sql);
      if (this.stmtCache.size >= this.MAX_STMT_CACHE) {
        const firstKey = this.stmtCache.keys().next().value;
        if (firstKey) this.stmtCache.delete(firstKey);
      }
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /**
   * Execute a raw SQL script (multiple statements).
   */
  exec(sql: string): void {
    const db = this.ensureInitialized();
    db.exec(sql);
  }

  /**
   * Execute a single SQL statement with parameters.
   */
  run(sql: string, params?: unknown[]): RunResult {
    const stmt = this.getStatement(sql);
    const result = params && params.length > 0 ? stmt.run(...params) : stmt.run();
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  /**
   * Execute a query and return the first row.
   */
  get<T>(sql: string, params?: unknown[]): T | undefined {
    const stmt = this.getStatement(sql);
    const row = params && params.length > 0 ? stmt.get(...params) : stmt.get();
    return row as T | undefined;
  }

  /**
   * Execute a query and return all rows.
   */
  all<T>(sql: string, params?: unknown[]): T[] {
    const stmt = this.getStatement(sql);
    const rows = params && params.length > 0 ? stmt.all(...params) : stmt.all();
    return rows as T[];
  }

  /**
   * Execute a function within a transaction.
   */
  transaction<T>(fn: () => T): T {
    const db = this.ensureInitialized();
    const trx = db.transaction(() => fn());
    return trx();
  }

  /**
   * Create project-specific tables.
   */
  createProject(projectId: string): void {
    this.exec(createProjectTables(projectId));
  }

  /**
   * Drop project-specific tables.
   */
  dropProject(projectId: string): void {
    this.stmtCache.clear();
    this.exec(dropProjectTables(projectId));
  }

  /**
   * Save database to file.
   * With better-sqlite3 in WAL mode, data is auto-persisted.
   * This method triggers a WAL checkpoint for safety.
   */
  save(): void {
    const db = this.ensureInitialized();
    db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db && this.initialized) {
      this.stmtCache.clear();
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Check if the database is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if sqlite-vec (vector search) is available.
   */
  isVecAvailable(): boolean {
    return this._vecAvailable;
  }

  /**
   * Get the database file path.
   */
  getPath(): string {
    return this.dbPath;
  }
}

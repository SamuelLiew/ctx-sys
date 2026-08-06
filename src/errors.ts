/**
 * Structured error classes for ctx-sys.
 * Every error carries a user-facing message, error code, and optional fix suggestion.
 */

export type ErrorCode =
  | 'EMBEDDING_FAILED'
  | 'DATABASE_ERROR'
  | 'DATABASE_LOCKED'
  | 'V1_DATABASE_DETECTED'
  | 'SQLITE_VEC_UNAVAILABLE'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_EXISTS'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_EXISTS'
  | 'INVALID_INPUT'
  | 'FILE_NOT_FOUND'
  | 'PARSE_ERROR'
  | 'PROVIDER_UNAVAILABLE';

/**
 * Base error for all ctx-sys errors.
 */
export class CtxError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly fix?: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = 'CtxError';
  }

  /** Format for CLI output. */
  toUserString(): string {
    let msg = this.message;
    if (this.fix) msg += `\n  Fix: ${this.fix}`;
    return msg;
  }

  /** Format for MCP tool response. */
  toMcpResponse(): { error: string; code: string; fix?: string } {
    return {
      error: this.message,
      code: this.code,
      fix: this.fix,
    };
  }
}

/** A resource (project, entity) was not found. */
export class NotFoundError extends CtxError {
  constructor(resource: string, identifier: string) {
    const isProject = resource === 'Project';
    super(
      `${resource} not found: ${identifier}`,
      isProject ? 'PROJECT_NOT_FOUND' : 'ENTITY_NOT_FOUND',
      // v2 F2.1: every NotFoundError gets a concrete recovery hint.
      isProject
        ? 'Run `ctx-sys init` to initialise this directory, or `ctx-sys project list` to see existing projects.'
        : 'Run `ctx-sys index` if the project hasn\'t been indexed yet, or `ctx-sys entity list` to browse what is indexed.',
    );
    this.name = 'NotFoundError';
  }
}

/** A resource already exists (duplicate name, etc.). */
export class AlreadyExistsError extends CtxError {
  constructor(resource: string, identifier: string) {
    const isProject = resource === 'Project';
    super(
      `${resource} already exists: ${identifier}`,
      isProject ? 'PROJECT_EXISTS' : 'ENTITY_EXISTS',
      // v2 F2.1: explicit fix for both branches.
      isProject
        ? 'Pick a different project name, or delete the existing one with `ctx-sys project delete ' + identifier + '`.'
        : 'Re-run with `--force` to overwrite the existing entity, or pick a different name.',
    );
    this.name = 'AlreadyExistsError';
  }
}

/** Database operation failed. */
export class DatabaseError extends CtxError {
  constructor(operation: string, cause?: Error) {
    const isLocked = cause?.message?.includes('database is locked');
    super(
      isLocked
        ? 'Database is locked — another process may be using it'
        : `Database error during ${operation}: ${cause?.message ?? 'unknown'}`,
      isLocked ? 'DATABASE_LOCKED' : 'DATABASE_ERROR',
      // v2 F2.1: every DATABASE_ERROR variant carries a fix.
      isLocked
        ? 'Close other ctx-sys processes (or `ctx-sys serve` instances), wait a moment, then retry.'
        : 'Check `.ctx-sys/db.sqlite` permissions and free disk, then re-run. Run `ctx-sys status --check` to diagnose.',
      cause,
    );
    this.name = 'DatabaseError';
  }
}

/**
 * Detected at startup when ctx-sys 2.0 opens a database that still
 * carries the v1 conversational-memory tables (sessions, messages,
 * decisions, checkpoints, reflections, memory_items). v2 made the
 * tool-cut and schema-trim breaking — there is no automatic migration.
 */
export class V1DatabaseDetectedError extends CtxError {
  constructor(dbPath: string, foundTables: string[]) {
    super(
      `Database at ${dbPath} is from ctx-sys 1.x (found legacy tables: ${foundTables.join(', ')})`,
      'V1_DATABASE_DETECTED',
      'ctx-sys 2.0 does not migrate v1 data. Delete the .ctx-sys/ directory and run `ctx-sys index` to rebuild against the 2.x schema. Export any session / decision data you want to keep from 1.x BEFORE upgrading.',
    );
    this.name = 'V1DatabaseDetectedError';
  }
}

/** No embedding or summarization provider is available. */
export class ProviderUnavailableError extends CtxError {
  constructor(type: 'embedding' | 'summarization', tried: string[]) {
    super(
      `No ${type} provider available (tried: ${tried.join(', ')})`,
      'PROVIDER_UNAVAILABLE',
      'Ensure the local embedding provider is installed and configured.',
    );
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * v2 F2.1 + F2.2: the sqlite-vec extension failed to load at startup.
 * ctx-sys continues running with FTS-only retrieval (no vector search),
 * but the user needs to know they've lost half the hybrid pipeline.
 * This error type is thrown by code paths that explicitly require
 * vector search (e.g. an `embed run` step where the vec table would
 * be the destination); the connection layer also logs a warning at
 * startup so users see the degradation even when they aren't running
 * a vector-dependent command.
 */
export class SqliteVecUnavailableError extends CtxError {
  constructor(detail?: string) {
    super(
      `Vector search is disabled because the sqlite-vec extension failed to load${detail ? ` (${detail})` : ''}`,
      'SQLITE_VEC_UNAVAILABLE',
      'Reinstall with `npm install -g ctx-sys --force` to refresh native binaries. If your platform is not supported by sqlite-vec prebuilds, retrieval will fall back to FTS5 + graph only.',
    );
    this.name = 'SqliteVecUnavailableError';
  }
}

/** Invalid argument to a CLI command or library entry point. */
export class InvalidInputError extends CtxError {
  constructor(message: string, fix?: string) {
    super(message, 'INVALID_INPUT', fix);
    this.name = 'InvalidInputError';
  }
}

/** A required file is missing. */
export class FileNotFoundError extends CtxError {
  constructor(filePath: string, fix?: string) {
    super(
      `File not found: ${filePath}`,
      'FILE_NOT_FOUND',
      fix ?? `Check the path and re-run. (\`${filePath}\` was not found on disk.)`,
    );
    this.name = 'FileNotFoundError';
  }
}

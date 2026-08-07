/**
 * F10h.1: ctx-sys doctor — Environment health check command.
 * Verifies local embedder, database, config, and project state.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from '../config/manager';
import { DatabaseConnection } from '../db/connection';
import { sanitizeProjectId } from '../db/schema';
import { colors } from './formatters';
import { CLIOutput, defaultOutput } from './init';

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

/**
 * Check local embedding provider availability.
 */
export async function checkLocalEmbedder(): Promise<CheckResult> {
  try {
    const { embed } = await import('../embeddings/local.js');
    const result = await embed(['health check']);
    if (result && result[0] && result[0].length === 1024) {
      return { name: 'Local Embedder', status: 'ok', detail: 'mxbai-embed-large (1024 dims)' };
    }
    return { name: 'Local Embedder', status: 'fail', detail: 'Unexpected embedding output', fix: 'Run: pip install mlx mlx-embeddings kagglehub' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'Local Embedder', status: 'fail', detail: `Failed to load: ${msg}`, fix: 'Run: pip install mlx mlx-embeddings kagglehub' };
  }
}

/**
 * Check database connectivity and stats.
 */
export async function checkDatabase(dbPath: string): Promise<CheckResult> {
  try {
    if (!fs.existsSync(dbPath)) {
      return { name: 'Database', status: 'fail', detail: `Not found at ${dbPath}`, fix: 'ctx-sys index .' };
    }

    const stats = fs.statSync(dbPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);

    const db = new DatabaseConnection(dbPath);
    await db.initialize();
    try {
      const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
      return { name: 'Database', status: 'ok', detail: `${dbPath} (${sizeMB} MB, ${tables.length} tables)` };
    } finally {
      db.close();
    }
  } catch (err) {
    return { name: 'Database', status: 'fail', detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Check configuration files.
 */
export async function checkConfig(projectPath: string): Promise<CheckResult> {
  try {
    const configManager = new ConfigManager({ inMemoryOnly: true });
    const parts: string[] = [];

    const globalExists = await configManager.globalConfigExists();
    if (globalExists) parts.push('global');

    const projectExists = await configManager.projectConfigExists(projectPath);
    if (projectExists) parts.push('project');

    if (parts.length === 0) {
      return { name: 'Configuration', status: 'warn', detail: 'No config files found (using defaults)', fix: 'ctx-sys init' };
    }

    return { name: 'Configuration', status: 'ok', detail: parts.join(' + ') + ' config' };
  } catch (err) {
    return { name: 'Configuration', status: 'warn', detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Check project state (indexed, embedding coverage).
 */
export async function checkProject(dbPath: string, projectPath: string): Promise<CheckResult> {
  try {
    if (!fs.existsSync(dbPath)) {
      return { name: 'Project', status: 'warn', detail: 'No database — run: ctx-sys index .', fix: 'ctx-sys index .' };
    }

    const db = new DatabaseConnection(dbPath);
    await db.initialize();
    try {
      const projectName = path.basename(projectPath);

      // Look up project by name or path in the projects table
      const project = db.get<{ id: string; name: string; last_indexed_at: string | null }>(
        "SELECT id, name, last_indexed_at FROM projects WHERE name = ? OR path = ?",
        [projectName, projectPath]
      );
      if (!project) {
        return { name: 'Project', status: 'warn', detail: `"${projectName}" not indexed`, fix: 'ctx-sys index .' };
      }

      // Use project name for table prefix (CLI creates tables by name, not UUID)
      const prefix = sanitizeProjectId(project.name);

      // Check if entity table exists
      const tableCheck = db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [`${prefix}_entities`]
      );
      if (tableCheck.length === 0) {
        return { name: 'Project', status: 'warn', detail: `"${project.name}" tables missing`, fix: 'ctx-sys index .' };
      }

      // Count entities
      const entityRow = db.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${prefix}_entities`);
      const entities = entityRow?.count ?? 0;

      // Count vectors
      let embeddingPct = 0;
      if (entities > 0) {
        const vectorMetaTable = `${prefix}_vector_meta`;
        const vecMetaExists = db.get<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          [vectorMetaTable]
        );

        if (vecMetaExists) {
          const vecRow = db.get<{ count: number }>(`SELECT COUNT(DISTINCT entity_id) as count FROM ${vectorMetaTable}`);
          embeddingPct = Math.round(((vecRow?.count ?? 0) / entities) * 100);
        }
      }

      // Count relationships
      const relTable = `${prefix}_relationships`;
      const relTableExists = db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [relTable]
      );
      let relCount = 0;
      if (relTableExists.length > 0) {
        const relRow = db.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${relTable}`);
        relCount = relRow?.count ?? 0;
      }

      const detail = `${project.name}: ${entities} entities, ${relCount} relationships, ${embeddingPct}% embedded`;

      if (entities === 0) {
        return { name: 'Project', status: 'warn', detail: `${project.name}: no entities indexed`, fix: 'ctx-sys index .' };
      }
      if (embeddingPct < 50) {
        return { name: 'Project', status: 'warn', detail, fix: 'ctx-sys embed .' };
      }
      return { name: 'Project', status: 'ok', detail };
    } finally {
      db.close();
    }
  } catch (err) {
    return { name: 'Project', status: 'warn', detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Format a check result for display.
 */
/**
 * v2 F2.2: native-module checks.
 *
 * (1) better-sqlite3 loaded: run SELECT sqlite_version() against an
 *     in-memory DB. PASS reports the resolved SQLite version.
 * (2) sqlite-vec extension: PASS when the extension loaded and
 *     vec_version() returns; WARN (not FAIL) otherwise — retrieval
 *     still works, just falls back to FTS5 + graph. This is the
 *     partner check for F2.1's SQLITE_VEC_UNAVAILABLE error.
 * (3) Node version vs engines.node: parses package.json#engines.node
 *     and asserts process.version satisfies the range.
 */
export async function checkBetterSqlite3(): Promise<CheckResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    const row = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    db.close();
    return { name: 'better-sqlite3', status: 'ok', detail: `SQLite ${row.v}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'better-sqlite3',
      status: 'fail',
      detail: `Failed to load: ${msg}`,
      fix: 'Reinstall with `npm install -g ctx-sys --force` to refresh the native binary.',
    };
  }
}

export async function checkSqliteVec(): Promise<CheckResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(db);
      const row = db.prepare('SELECT vec_version() AS v').get() as { v: string };
      db.close();
      return { name: 'sqlite-vec', status: 'ok', detail: `extension ${row.v}` };
    } catch (err) {
      db.close();
      throw err;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'sqlite-vec',
      status: 'warn',
      detail: `extension unavailable (${msg})`,
      fix: 'Retrieval falls back to FTS5 + graph only. Reinstall with `npm install -g ctx-sys --force` or check your platform is supported by sqlite-vec prebuilds.',
    };
  }
}

export function checkNodeVersion(): CheckResult {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { engines?: { node?: string } };
    const engines = pkg.engines?.node;
    const current = process.versions.node;
    if (!engines) {
      return { name: 'Node runtime', status: 'ok', detail: `${current} (no engines constraint)` };
    }
    // Cheap parse of '>=20.0.0' style — pull the first number after '>=' or 'v'.
    const match = /([0-9]+)/.exec(engines);
    const required = match ? parseInt(match[1], 10) : 0;
    const currentMajor = parseInt(current.split('.')[0], 10);
    if (currentMajor >= required) {
      return { name: 'Node runtime', status: 'ok', detail: `${current} (satisfies ${engines})` };
    }
    return {
      name: 'Node runtime',
      status: 'fail',
      detail: `${current} does not satisfy ${engines}`,
      fix: `Upgrade Node to ${engines}. nvm: \`nvm install ${required} && nvm use ${required}\`.`,
    };
  } catch (err) {
    return {
      name: 'Node runtime',
      status: 'warn',
      detail: `Could not resolve engines.node: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function formatCheck(check: CheckResult, maxNameLen: number): string {
  const dots = '.'.repeat(Math.max(1, maxNameLen - check.name.length + 2));
  const statusLabel =
    check.status === 'ok' ? colors.green('OK') :
    check.status === 'warn' ? colors.yellow('WARN') :
    colors.red('FAIL');

  const padding = check.status === 'ok' ? '  ' : check.status === 'warn' ? '' : '';
  return `  ${check.name} ${colors.dim(dots)} ${statusLabel}${padding} ${check.detail}`;
}

/**
 * Create the doctor command.
 */
export function createDoctorCommand(output: CLIOutput = defaultOutput): Command {
  const command = new Command('doctor')
    .description('Check environment health and diagnose issues')
    .option('-p, --project <path>', 'Project directory', '.')
    .option('-d, --db <path>', 'Custom database path')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const projectPath = path.resolve(options.project);

      // Resolve config for database path
      let dbPath = '';

      try {
        const configManager = new ConfigManager({ inMemoryOnly: true });
        const resolved = await configManager.resolve(projectPath);
        dbPath = options.db || resolved.database.path;
      } catch {
        // Use defaults if config resolution fails — local DB
        if (options.db) {
          dbPath = options.db;
        } else {
          dbPath = path.join(projectPath, '.ctx-sys', 'ctx-sys.db');
        }
      }

      // Run all checks
      const checks: CheckResult[] = [];

      // Native-module checks first.
      checks.push(checkNodeVersion());
      checks.push(await checkBetterSqlite3());
      checks.push(await checkSqliteVec());

      // Local embedder check.
      checks.push(await checkLocalEmbedder());

      checks.push(await checkDatabase(dbPath));
      checks.push(await checkConfig(projectPath));
      checks.push(await checkProject(dbPath, projectPath));

      // Output
      if (options.json) {
        const passed = checks.filter(c => c.status === 'ok').length;
        const warned = checks.filter(c => c.status === 'warn').length;
        const failed = checks.filter(c => c.status === 'fail').length;
        const recommendations = checks.filter(c => c.fix).map(c => c.fix!);
        output.log(JSON.stringify({ checks, passed, warned, failed, recommendations }, null, 2));
      } else {
        output.log('');
        output.log(colors.bold('  ctx-sys Doctor'));
        output.log('');

        const maxNameLen = Math.max(...checks.map(c => c.name.length));
        for (const check of checks) {
          output.log(formatCheck(check, maxNameLen));
        }

        const passed = checks.filter(c => c.status === 'ok').length;
        const warned = checks.filter(c => c.status === 'warn').length;
        const failed = checks.filter(c => c.status === 'fail').length;

        output.log('');
        const parts = [`${passed}/${checks.length} checks passed`];
        if (warned > 0) parts.push(`${warned} warning${warned > 1 ? 's' : ''}`);
        if (failed > 0) parts.push(`${failed} failed`);
        output.log(`  ${parts.join(', ')}`);

        // Recommendations
        const fixes = checks.filter(c => c.fix);
        if (fixes.length > 0) {
          output.log('');
          output.log(colors.bold('  Recommendations:'));
          for (const check of fixes) {
            output.log(`    ${colors.cyan(check.fix!)}${colors.dim(`  # ${check.name}`)}`);
          }
        }
        output.log('');
      }

      // Exit code: 1 if any check failed
      if (checks.some(c => c.status === 'fail')) {
        process.exit(1);
      }
    });

  return command;
}

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { CtxSysMcpServer } from '../mcp';
import { ConfigManager } from '../config/manager';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

/**
 * Resolve the database path for the MCP server.
 * Uses the same ConfigManager resolution as CLI commands so both
 * always share the same database for a given project directory.
 * Priority: explicit --db flag > ConfigManager resolved path > global default
 */
async function resolveDbPath(explicitDb?: string, projectDir?: string): Promise<string | undefined> {
  if (explicitDb) return explicitDb;

  const targetDir = projectDir ? resolve(projectDir) : process.cwd();
  try {
    const configManager = new ConfigManager({ inMemoryOnly: true });
    const resolved = await configManager.resolve(targetDir);
    return resolved.database.path;
  } catch {
    return undefined; // Fall back to AppContext default
  }
}

/**
 * Drain in-flight requests on SIGTERM: at most 5 seconds, then exit
 * cleanly regardless. The server.close() awaits in-flight tool calls
 * naturally; the timeout guards against a stuck handler.
 */
function attachShutdownHandlers(server: CtxSysMcpServer): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    const drainTimer = setTimeout(() => {
      console.error(`ctx-sys: drain timed out on ${signal}, forcing exit`);
      process.exit(0);
    }, 5000);
    drainTimer.unref();

    try {
      await server.close();
    } catch (err) {
      console.error(`ctx-sys: error during close on ${signal}:`, err);
    } finally {
      clearTimeout(drainTimer);
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * Create the serve command for running the MCP server.
 */
export function createServeCommand(): Command {
  const command = new Command('serve')
    .description('Start the MCP server for AI assistant integration (spawned by Claude Desktop / Claude Code / Cursor — not run directly by humans)')
    .option('-d, --db <path>', 'Database path')
    .option('-p, --project <path>', 'Project directory (auto-detects database)')
    .option('-n, --name <name>', 'Server name', 'ctx-sys')
    .option('-v, --version <version>', 'Server version', pkg.version)
    .addHelpText('after', `
Examples:
  ctx-sys serve                  # stdio (the MCP transport)
  ctx-sys serve --db ./custom.sqlite
  ctx-sys serve --project ./my-app

This command is spawned by MCP clients (Claude Desktop / Claude Code /
Cursor / yaao) over stdio, not run interactively.

See also:
  ctx-sys init --mcp     # auto-registers ctx-sys in the agent's MCP config
`)
    .action(async (options) => {
      const dbPath = await resolveDbPath(options.db, options.project);
      const server = new CtxSysMcpServer({
        dbPath,
        name: options.name,
        version: options.version
      });

      try {
        attachShutdownHandlers(server);
        await server.start();
      } catch (error) {
        console.error('Server error:', error);
        process.exit(1);
      }
    });

  return command;
}

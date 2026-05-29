import { Command } from 'commander';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import * as net from 'node:net';
import { join, resolve } from 'path';
import { CtxSysMcpServer } from '../mcp';
import { ConfigManager } from '../config/manager';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

/** v2 F1.3: stderr line yaao (and any other parent) waits for before
 *  sending JSON-RPC. Must be exactly this string, on stderr, terminated
 *  by a newline. */
export const READY_MARKER = 'ctx-sys: ready';

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
 * Drain in-flight requests on SIGTERM. v2 F1.3 spec: at most 5 seconds,
 * then exit cleanly regardless. The server.close() awaits in-flight
 * tool calls naturally; the timeout guards against a stuck handler.
 */
function attachShutdownHandlers(
  server: CtxSysMcpServer,
  onShutdown: () => void = () => {},
): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    const drainTimer = setTimeout(() => {
      console.error(`ctx-sys: drain timed out on ${signal}, forcing exit`);
      onShutdown();
      process.exit(0);
    }, 5000);
    drainTimer.unref();

    try {
      await server.close();
    } catch (err) {
      console.error(`ctx-sys: error during close on ${signal}:`, err);
    } finally {
      clearTimeout(drainTimer);
      onShutdown();
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * v2 F1.3: serve MCP over a Unix domain socket instead of stdio. yaao
 * (and any other orchestrator that wants to spawn ctx-sys without
 * sharing its stdio) connects to `socketPath` and the first connection
 * gets a StdioServerTransport bridged over the socket.
 *
 * The socket is single-connection on purpose — MCP is point-to-point —
 * but the listener stays open until shutdown so a reconnecting client
 * works without respawning.
 */
async function startOverSocket(
  server: CtxSysMcpServer,
  socketPath: string,
): Promise<void> {
  // Best-effort cleanup of a stale socket file from a previous crashed
  // run. If a live listener is bound, listen() below will EADDRINUSE
  // and surface the conflict.
  try {
    if (existsSync(socketPath)) unlinkSync(socketPath);
  } catch {
    // Non-fatal: listen() will report the real error if it matters.
  }

  const listener = net.createServer({ allowHalfOpen: false });

  // Initialize the server before listening so the ready marker means
  // 'ready to accept JSON-RPC', not just 'socket file exists'.
  await server.initialize();

  await new Promise<void>((resolveListen, rejectListen) => {
    listener.once('error', rejectListen);
    listener.listen(socketPath, () => {
      listener.removeListener('error', rejectListen);
      resolveListen();
    });
  });

  attachShutdownHandlers(server, () => {
    try { listener.close(); } catch { /* ignore */ }
    try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch { /* ignore */ }
  });

  let connected = false;
  listener.on('connection', async (sock) => {
    if (connected) {
      // Second client tried to connect while another is using the
      // session. MCP is point-to-point; refuse politely.
      sock.destroy(new Error('ctx-sys MCP socket already has an active client'));
      return;
    }
    connected = true;
    sock.on('close', () => {
      connected = false;
    });
    try {
      await server.start(sock, sock);
    } catch (err) {
      console.error('ctx-sys: failed to attach MCP transport to socket:', err);
      sock.destroy();
      connected = false;
    }
  });

  // v2 F1.3 contract: emit the ready marker on stderr ONLY after the
  // listener is bound. yaao watches stderr for this line and stops
  // polling once it sees it.
  process.stderr.write(`${READY_MARKER}\n`);
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
    .option('--socket <path>', 'v2 F1.3: serve MCP over a Unix domain socket instead of stdio')
    .addHelpText('after', `
Examples:
  ctx-sys serve                              # stdio (the usual MCP transport)
  ctx-sys serve --socket /tmp/ctx-sys.sock   # UDS (used by yaao)
  ctx-sys serve --db ./custom.sqlite

This command is spawned by MCP clients (Claude Desktop / Claude Code /
Cursor / yaao), not run interactively. It emits 'ctx-sys: ready' on
stderr once the transport is up so spawners can stop polling.

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
        if (options.socket) {
          await startOverSocket(server, resolve(options.socket as string));
        } else {
          attachShutdownHandlers(server);
          await server.start();
          // stdio mode: emit ready marker on stderr too. Clients can
          // ignore it; yaao reads stderr line-by-line and either form
          // satisfies the contract.
          process.stderr.write(`${READY_MARKER}\n`);
        }
      } catch (error) {
        console.error('Server error:', error);
        process.exit(1);
      }
    });

  return command;
}

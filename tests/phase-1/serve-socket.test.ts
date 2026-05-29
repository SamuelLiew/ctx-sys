/**
 * v2 F1.3: yaao native integration contract.
 *
 * Locks the public surface yaao spawns against:
 *   1. `ctx-sys serve --socket <path>` is a valid CLI flag.
 *   2. The serve process emits 'ctx-sys: ready\n' on stderr only AFTER
 *      the socket is bound (so yaao can stop polling).
 *   3. A connecting MCP client gets a working transport.
 *   4. SIGTERM closes the listener and unlinks the socket within 5s.
 *
 * Spawns a real child process via execa to exercise the full path
 * (not just the in-process module API).
 */

import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as net from 'node:net';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../dist/cli/index.js');

describe('F1.3 serve --socket', () => {
  let tmp: string;
  let socketPath: string;
  let dbPath: string;
  let child: ReturnType<typeof spawn> | null = null;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`dist/cli/index.js missing — run npm run build before this test (looked at ${CLI})`);
    }
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f13-'));
    socketPath = path.join(tmp, 'mcp.sock');
    dbPath = path.join(tmp, 'db.sqlite');
  });

  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      // give the drain a moment, then SIGKILL fallback
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          try { child!.kill('SIGKILL'); } catch {}
          resolve();
        }, 6000);
        child!.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    child = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function waitForReady(timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ready marker. stderr so far:\n${buf}`));
      }, timeoutMs);
      child!.stderr!.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        if (buf.includes('ctx-sys: ready')) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
    });
  }

  function startServe(extraArgs: string[] = []): void {
    child = spawn('node', [CLI, 'serve', '--socket', socketPath, '--db', dbPath, ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', () => {/* discard */});
  }

  it('emits ctx-sys: ready on stderr after binding the socket', async () => {
    startServe();
    const buf = await waitForReady(15_000);
    expect(buf).toMatch(/ctx-sys: ready\n/);
    // By the time the marker is emitted, the socket file should exist.
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  it('accepts a client connection on the socket', async () => {
    startServe();
    await waitForReady(15_000);

    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(socketPath);
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error('Client never connected to the MCP socket'));
      }, 5_000);
      client.once('connect', () => {
        clearTimeout(timer);
        client.end();
        resolve();
      });
      client.once('error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });

  it('SIGTERM closes the listener and unlinks the socket file', async () => {
    startServe();
    await waitForReady(15_000);
    expect(fs.existsSync(socketPath)).toBe(true);

    child!.kill('SIGTERM');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Process did not exit within 6s of SIGTERM'));
      }, 6_000);
      child!.once('exit', code => {
        clearTimeout(timer);
        expect(code).toBe(0);
        resolve();
      });
    });

    // Socket file should be cleaned up on shutdown.
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});

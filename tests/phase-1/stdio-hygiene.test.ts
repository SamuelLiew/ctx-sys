/**
 * v2 F1.4 Part A: stdio hygiene regression test.
 *
 * Locks the rule that `ctx-sys serve` writes nothing but valid JSON-RPC
 * frames to stdout. Any stray console.log from src/ or a transitive dep
 * crashes the MCP client; this test catches that immediately.
 *
 * Strategy: spawn the built CLI in --socket mode (so the test can use
 * stdout for its own diagnostics if needed), wait for the ready marker
 * on stderr, then assert process.stdout produced nothing during the
 * startup + initialize + a representative tool-call workload.
 */

import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as net from 'node:net';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../dist/cli/index.js');

describe('F1.4 stdio hygiene', () => {
  let tmp: string;
  let socketPath: string;
  let dbPath: string;
  let child: ReturnType<typeof spawn> | null = null;
  let stdoutBuf: string;
  let stderrBuf: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f14-'));
    socketPath = path.join(tmp, 'mcp.sock');
    dbPath = path.join(tmp, 'db.sqlite');
    stdoutBuf = '';
    stderrBuf = '';
  });

  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          try { child!.kill('SIGKILL'); } catch {}
          resolve();
        }, 6000);
        child!.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    child = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function startServe(): Promise<void> {
    child = spawn('node', [CLI, 'serve', '--socket', socketPath, '--db', dbPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', (chunk: Buffer) => { stdoutBuf += chunk.toString('utf-8'); });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for ready marker')), 15_000);
      child!.stderr!.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8');
        if (stderrBuf.includes('ctx-sys: ready')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  it('emits NOTHING on stdout from start through ready', async () => {
    await startServe();
    // Small delay to let any late stdout writes flush.
    await new Promise(r => setTimeout(r, 100));
    expect(stdoutBuf).toBe('');
  });

  it('keeps stdout silent during a tools/list JSON-RPC round trip', async () => {
    await startServe();

    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(socketPath);
      let response = '';
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error(`No response in time. stdout buf so far: ${JSON.stringify(stdoutBuf)}`));
      }, 5_000);
      client.on('connect', () => {
        client.write(JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
        }) + '\n');
      });
      client.on('data', (chunk: Buffer) => {
        response += chunk.toString('utf-8');
        if (response.includes('"jsonrpc"') && response.includes('"id":1')) {
          clearTimeout(timer);
          client.end();
          resolve();
        }
      });
      client.on('error', err => { clearTimeout(timer); reject(err); });
    });

    // Whatever the JSON-RPC content is, NONE of it should have leaked
    // to the child's stdout: the response went through the socket.
    expect(stdoutBuf).toBe('');
  });
});

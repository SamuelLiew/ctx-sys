/**
 * stdio hygiene regression test.
 *
 * Locks the rule that `ctx-sys serve` writes nothing but valid JSON-RPC
 * frames to stdout. Any stray console.log from src/ or a transitive dep
 * corrupts the MCP byte stream and crashes the client; this test catches
 * that immediately.
 *
 * Strategy: spawn the built CLI over plain stdio (the real MCP transport),
 * drive a representative `tools/list` round trip on stdin/stdout, then
 * assert every newline-delimited frame on stdout parses as a JSON-RPC 2.0
 * message — i.e. nothing non-protocol leaked onto the channel.
 */

import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../dist/cli/index.js');

describe('stdio hygiene', () => {
  let tmp: string;
  let dbPath: string;
  let child: ReturnType<typeof spawn> | null = null;
  let stdoutBuf: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`dist/cli/index.js missing — run npm run build before this test (looked at ${CLI})`);
    }
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-hygiene-'));
    dbPath = path.join(tmp, 'db.sqlite');
    stdoutBuf = '';
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

  function startServe(): void {
    child = spawn('node', [CLI, 'serve', '--db', dbPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', (chunk: Buffer) => { stdoutBuf += chunk.toString('utf-8'); });
  }

  it('emits only valid JSON-RPC frames on stdout during a tools/list round trip', async () => {
    startServe();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`No JSON-RPC response in time. stdout so far: ${JSON.stringify(stdoutBuf)}`));
      }, 8_000);
      child!.stdout!.on('data', () => {
        if (stdoutBuf.includes('"jsonrpc"') && stdoutBuf.includes('"id":1')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child!.on('error', err => { clearTimeout(timer); reject(err); });
      child!.stdin!.write(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
      }) + '\n');
    });

    // Every non-empty line on stdout must be a JSON-RPC 2.0 frame. A stray
    // console.log would land here as unparseable text and fail the test.
    const lines = stdoutBuf.split(/\r?\n/).filter(l => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      let parsed: unknown;
      expect(() => { parsed = JSON.parse(line); }).not.toThrow();
      expect((parsed as { jsonrpc?: string }).jsonrpc).toBe('2.0');
    }
  });
});

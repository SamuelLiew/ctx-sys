/**
 * v2 F2.2: ctx-sys setup. Spawns the built CLI in --no-install
 * --no-models --json mode so the test is hermetic — no Ollama
 * dependency, no real install, no model pulls.
 */

import { execSync, spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../dist/cli/index.js');

function runSetup(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, 'setup', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`setup didn't return in 20s. stdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 20_000);
    child.stdout!.on('data', d => { stdout += d.toString(); });
    child.stderr!.on('data', d => { stderr += d.toString(); });
    child.on('exit', code => {
      clearTimeout(timeout);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

describe('F2.2 ctx-sys setup', () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) throw new Error(`dist CLI missing — npm run build first`);
  });
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f22-setup-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('emits a JSON summary with detected backends + actions + doctor in --json mode', async () => {
    const { code, stdout } = await runSetup(tmp, ['--no-install', '--no-models', '--json']);
    // Doctor may exit 1 if a check FAILed (e.g. no Ollama on CI); that's
    // fine. What matters is the JSON shape is intact.
    expect([0, 1]).toContain(code);

    const jsonStart = stdout.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(stdout.slice(jsonStart));
    expect(payload.backend).toMatch(/ollama|openai|openai-compatible/);
    expect(payload.detected).toBeDefined();
    expect(payload.detected.ollama).toBeDefined();
    expect(Array.isArray(payload.actions)).toBe(true);
    expect(Array.isArray(payload.doctor)).toBe(true);
    expect(payload.doctor.length).toBeGreaterThan(0);
    // F2.2 native-module checks must appear.
    const names = payload.doctor.map((c: { name: string }) => c.name);
    expect(names).toContain('better-sqlite3');
    expect(names).toContain('sqlite-vec');
    expect(names).toContain('Node runtime');
  });

  it('writes .ctx-sys/config.yaml with a starter shape', async () => {
    await runSetup(tmp, ['--no-install', '--no-models', '--backend', 'openai-compatible', '--json']);
    const cfgPath = path.join(tmp, '.ctx-sys', 'config.yaml');
    expect(fs.existsSync(cfgPath)).toBe(true);
    const body = fs.readFileSync(cfgPath, 'utf-8');
    expect(body).toContain('openai-compatible');
    expect(body).toContain('nomic-embed-text');
    expect(body).toContain('summarization:');
    expect(body).toContain('hyde:');
  });

  it('respects --no-models — does not attempt to pull any model', async () => {
    const { stdout } = await runSetup(tmp, ['--no-install', '--no-models', '--json']);
    const jsonStart = stdout.indexOf('{');
    const payload = JSON.parse(stdout.slice(jsonStart));
    expect(payload.modelsPulled).toEqual([]);
  });

  it('leaves an existing .ctx-sys/config.yaml untouched', async () => {
    const cfgPath = path.join(tmp, '.ctx-sys', 'config.yaml');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, 'project:\n  name: pre-existing\n');

    await runSetup(tmp, ['--no-install', '--no-models', '--json']);

    const body = fs.readFileSync(cfgPath, 'utf-8');
    expect(body).toContain('pre-existing');
  });
});

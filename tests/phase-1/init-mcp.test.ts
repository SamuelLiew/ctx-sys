/**
 * v2 F1.6: ctx-sys init --mcp auto-registers ctx-sys in the four
 * standard MCP locations agent tools look at, with the same conflict
 * semantics as yaao's F14.2.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeMcpRegistrations } from '../../src/cli/init-mcp';

describe('F1.6 init --mcp', () => {
  let projectTmp: string;
  let codexTmp: string;
  const silentOutput = { log: () => {}, error: () => {}, success: () => {} };

  beforeEach(() => {
    projectTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f16-'));
    codexTmp = path.join(projectTmp, 'fake-home', '.codex', 'config.toml');
  });
  afterEach(() => {
    fs.rmSync(projectTmp, { recursive: true, force: true });
  });

  const codex = () => codexTmp;

  it('fresh: writes valid .mcp.json with the ctx-sys entry', async () => {
    const result = await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    expect(result.errors).toHaveLength(0);
    const body = JSON.parse(fs.readFileSync(path.join(projectTmp, '.mcp.json'), 'utf-8'));
    expect(body.mcpServers['ctx-sys']).toEqual({ command: 'ctx-sys', args: ['serve'] });
  });

  it('merge: preserves an existing mcpServers.other entry', async () => {
    const target = path.join(projectTmp, '.mcp.json');
    fs.writeFileSync(target, JSON.stringify({
      mcpServers: { other: { command: 'other', args: ['--flag'] } },
    }));

    await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    const body = JSON.parse(fs.readFileSync(target, 'utf-8'));
    expect(body.mcpServers.other).toEqual({ command: 'other', args: ['--flag'] });
    expect(body.mcpServers['ctx-sys']).toEqual({ command: 'ctx-sys', args: ['serve'] });
  });

  it('idempotent: re-running with a matching entry is a no-op (no warning, no rewrite)', async () => {
    await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());
    const mcpPath = path.join(projectTmp, '.mcp.json');
    const firstMtime = fs.statSync(mcpPath).mtimeMs;

    // Pause long enough that any rewrite would bump mtime.
    await new Promise(r => setTimeout(r, 10));
    const second = await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    expect(second.warnings).toHaveLength(0);
    expect(second.errors).toHaveLength(0);
    expect(second.unchanged).toContain(mcpPath);
    expect(fs.statSync(mcpPath).mtimeMs).toBe(firstMtime);
  });

  it('no-overwrite: a non-matching ctx-sys entry is left alone with a warning', async () => {
    const target = path.join(projectTmp, '.mcp.json');
    const existing = {
      mcpServers: { 'ctx-sys': { command: 'ctx-sys', args: ['serve', '--db', '/custom'] } },
    };
    fs.writeFileSync(target, JSON.stringify(existing));

    const result = await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    expect(result.warnings.some(w => w.path === target)).toBe(true);
    expect(result.written).not.toContain(target);
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual(existing);
  });

  it('force: replaces the non-matching ctx-sys entry', async () => {
    const target = path.join(projectTmp, '.mcp.json');
    fs.writeFileSync(target, JSON.stringify({
      mcpServers: { 'ctx-sys': { command: 'ctx-sys', args: ['serve', '--db', '/old'] } },
    }));

    const result = await writeMcpRegistrations(projectTmp, silentOutput, { force: true }, codex());

    expect(result.warnings).toHaveLength(0);
    expect(result.written).toContain(target);
    const body = JSON.parse(fs.readFileSync(target, 'utf-8'));
    expect(body.mcpServers['ctx-sys']).toEqual({ command: 'ctx-sys', args: ['serve'] });
  });

  it('cursor: writes a sibling .cursor/mcp.json with the same shape', async () => {
    await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    const body = JSON.parse(fs.readFileSync(path.join(projectTmp, '.cursor', 'mcp.json'), 'utf-8'));
    expect(body.mcpServers['ctx-sys']).toEqual({ command: 'ctx-sys', args: ['serve'] });
  });

  it('codex: writes ~/.codex/config.toml with [mcp_servers.ctx-sys]', async () => {
    await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    const body = fs.readFileSync(codexTmp, 'utf-8');
    expect(body).toMatch(/mcp_servers\.["']?ctx-sys["']?/);
    expect(body).toMatch(/command = ["']ctx-sys["']/);
    expect(body).toMatch(/args = \[\s*["']serve["']\s*\]/);
  });

  it('codex: idempotent on a matching existing TOML block', async () => {
    await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());
    const firstMtime = fs.statSync(codexTmp).mtimeMs;
    await new Promise(r => setTimeout(r, 10));
    const second = await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    expect(second.warnings).toHaveLength(0);
    expect(second.unchanged).toContain(codexTmp);
    expect(fs.statSync(codexTmp).mtimeMs).toBe(firstMtime);
  });

  it('copilot: appends a managed block to .github/copilot-instructions.md', async () => {
    await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    const body = fs.readFileSync(path.join(projectTmp, '.github', 'copilot-instructions.md'), 'utf-8');
    expect(body).toContain('ctx-sys (managed by `ctx-sys init`');
    expect(body).toContain('ctx-sys context');
  });

  it('copilot: preserves user content above/below the managed block', async () => {
    const target = path.join(projectTmp, '.github', 'copilot-instructions.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '# Custom Copilot Instructions\n\nUse spaces, not tabs.\n');

    await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    const body = fs.readFileSync(target, 'utf-8');
    expect(body).toContain('Use spaces, not tabs.');
    expect(body).toContain('ctx-sys (managed by `ctx-sys init`');
  });

  it('mcp-name: registers under a custom key', async () => {
    await writeMcpRegistrations(projectTmp, silentOutput, { name: 'ctx-sys-frontend' }, codex());

    const body = JSON.parse(fs.readFileSync(path.join(projectTmp, '.mcp.json'), 'utf-8'));
    expect(body.mcpServers['ctx-sys-frontend']).toEqual({ command: 'ctx-sys', args: ['serve'] });
    expect(body.mcpServers['ctx-sys']).toBeUndefined();
  });

  it('malformed JSON target: surfaces as an error, no crash', async () => {
    fs.writeFileSync(path.join(projectTmp, '.mcp.json'), '{ this is not json');

    const result = await writeMcpRegistrations(projectTmp, silentOutput, {}, codex());

    expect(result.errors.some(e => e.path.endsWith('.mcp.json'))).toBe(true);
  });
});

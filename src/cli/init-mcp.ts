/**
 * v2 F1.6: ctx-sys init --mcp wiring.
 *
 * Auto-register the ctx-sys MCP server in the four standard locations
 * agent tooling looks at, matching yaao's F14.2 semantics so a user
 * running both tools sees a consistent shape:
 *
 *   - <project>/.mcp.json                       (Claude Code)
 *   - <project>/.cursor/mcp.json                (Cursor)
 *   - ~/.codex/config.toml                      (Codex, user-global)
 *   - <project>/.github/copilot-instructions.md (Copilot inline note)
 *
 * Idempotency is stricter than 'entry exists' — the existing entry must
 * MATCH what we'd write for the run to be a no-op. Non-matching entries
 * are left alone with a warning unless --force is passed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { CLIOutput } from './init';

// smol-toml is ESM-only; load it lazily so the CommonJS build keeps
// working. The first call to writeCodexTarget pays the import cost.
type TomlMod = { parse: (s: string) => unknown; stringify: (v: unknown) => string };
let _toml: Promise<TomlMod> | null = null;
function tomlMod(): Promise<TomlMod> {
  if (!_toml) _toml = import('smol-toml') as Promise<TomlMod>;
  return _toml;
}

export interface McpInitOptions {
  /** Default 'ctx-sys'. Override with --mcp-name for side-by-side indexes. */
  name?: string;
  /** Replace a non-matching existing entry. */
  force?: boolean;
}

export interface McpInitResult {
  written: string[];
  unchanged: string[];
  warnings: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; reason: string }>;
}

/** v2 F1.6: what we'd write into mcpServers[name] in any JSON target. */
function ctxSysEntry(): { command: string; args: string[] } {
  return { command: 'ctx-sys', args: ['serve'] };
}

const COPILOT_BLOCK_BEGIN = '<!-- ctx-sys (managed by `ctx-sys init`; safe to remove) -->';
const COPILOT_BLOCK_END = '<!-- /ctx-sys -->';

/**
 * Read + parse a JSON file. Returns `undefined` if the file doesn't
 * exist; throws if it exists but is malformed (caller surfaces as a
 * user-facing error per the F1.6 spec).
 */
function readJsonFile<T = unknown>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const body = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(body) as T;
  } catch (err) {
    throw new Error(`Malformed JSON at ${filePath}: ${(err as Error).message}`);
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

function entriesMatch(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Write a single mcpServers[name] entry into a JSON file. Used for
 * .mcp.json (Claude Code) and .cursor/mcp.json (Cursor) — both share
 * the shape { mcpServers: { <name>: { command, args, ... } } }.
 */
function writeJsonMcpTarget(
  filePath: string,
  name: string,
  options: McpInitOptions,
  result: McpInitResult,
): void {
  const desired = ctxSysEntry();
  let existing: { mcpServers?: Record<string, unknown> } | undefined;
  try {
    existing = readJsonFile(filePath);
  } catch (err) {
    result.errors.push({ path: filePath, reason: (err as Error).message });
    return;
  }

  if (!existing) {
    writeJsonFile(filePath, { mcpServers: { [name]: desired } });
    result.written.push(filePath);
    return;
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  const current = servers[name];

  if (current === undefined) {
    servers[name] = desired;
    existing.mcpServers = servers;
    writeJsonFile(filePath, existing);
    result.written.push(filePath);
    return;
  }

  if (entriesMatch(current, desired)) {
    result.unchanged.push(filePath);
    return;
  }

  if (!options.force) {
    result.warnings.push({
      path: filePath,
      reason: `found existing '${name}' MCP entry differing from the F1.6 default — not overwriting. Re-run with --mcp --force to replace.`,
    });
    return;
  }

  servers[name] = desired;
  existing.mcpServers = servers;
  writeJsonFile(filePath, existing);
  result.written.push(filePath);
}

/**
 * Write the user-global ~/.codex/config.toml. Codex has no project-local
 * override so this is the canonical location.
 */
async function writeCodexTarget(
  filePath: string,
  name: string,
  options: McpInitOptions,
  result: McpInitResult,
): Promise<void> {
  const desired = ctxSysEntry();
  let existing: Record<string, unknown> = {};
  const toml = await tomlMod();

  if (fs.existsSync(filePath)) {
    try {
      const body = fs.readFileSync(filePath, 'utf-8');
      existing = toml.parse(body) as Record<string, unknown>;
    } catch (err) {
      result.errors.push({ path: filePath, reason: `malformed TOML: ${(err as Error).message}` });
      return;
    }
  }

  const mcpServers = (existing.mcp_servers ?? {}) as Record<string, unknown>;
  const current = mcpServers[name] as Record<string, unknown> | undefined;

  const equivalent = !!current
    && current.command === desired.command
    && Array.isArray(current.args)
    && entriesMatch(current.args, desired.args);

  if (equivalent) {
    result.unchanged.push(filePath);
    return;
  }

  if (current !== undefined && !options.force) {
    result.warnings.push({
      path: filePath,
      reason: `found existing [mcp_servers.${name}] in ~/.codex/config.toml differing from the F1.6 default — not overwriting. Re-run with --mcp --force to replace.`,
    });
    return;
  }

  mcpServers[name] = desired;
  existing.mcp_servers = mcpServers;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, toml.stringify(existing), { mode: 0o644 });
  result.written.push(filePath);
}

/**
 * Append a managed block to .github/copilot-instructions.md. Copilot has
 * weaker MCP coverage; this matches yaao's fallback approach (a small
 * inline reference users can point Copilot at).
 */
function writeCopilotTarget(
  filePath: string,
  name: string,
  options: McpInitOptions,
  result: McpInitResult,
): void {
  const block = [
    COPILOT_BLOCK_BEGIN,
    '',
    'This project uses [ctx-sys](https://github.com/davidfranz/ctx-sys) for hybrid RAG over the codebase.',
    `When the Copilot agent supports MCP, register the \`${name}\` server by running \`${ctxSysEntry().command} ${ctxSysEntry().args.join(' ')}\`.`,
    'Until then, ask ctx-sys to surface relevant code via its CLI: `ctx-sys context "<question>"`.',
    '',
    COPILOT_BLOCK_END,
    '',
  ].join('\n');

  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf-8')
    : '';

  if (existing.includes(COPILOT_BLOCK_BEGIN) && existing.includes(COPILOT_BLOCK_END)) {
    const matches = existing.includes(block);
    if (matches) {
      result.unchanged.push(filePath);
      return;
    }
    if (!options.force) {
      result.warnings.push({
        path: filePath,
        reason: 'found existing ctx-sys managed block in copilot-instructions.md differing from the F1.6 default — not overwriting. Re-run with --mcp --force to replace.',
      });
      return;
    }
    const before = existing.slice(0, existing.indexOf(COPILOT_BLOCK_BEGIN));
    const after = existing.slice(existing.indexOf(COPILOT_BLOCK_END) + COPILOT_BLOCK_END.length);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${before}${block}${after}`, { mode: 0o644 });
    result.written.push(filePath);
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(filePath, `${existing}${sep}${block}`, { mode: 0o644 });
  result.written.push(filePath);
}

/**
 * Write the ctx-sys MCP entry into all four standard targets. Idempotent
 * when entries already match what we'd write; non-matching entries are
 * preserved unless --force.
 */
export async function writeMcpRegistrations(
  projectPath: string,
  output: CLIOutput,
  options: McpInitOptions = {},
  // Test seam: override the codex global path so a temp HOME isn't needed.
  codexPath: string = path.join(os.homedir(), '.codex', 'config.toml'),
): Promise<McpInitResult> {
  const name = options.name ?? 'ctx-sys';
  const result: McpInitResult = { written: [], unchanged: [], warnings: [], errors: [] };

  writeJsonMcpTarget(path.join(projectPath, '.mcp.json'), name, options, result);
  writeJsonMcpTarget(path.join(projectPath, '.cursor', 'mcp.json'), name, options, result);
  await writeCodexTarget(codexPath, name, options, result);
  writeCopilotTarget(path.join(projectPath, '.github', 'copilot-instructions.md'), name, options, result);

  for (const w of result.written) output.success(`Wrote MCP entry to ${w}`);
  for (const u of result.unchanged) output.log(`  MCP entry already current at ${u}`);
  for (const warning of result.warnings) output.log(`  warning: ${warning.reason} (${warning.path})`);
  for (const err of result.errors) output.error(`${err.reason} (${err.path})`);

  return result;
}

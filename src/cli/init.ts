/**
 * CLI command for initializing a project configuration.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager, DEFAULT_PROJECT_CONFIG_FILE } from '../config';
import { writeMcpRegistrations } from './init-mcp';

/**
 * v2 F1.1: seed `.ctxignore` content written by `ctx-sys init`.
 * Users see the boundary in their repo, edit it freely, and commit it.
 */
const SEED_CTXIGNORE = `# .ctxignore — patterns excluded from ctx-sys indexing.
# Same syntax as .gitignore (one pattern per line, # for comments).
# Edit freely; this file is intended to be committed.

# Build output
dist/
build/
out/
.next/
target/
*.tsbuildinfo

# Dependencies (already covered by DEFAULT_EXCLUDE; listed for visibility)
node_modules/
vendor/
.venv/
venv/
__pycache__/

# ctx-sys & sibling tooling state
.ctx-sys/
.yaao/
.yaao/worktrees/
.lean-ctx/

# Lockfiles & large generated artifacts
package-lock.json
pnpm-lock.yaml
yarn.lock
Cargo.lock
*.min.js
*.map

# Test fixtures (uncomment if your fixtures are large or noisy)
# tests/**/fixtures/
# **/__snapshots__/

# Secrets — never index these
.env
.env.*
*.pem
*.key
`;

/**
 * Output interface for formatting.
 */
export interface CLIOutput {
  log: (message: string) => void;
  error: (message: string) => void;
  success: (message: string) => void;
}

/**
 * Default CLI output using console.
 */
export const defaultOutput: CLIOutput = {
  log: (msg) => console.log(msg),
  error: (msg) => console.error(`Error: ${msg}`),
  success: (msg) => console.log(`✓ ${msg}`)
};

/**
 * Create the init command.
 */
export function createInitCommand(output: CLIOutput = defaultOutput): Command {
  const command = new Command('init')
    .description('Initialize ctx-sys configuration for a project')
    .argument('[directory]', 'Project directory', '.')
    .option('-n, --name <name>', 'Project name')
    .option('-f, --force', 'Overwrite existing configuration', false)
    .option('--global', 'Initialize global configuration instead', false)
    .option('--no-ignore-file', 'Skip generating .ctxignore (v2 F1.1)')
    .option('--no-mcp', 'v2 F1.6: skip auto-registering ctx-sys in MCP configs')
    .option('--mcp', 'v2 F1.6: explicitly opt in to MCP registration on re-init')
    .option('--mcp-name <name>', 'v2 F1.6: register under a different key (e.g. ctx-sys-frontend)')
    .action(async (directory: string, options) => {
      try {
        const projectPath = path.resolve(directory);
        const configManager = new ConfigManager();

        if (options.global) {
          await initGlobalConfig(configManager, options, output);
        } else {
          await initProjectConfig(configManager, projectPath, options, output);
        }
      } catch (error) {
        output.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}

export { SEED_CTXIGNORE };

/**
 * v2 F1.1: write a seeded `.ctxignore` next to the project config.
 * Idempotent — leaves an existing `.ctxignore` untouched unless `--force`
 * is set, and prints what happened.
 */
export function writeCtxignore(
  projectPath: string,
  options: { force?: boolean; ignoreFile?: boolean },
  output: CLIOutput,
): void {
  if (options.ignoreFile === false) return;
  const ctxignorePath = path.join(projectPath, '.ctxignore');
  const exists = fs.existsSync(ctxignorePath);
  if (exists && !options.force) {
    output.log(`  .ctxignore already exists at ${ctxignorePath} (use --force to overwrite)`);
    return;
  }
  fs.writeFileSync(ctxignorePath, SEED_CTXIGNORE);
  output.success(`${exists ? 'Overwrote' : 'Wrote'} .ctxignore at ${ctxignorePath}`);
}

/**
 * Initialize global configuration.
 */
async function initGlobalConfig(
  configManager: ConfigManager,
  options: { force?: boolean },
  output: CLIOutput
): Promise<void> {
  const exists = await configManager.globalConfigExists();

  if (exists && !options.force) {
    output.error('Global configuration already exists. Use --force to overwrite.');
    process.exit(1);
  }

  const config = await configManager.loadGlobal();
  await configManager.saveGlobal(config);

  output.success(`Global configuration initialized at ${configManager.getGlobalConfigPath()}`);
}

/**
 * Initialize project configuration.
 */
async function initProjectConfig(
  configManager: ConfigManager,
  projectPath: string,
  options: { name?: string; force?: boolean; ignoreFile?: boolean; mcp?: boolean; mcpName?: string },
  output: CLIOutput
): Promise<void> {
  const exists = await configManager.projectConfigExists(projectPath);

  if (exists && !options.force) {
    output.error('Project configuration already exists. Use --force to overwrite.');
    process.exit(1);
  }

  // Create config with optional custom name
  const config = {
    ...DEFAULT_PROJECT_CONFIG_FILE,
    project: {
      ...DEFAULT_PROJECT_CONFIG_FILE.project,
      name: options.name || path.basename(projectPath)
    }
  };

  await configManager.saveProject(projectPath, config);
  output.success(`Project configuration initialized at ${configManager.getProjectConfigFilePath(projectPath)}`);

  // v2 F1.1: seed .ctxignore so the indexing boundary is visible from
  // day one and users don't silently inherit their .gitignore.
  writeCtxignore(projectPath, options, output);

  // v2 F1.6: register ctx-sys in every standard MCP target unless the
  // user opts out. Mirrors yaao F14.2.
  if (options.mcp !== false) {
    await writeMcpRegistrations(projectPath, output, { name: options.mcpName, force: options.force });
  }

  output.log('');
  output.log('Next steps:');
  output.log('  1. Edit .ctx-sys/config.yaml to customize settings');
  output.log('  2. Edit .ctxignore to refine the indexing boundary');
  output.log('  3. Run "ctx-sys index" to index your codebase');
}

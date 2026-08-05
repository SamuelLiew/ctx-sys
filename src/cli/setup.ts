/**
 * v2 F2.2: `ctx-sys setup` — one-command bootstrap.
 *
 * Simplified for local-first operation: detects Node, SQLite, and local
 * embedder availability, writes a sensible config, and runs doctor checks.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { CLIOutput, defaultOutput } from './init';
import {
  checkBetterSqlite3,
  checkSqliteVec,
  checkNodeVersion,
  checkLocalEmbedder,
  CheckResult,
} from './doctor';

interface SetupOptions {
  json?: boolean;
}

function writeMinimalConfig(projectPath: string, output: CLIOutput): void {
  const configPath = path.join(projectPath, '.ctx-sys', 'config.yaml');
  if (fs.existsSync(configPath)) {
    output.log(`  Existing config at ${configPath} — leaving it alone (re-run with --force on init to overwrite).`);
    return;
  }
  const cfg: Record<string, unknown> = {
    project: { name: path.basename(projectPath) },
    indexing: { mode: 'incremental', watch: false, ignore: ['node_modules', '.git', '.ctx-sys', 'dist', 'build'] },
    embeddings: { provider: 'local', model: 'all-MiniLM-L6-v2' },
    summarization: { enabled: false, provider: 'openai', model: 'gpt-4o-mini' },
    hyde: { enabled: false, model: 'gpt-4o-mini' },
    retrieval: { default_max_tokens: 4000, strategies: ['vector', 'graph', 'fts'] },
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.stringify(cfg));
  output.success(`Wrote starter config at ${configPath}`);
}

export function createSetupCommand(output: CLIOutput = defaultOutput): Command {
  return new Command('setup')
    .description('One-command bootstrap (write config / sanity check)')
    .option('--json', 'Emit a single JSON object summarising what setup did', false)
    .action(async (options: SetupOptions) => {
      const projectPath = process.cwd();
      const summary: {
        backend: string;
        actions: string[];
        doctor?: CheckResult[];
      } = { backend: 'local', actions: [] };

      if (!options.json) {
        output.log('');
        output.log('  ctx-sys setup');
        output.log('');
        output.log('  Backend: local (in-process Xenova/all-MiniLM-L6-v2)');
      }

      // Write config if absent.
      writeMinimalConfig(projectPath, output);
      summary.actions.push('config-written');

      // Sanity check.
      const doctorChecks: CheckResult[] = [];
      doctorChecks.push(checkNodeVersion());
      doctorChecks.push(await checkBetterSqlite3());
      doctorChecks.push(await checkSqliteVec());
      doctorChecks.push(await checkLocalEmbedder());
      summary.doctor = doctorChecks;

      if (options.json) {
        output.log(JSON.stringify(summary, null, 2));
      } else {
        output.log('');
        output.log('  Setup summary:');
        for (const action of summary.actions) output.log(`    - ${action}`);
        output.log('');
        output.log('  Sanity check:');
        for (const c of doctorChecks) {
          const tag = c.status === 'ok' ? 'OK  ' : c.status === 'warn' ? 'WARN' : 'FAIL';
          output.log(`    [${tag}] ${c.name}: ${c.detail}`);
        }
        output.log('');
        output.log('  Next: ctx-sys index .');
      }

      if (doctorChecks.some(c => c.status === 'fail')) process.exit(1);
    });
}

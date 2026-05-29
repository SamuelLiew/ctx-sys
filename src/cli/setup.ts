/**
 * v2 F2.2: `ctx-sys setup` — one-command bootstrap.
 *
 * Reduces the friction from `npm install -g ctx-sys` to working index
 * to a single command. Detects available local backends (Ollama,
 * OpenAI-compatible servers, llamafile), optionally installs Ollama
 * on platforms where the install is a known one-liner, pulls the
 * required models, writes a sensible config, and runs the F2.2 doctor
 * to confirm the resulting state.
 *
 * Non-interactive by default — every install step requires --install
 * (Ollama on macOS / Linux) or --yes (all confirms). Windows is
 * detection + recommendation only; we never auto-fetch a Windows
 * installer.
 */

import { Command } from 'commander';
import { execSync, spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { CLIOutput, defaultOutput } from './init';
import {
  checkBetterSqlite3,
  checkSqliteVec,
  checkNodeVersion,
  checkOllamaService,
  checkModel,
  CheckResult,
} from './doctor';

/**
 * Commander quirk: a `.option('--no-X', ...)` declaration sets the
 * derived options.X to `false` when the flag is given, NOT `options.noX`.
 * So `--no-models` lands as `options.models = false` and `--no-install`
 * as `options.install = false`. We surface both via the same shape.
 */
interface SetupOptions {
  yes?: boolean;
  /** Truthy when --install passed; false when --no-install passed; undefined otherwise. */
  install?: boolean;
  backend?: 'ollama' | 'openai-compatible' | 'openai';
  /** Falls to `false` only when --no-models is passed. */
  models?: boolean;
  json?: boolean;
}

interface DetectedBackends {
  ollama: { installed: boolean; reachable: boolean; baseUrl: string };
  openaiKey: boolean;
  llamaServer: boolean;
  lmStudio: boolean;
}

function which(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function detectBackends(): Promise<DetectedBackends> {
  const ollamaBin = which('ollama');
  let ollamaReachable = false;
  if (ollamaBin) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
      clearTimeout(timeout);
      ollamaReachable = r.ok;
    } catch {
      ollamaReachable = false;
    }
  }
  return {
    ollama: { installed: ollamaBin, reachable: ollamaReachable, baseUrl: 'http://127.0.0.1:11434' },
    openaiKey: Boolean(process.env.OPENAI_API_KEY),
    llamaServer: which('llama-server'),
    lmStudio: which('lms'),
  };
}

function platformInstallCmd(): { cmd: string; description: string } | null {
  const platform = os.platform();
  if (platform === 'darwin') {
    if (which('brew')) return { cmd: 'brew install ollama', description: 'Install Ollama via Homebrew' };
    return { cmd: 'curl -fsSL https://ollama.com/install.sh | sh', description: 'Install Ollama via the upstream shell installer' };
  }
  if (platform === 'linux') {
    return { cmd: 'curl -fsSL https://ollama.com/install.sh | sh', description: 'Install Ollama via the upstream shell installer' };
  }
  return null; // Windows: detection + recommendation only
}

function pullModel(model: string, baseUrl: string, output: CLIOutput): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Prefer the Ollama HTTP /api/pull stream so we work without the CLI
    // being on PATH at exec time. Fall back to `ollama pull` if HTTP fails.
    const url = `${baseUrl}/api/pull`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    })
      .then(async response => {
        if (!response.ok || !response.body) {
          // HTTP-pull failed; try the CLI as a fallback.
          const child = spawn('ollama', ['pull', model], { stdio: 'inherit' });
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`ollama pull ${model} exited ${code}`)));
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastStatus = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl = buffer.indexOf('\n');
          while (nl >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf('\n');
            if (!line) continue;
            try {
              const evt = JSON.parse(line) as { status?: string; error?: string };
              if (evt.error) {
                reject(new Error(`ollama pull ${model}: ${evt.error}`));
                return;
              }
              if (evt.status && evt.status !== lastStatus) {
                output.log(`  ${model}: ${evt.status}`);
                lastStatus = evt.status;
              }
            } catch {
              // Non-JSON line — ignore.
            }
          }
        }
        resolve();
      })
      .catch(reject);
  });
}

function writeMinimalConfig(projectPath: string, backend: 'ollama' | 'openai-compatible' | 'openai', output: CLIOutput): void {
  const configPath = path.join(projectPath, '.ctx-sys', 'config.yaml');
  if (fs.existsSync(configPath)) {
    output.log(`  Existing config at ${configPath} — leaving it alone (re-run with --force on init to overwrite).`);
    return;
  }
  const cfg: Record<string, unknown> = {
    project: { name: path.basename(projectPath) },
    indexing: { mode: 'incremental', watch: false, ignore: ['node_modules', '.git', '.ctx-sys', 'dist', 'build'] },
    embeddings:
      backend === 'ollama'
        ? { provider: 'ollama', model: 'mxbai-embed-large:latest' }
        : backend === 'openai-compatible'
          ? { provider: 'openai-compatible', model: 'nomic-embed-text', base_url: 'http://localhost:8080/v1' }
          : { provider: 'openai', model: 'text-embedding-3-small', api_key: '${OPENAI_API_KEY}' },
    summarization: { enabled: false, provider: backend === 'ollama' ? 'ollama' : 'openai-compatible', model: 'gemma3:270m' },
    hyde: { enabled: false, model: 'gemma3:270m' },
    retrieval: { default_max_tokens: 4000, strategies: ['vector', 'graph', 'fts'] },
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.stringify(cfg));
  output.success(`Wrote starter config at ${configPath}`);
}

export function createSetupCommand(output: CLIOutput = defaultOutput): Command {
  return new Command('setup')
    .description('v2 F2.2: one-command bootstrap (detect / install / pull models / write config / sanity check)')
    .option('-y, --yes', 'Non-interactive — accept all defaults; fail if a step needs human input', false)
    .option('--install', 'Allow auto-installing Ollama on macOS/Linux when missing (still prints the command first)', false)
    .option('--no-install', 'Never install anything; only configure existing tooling')
    .option('--backend <name>', 'Skip detection prompt — ollama | openai-compatible | openai')
    .option('--no-models', 'Set up the backend but skip model pulls')
    .option('--json', 'Emit a single JSON object summarising what setup did', false)
    .action(async (options: SetupOptions) => {
      const projectPath = process.cwd();
      const summary: {
        backend?: string;
        detected: DetectedBackends;
        actions: string[];
        modelsPulled: string[];
        doctor?: CheckResult[];
      } = { detected: await detectBackends(), actions: [], modelsPulled: [] };

      if (!options.json) {
        output.log('');
        output.log('  ctx-sys setup');
        output.log('');
      }

      // 1. Decide on a backend.
      let backend: 'ollama' | 'openai-compatible' | 'openai' = options.backend ?? (
        summary.detected.ollama.installed ? 'ollama' :
        summary.detected.openaiKey ? 'openai' :
        summary.detected.lmStudio || summary.detected.llamaServer ? 'openai-compatible' :
        'ollama'
      );
      summary.backend = backend;
      if (!options.json) output.log(`  Backend: ${backend}`);

      // 2. Install Ollama if asked + missing + a one-liner is known.
      if (backend === 'ollama' && !summary.detected.ollama.installed) {
        const installCmd = platformInstallCmd();
        if (!installCmd) {
          output.log('  Ollama not detected; this platform needs a manual install: https://ollama.com/download');
          summary.actions.push('install-recommended');
        } else if (options.install === false) {
          // commander: --no-install → options.install === false
          output.log(`  Ollama not detected; install was suppressed (--no-install). Run: ${installCmd.cmd}`);
          summary.actions.push('install-skipped');
        } else if (options.install !== true && !options.yes) {
          output.log(`  Ollama not detected. Re-run with --install to execute: ${installCmd.cmd}`);
          summary.actions.push('install-pending');
        } else {
          output.log(`  Installing Ollama: ${installCmd.cmd}`);
          try {
            execSync(installCmd.cmd, { stdio: 'inherit' });
            summary.actions.push('install-ok');
          } catch (err) {
            output.error(`  Install failed: ${(err as Error).message}`);
            summary.actions.push('install-failed');
          }
        }
      }

      // 3. Start Ollama in the background if installed and not reachable.
      const detectedAfterInstall = await detectBackends();
      if (backend === 'ollama' && detectedAfterInstall.ollama.installed && !detectedAfterInstall.ollama.reachable) {
        output.log('  Ollama installed but not running; starting `ollama serve` in the background.');
        spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
        // Give it a moment to bind.
        await new Promise(r => setTimeout(r, 1500));
        summary.actions.push('started');
      }

      // 4. Pull required models (Ollama path only — OpenAI / compatible
      //    expect the backend itself to expose the models). commander
      //    sets options.models === false when --no-models is passed.
      if (backend === 'ollama' && options.models !== false) {
        const models = ['mxbai-embed-large:latest'];
        for (const m of models) {
          output.log(`  Pulling ${m}…`);
          try {
            await pullModel(m, summary.detected.ollama.baseUrl, output);
            summary.modelsPulled.push(m);
          } catch (err) {
            output.error(`  Pull failed for ${m}: ${(err as Error).message}`);
            summary.actions.push(`pull-failed:${m}`);
          }
        }
      }

      // 5. Write config if absent.
      writeMinimalConfig(projectPath, backend, output);
      summary.actions.push('config-written');

      // 6. Sanity check — reuse the F2.2 doctor primitives directly so
      //    setup doesn't shell out to a subprocess.
      const doctorChecks: CheckResult[] = [];
      doctorChecks.push(checkNodeVersion());
      doctorChecks.push(await checkBetterSqlite3());
      doctorChecks.push(await checkSqliteVec());
      if (backend === 'ollama') {
        const ollamaResult = await checkOllamaService(summary.detected.ollama.baseUrl);
        doctorChecks.push(ollamaResult);
        doctorChecks.push(checkModel('Embedding Model', 'mxbai-embed-large:latest', ollamaResult.models, ollamaResult.status === 'ok', 'fail'));
      }
      summary.doctor = doctorChecks;

      // 7. Emit the result.
      if (options.json) {
        output.log(JSON.stringify(summary, null, 2));
      } else {
        output.log('');
        output.log('  Setup summary:');
        for (const action of summary.actions) output.log(`    - ${action}`);
        if (summary.modelsPulled.length > 0) output.log(`  Models pulled: ${summary.modelsPulled.join(', ')}`);
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

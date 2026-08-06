import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

function getChatScriptPath(): string {
  const relPath = path.join(__dirname, '..', '..', 'scripts', 'chat.py');
  if (fs.existsSync(relPath)) return relPath;
  const cwdPath = path.join(process.cwd(), 'scripts', 'chat.py');
  if (fs.existsSync(cwdPath)) return cwdPath;
  return relPath;
}

export function createStartCommand(): Command {
  return new Command('start')
    .description('Start interactive local AI chat client connected to ctx-sys MCP (MLX + Qwen3-Coder-30B)')
    .action(async () => {
      const script = getChatScriptPath();
      if (!fs.existsSync(script)) {
        console.error(`[ctx-sys] Error: Chat script not found at ${script}`);
        process.exit(1);
      }

      const pythonBin = process.env.PYTHON || 'python3';
      const cliBin = process.argv[1] || 'ctx-sys';

      const child = spawn(pythonBin, [script], {
        stdio: 'inherit',
        env: {
          ...process.env,
          CTXSYS_CLI_BIN: cliBin,
        },
      });

      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });
    });
}

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const MODEL_NAME = 'mxbai-embed-large';

function getModelsBasePath(): string {
  return process.env.CTXSYS_MODEL_PATH || path.join(process.cwd(), 'models');
}

function getScriptPath(): string {
  const relPath = path.join(__dirname, '..', '..', 'scripts', 'embed_mlx.py');
  if (fs.existsSync(relPath)) return relPath;
  const cwdPath = path.join(process.cwd(), 'scripts', 'embed_mlx.py');
  if (fs.existsSync(cwdPath)) return cwdPath;
  return relPath;
}

let mlxSupported: boolean | null = null;
let pythonBin = 'python3';
let mlxWorkerProcess: any = null;
let mlxWorkerReadLine: any = null;
let mlxPendingResolves: Array<{ resolve: (v: number[][]) => void; reject: (err: any) => void }> = [];

function cleanupWorkers(): void {
  if (mlxWorkerProcess) {
    try {
      mlxWorkerProcess.kill();
    } catch {
      // ignore
    }
    mlxWorkerProcess = null;
  }
}

process.on('exit', cleanupWorkers);
process.on('SIGINT', cleanupWorkers);
process.on('SIGTERM', cleanupWorkers);

async function checkMlxSupport(): Promise<boolean> {
  if (mlxSupported !== null) return mlxSupported;
  const script = getScriptPath();
  if (!fs.existsSync(script)) {
    throw new Error(`MLX worker script missing at ${script}`);
  }

  const candidates = [
    '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
    'python3',
  ];

  for (const bin of candidates) {
    try {
      const { stdout } = await execAsync(`"${bin}" "${script}" --check`);
      if (stdout.trim() === 'mlx') {
        pythonBin = bin;
        mlxSupported = true;
        console.error(`[ctx-sys] Enabled MLX GPU acceleration on Apple Silicon!`);
        return true;
      }
    } catch {
      // ignore candidate error
    }
  }

  mlxSupported = false;
  throw new Error(
    'MLX is not installed or supported. Run:\n' +
    '  pip install mlx mlx-embeddings\n' +
    'Also ensure Python 3 is installed on Apple Silicon.'
  );
}

async function getMlxWorker(): Promise<any> {
  if (mlxWorkerProcess) return mlxWorkerProcess;

  const script = getScriptPath();
  const { spawn } = await import('child_process');
  const readline = await import('readline');

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [script], {
      env: { ...process.env, CTXSYS_MODEL_PATH: getModelsBasePath(), TOKENIZERS_PARALLELISM: 'false' }
    });

    const rl = readline.createInterface({ input: child.stdout });
    let isReady = false;

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!isReady) {
        if (trimmed === 'READY') {
          isReady = true;
          mlxWorkerProcess = child;
          mlxWorkerReadLine = rl;
          resolve(child);
        }
        return;
      }

      const pending = mlxPendingResolves.shift();
      if (!pending) return;

      try {
        const data = JSON.parse(trimmed);
        if (data && data.error) {
          pending.reject(new Error(data.error));
        } else {
          pending.resolve(data);
        }
      } catch (err) {
        pending.reject(err);
      }
    });

    child.on('error', (err: any) => {
      if (!isReady) reject(err);
      for (const p of mlxPendingResolves) p.reject(err);
      mlxPendingResolves = [];
      mlxWorkerProcess = null;
    });

    child.on('exit', (code: number) => {
      if (!isReady) reject(new Error(`MLX worker exited before READY with code ${code}`));
      for (const p of mlxPendingResolves) p.reject(new Error(`MLX worker exited with code ${code}`));
      mlxPendingResolves = [];
      mlxWorkerProcess = null;
    });
  });
}

export async function embed(texts: string[]): Promise<number[][]> {
  await checkMlxSupport();
  const worker = await getMlxWorker();
  return new Promise((resolve, reject) => {
    mlxPendingResolves.push({ resolve, reject });
    worker.stdin.write(JSON.stringify(texts) + '\n');
  });
}

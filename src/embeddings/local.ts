import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const MODEL_NAME = 'mxbai-embed-large';
const KAGGLE_DATASET = 'coolgamerz/mxbai-embed-large';

function getModelsBasePath(): string {
  return process.env.CTXSYS_MODEL_PATH || path.join(process.cwd(), 'models');
}

function getModelDir(): string {
  return path.join(getModelsBasePath(), MODEL_NAME);
}

function modelIsReady(modelDir: string): boolean {
  const hasOnnx =
    fs.existsSync(path.join(modelDir, 'onnx', 'model.onnx')) ||
    fs.existsSync(path.join(modelDir, 'onnx', 'model_quantized.onnx')) ||
    fs.existsSync(path.join(modelDir, 'model.onnx')) ||
    fs.existsSync(path.join(modelDir, 'model.safetensors'));

  return (
    hasOnnx &&
    fs.existsSync(path.join(modelDir, 'tokenizer.json')) &&
    fs.existsSync(path.join(modelDir, 'config.json'))
  );
}

async function downloadFromKaggle(): Promise<string> {
  console.error(`[ctx-sys] Embedder not found locally.`);
  console.error(`[ctx-sys] Downloading ${KAGGLE_DATASET} from Kaggle...`);

  // Verify kagglehub is available
  try {
    await execAsync('python3 -c "import kagglehub"');
  } catch {
    throw new Error(
      'kagglehub is not installed. Run:\n' +
      '  pip install kagglehub\n' +
      'Also ensure ~/.kaggle/kaggle.json exists with your API credentials.'
    );
  }

  const { stdout, stderr } = await execAsync(
    `python3 -c "import kagglehub; print(kagglehub.dataset_download('${KAGGLE_DATASET}'))"`,
    { timeout: 600000 } // 10 minutes — Kaggle can be slow
  );

  const downloadedPath = stdout.trim();
  if (!downloadedPath || !fs.existsSync(downloadedPath)) {
    throw new Error(`Kaggle download failed: ${stderr || 'no output'}`);
  }

  console.error(`[ctx-sys] Kaggle cache: ${downloadedPath}`);
  return downloadedPath;
}

function installModelFiles(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);

    if (fs.existsSync(dst)) continue; // idempotent

    if (entry.isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  console.error(`[ctx-sys] Model installed at: ${targetDir}`);
}

async function ensureModelAvailable(): Promise<string> {
  const modelDir = getModelDir();

  if (modelIsReady(modelDir)) {
    return modelDir;
  }

  const downloadedPath = await downloadFromKaggle();

  let sourceDir = downloadedPath;
  if (!fs.existsSync(path.join(sourceDir, 'config.json'))) {
    const candidates = fs.readdirSync(sourceDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(sourceDir, e.name))
      .filter(d => fs.existsSync(path.join(d, 'config.json')));

    if (candidates.length === 0) {
      throw new Error(`Cannot find model files inside ${downloadedPath}`);
    }
    sourceDir = candidates[0];
  }

  installModelFiles(sourceDir, modelDir);

  if (!modelIsReady(modelDir)) {
    throw new Error(
      `Model installation incomplete. Missing one of: onnx/model.onnx, tokenizer.json, config.json`
    );
  }

  console.error(`[ctx-sys] Ready. Future runs use the local copy.`);
  return modelDir;
}

// Singleton cache of promises to avoid parallel re-downloads or infinite retry loops
const embedderPromises = new Map<string, Promise<any>>();

export async function embed(
  texts: string[],
  model: string = MODEL_NAME
): Promise<number[][]> {
  if (!embedderPromises.has(model)) {
    const loadPromise = (async () => {
      const modelDir = await ensureModelAvailable();

      const { pipeline, env } = await import('@xenova/transformers');

      env.allowLocalModels = true;
      env.allowRemoteModels = false; // never phone home
      env.localModelPath = getModelsBasePath(); // resolves {localModelPath}/{model}

      try {
        return await pipeline('feature-extraction', model);
      } catch (err: any) {
        throw new Error(
          `Failed to load embedder "${model}" from ${modelDir}.\n` +
          `@xenova/transformers requires ONNX weights (onnx/model_quantized.onnx or onnx/model.onnx).\n` +
          `Error: ${err.message}`
        );
      }
    })();

    // Store promise in map so concurrent or subsequent calls reuse the same initialization
    embedderPromises.set(model, loadPromise);
  }

  try {
    const embedder = await embedderPromises.get(model)!;
    const out = await embedder(texts, { pooling: 'mean', normalize: true });
    return out.tolist ? out.tolist() : out.map((o: any) => Array.from(o.data));
  } catch (err) {
    // Keep failed promise in map or remove if caller wants to re-attempt, but prevent loop per batch
    throw err;
  }
}

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

function getOnnxPath(modelDir: string): string | null {
  const candidates = [
    path.join(modelDir, 'onnx', 'model_quantized.onnx'),
    path.join(modelDir, 'onnx', 'model_fp16.onnx'),
    path.join(modelDir, 'onnx', 'model.onnx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function modelIsReady(modelDir: string): boolean {
  return (
    getOnnxPath(modelDir) !== null &&
    fs.existsSync(path.join(modelDir, 'tokenizer.json'))
  );
}

async function downloadFromKaggle(): Promise<string> {
  console.error(`[ctx-sys] Embedder not found locally.`);
  console.error(`[ctx-sys] Downloading ${KAGGLE_DATASET} from Kaggle...`);

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
    { timeout: 600000 }
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
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (fs.existsSync(dst)) continue;
    if (entry.isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  console.error(`[ctx-sys] Model files installed at: ${targetDir}`);
}

async function ensureModelAvailable(): Promise<string> {
  const modelDir = getModelDir();
  if (modelIsReady(modelDir)) return modelDir;

  if (!fs.existsSync(path.join(modelDir, 'config.json'))) {
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
  }

  if (!getOnnxPath(modelDir)) {
    const script = path.join(process.cwd(), 'scripts', 'convert-to-onnx.py');
    if (!fs.existsSync(script)) {
      throw new Error(`ONNX model missing and converter not found at ${script}.`);
    }
    console.error(`[ctx-sys] ONNX missing. Running conversion...`);
    const { stderr } = await execAsync(
      `python3 "${script}" "${modelDir}"`,
      { timeout: 300000 }
    );
    if (stderr) console.error(stderr.trim());
  }

  if (!modelIsReady(modelDir)) {
    throw new Error(`Model still incomplete after conversion. Check ${modelDir}`);
  }

  console.error(`[ctx-sys] Ready. Future runs use the local copy.`);
  return modelDir;
}

// ─── ONNX Runtime Inference ─────────────────────────────────────────

let tokenizer: any = null;
let session: any = null;

function toBigInt64Array(data: any): BigInt64Array {
  if (data instanceof BigInt64Array) return data;
  if (Array.isArray(data)) return BigInt64Array.from(data.map((x: any) => BigInt(x)));
  return BigInt64Array.from(Array.from(data).map((x: any) => BigInt(x)));
}

function meanPool(
  outputData: Float32Array,
  attentionMask: BigInt64Array,
  batchSize: number,
  seqLen: number,
  hiddenSize: number
): number[][] {
  const embeddings: number[][] = [];
  for (let b = 0; b < batchSize; b++) {
    let maskSum = 0;
    const maskOff = b * seqLen;
    for (let s = 0; s < seqLen; s++) maskSum += Number(attentionMask[maskOff + s]);

    const pooled = new Array(hiddenSize).fill(0);
    const tokOff = b * seqLen * hiddenSize;
    for (let s = 0; s < seqLen; s++) {
      const m = Number(attentionMask[maskOff + s]);
      if (!m) continue;
      for (let h = 0; h < hiddenSize; h++) {
        pooled[h] += outputData[tokOff + s * hiddenSize + h] * m;
      }
    }
    for (let h = 0; h < hiddenSize; h++) pooled[h] /= maskSum || 1;

    let norm = 0;
    for (const v of pooled) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let h = 0; h < hiddenSize; h++) pooled[h] /= norm;

    embeddings.push(pooled);
  }
  return embeddings;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const modelDir = await ensureModelAvailable();

  if (!session) {
    const ort = await import('onnxruntime-node');

    const modelPath = getOnnxPath(modelDir)!;
    console.error(`[ctx-sys] Loading ONNX session: ${path.basename(modelPath)}`);
    console.error(`[ctx-sys] This may take 2–3 minutes for large models on first load...`);

    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'basic', // 'all' is too slow for large models
    });
    console.error(`[ctx-sys] ONNX session ready.`);

    const { AutoTokenizer, env } = await import('@xenova/transformers');
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = '';

    console.error(`[ctx-sys] Loading tokenizer from ${modelDir}...`);
    tokenizer = await AutoTokenizer.from_pretrained(modelDir, { local_files_only: true });
    console.error(`[ctx-sys] Tokenizer ready.`);
  }

  const encoded = await tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: 512,
  });

  const batchSize = texts.length;
  const seqLen = encoded.input_ids.dims[1];
  const ort = await import('onnxruntime-node');

  const feeds: Record<string, any> = {
    input_ids: new ort.Tensor('int64', toBigInt64Array(encoded.input_ids.data), encoded.input_ids.dims),
    attention_mask: new ort.Tensor('int64', toBigInt64Array(encoded.attention_mask.data), encoded.attention_mask.dims),
  };
  if (encoded.token_type_ids) {
    feeds.token_type_ids = new ort.Tensor('int64', toBigInt64Array(encoded.token_type_ids.data), encoded.token_type_ids.dims);
  }

  const results = await session.run(feeds);
  const outTensor = results[session.outputNames[0]];
  const hiddenSize = outTensor.dims[2];

  return meanPool(
    outTensor.data as Float32Array,
    toBigInt64Array(encoded.attention_mask.data),
    batchSize,
    seqLen,
    hiddenSize
  );
}

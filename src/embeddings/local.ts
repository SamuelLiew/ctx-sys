import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

let mlxSupported: boolean | null = null;
let mlxWorkerProcess: any = null;
let mlxWorkerReadLine: any = null;
let mlxPendingResolves: Array<{ resolve: (v: number[][]) => void; reject: (err: any) => void }> = [];

let mpsSupported: boolean | null = null;
let pythonBin = 'python3';
let workerProcess: any = null;
let workerReadLine: any = null;
let pendingResolves: Array<{ resolve: (v: number[][]) => void; reject: (err: any) => void }> = [];

async function checkMlxSupport(): Promise<boolean> {
  if (mlxSupported !== null) return mlxSupported;
  const script = path.join(process.cwd(), 'scripts', 'embed_mlx.py');
  if (!fs.existsSync(script)) {
    mlxSupported = false;
    return false;
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
      // ignore
    }
  }

  mlxSupported = false;
  return false;
}

async function getMlxWorker(): Promise<any> {
  if (mlxWorkerProcess) return mlxWorkerProcess;

  const script = path.join(process.cwd(), 'scripts', 'embed_mlx.py');
  const { spawn } = await import('child_process');
  const readline = await import('readline');

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [script], {
      env: { ...process.env, CTXSYS_MODEL_PATH: getModelsBasePath() }
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

async function checkMpsSupport(): Promise<boolean> {
  if (mpsSupported !== null) return mpsSupported;
  const script = path.join(process.cwd(), 'scripts', 'embed.py');
  if (!fs.existsSync(script)) {
    mpsSupported = false;
    return false;
  }

  const candidates = [
    '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
    'python3',
  ];

  for (const bin of candidates) {
    try {
      const { stdout } = await execAsync(`"${bin}" "${script}" --check`);
      const mode = stdout.trim();
      if (mode === 'mps' || mode === 'cuda') {
        pythonBin = bin;
        mpsSupported = true;
        console.error(`[ctx-sys] Enabled Metal GPU acceleration (${mode.toUpperCase()}) on M1 Max!`);
        return true;
      }
    } catch {
      // ignore
    }
  }

  mpsSupported = false;
  return false;
}

async function getWorker(): Promise<any> {
  if (workerProcess) return workerProcess;

  const script = path.join(process.cwd(), 'scripts', 'embed.py');
  const { spawn } = await import('child_process');
  const readline = await import('readline');

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [script], {
      env: { ...process.env, CTXSYS_MODEL_PATH: getModelsBasePath() }
    });

    const rl = readline.createInterface({ input: child.stdout });
    let isReady = false;

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!isReady) {
        if (trimmed === 'READY') {
          isReady = true;
          workerProcess = child;
          workerReadLine = rl;
          resolve(child);
        }
        return;
      }

      const pending = pendingResolves.shift();
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
      for (const p of pendingResolves) p.reject(err);
      pendingResolves = [];
      workerProcess = null;
    });

    child.on('exit', (code: number) => {
      if (!isReady) reject(new Error(`Worker exited before READY with code ${code}`));
      for (const p of pendingResolves) p.reject(new Error(`Worker exited with code ${code}`));
      pendingResolves = [];
      workerProcess = null;
    });
  });
}

export async function embed(texts: string[]): Promise<number[][]> {
  // ─── 1. MLX (fastest native Apple Silicon path) ─────────────────────
  const useMlx = await checkMlxSupport();
  if (useMlx) {
    const worker = await getMlxWorker();
    return new Promise((resolve, reject) => {
      mlxPendingResolves.push({ resolve, reject });
      worker.stdin.write(JSON.stringify(texts) + '\n');
    });
  }

  // ─── 2. Local model needed for PyTorch / ONNX fallbacks ─────────────
  const modelDir = await ensureModelAvailable();

  // ─── 3. PyTorch MPS / CUDA (existing worker) ────────────────────────
  const useMps = await checkMpsSupport();
  if (useMps) {
    const worker = await getWorker();
    return new Promise<number[][]>((resolve, reject) => {
      pendingResolves.push({ resolve, reject });
      worker.stdin.write(JSON.stringify(texts) + '\n');
    });
  }

  if (!session) {
    const ort = await import('onnxruntime-node');

    const modelPath = getOnnxPath(modelDir)!;
    console.error(`[ctx-sys] Loading ONNX session: ${path.basename(modelPath)}`);
    console.error(`[ctx-sys] This may take 2–3 minutes for large models on first load...`);

    const epList = process.env.CTXSYS_ONNX_EP
      ? process.env.CTXSYS_ONNX_EP.split(',').map(s => s.trim())
      : ['cuda', 'cpu'];

    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: epList,
      graphOptimizationLevel: 'all',
      intraOpNumThreads: Math.max(1, os.cpus().length),
      interOpNumThreads: Math.max(1, os.cpus().length),
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

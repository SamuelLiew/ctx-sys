let embedder: any = null;

export async function embed(texts: string[]): Promise<number[][]> {
  if (!embedder) {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = true;
    env.allowRemoteModels = process.env.CTXSYS_ALLOW_REMOTE === '1';
    embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
  }
  const out = await embedder(texts, { pooling: 'mean', normalize: true });
  return out.tolist ? out.tolist() : out.map((o: any) => Array.from(o.data));
}

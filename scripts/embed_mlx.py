#!/usr/bin/env python3
"""
Fast MLX persistent embedding worker for Apple Silicon.
Reads line-delimited JSON arrays of strings from stdin,
writes line-delimited JSON arrays of float embeddings to stdout.
"""

import sys
import os

# Auto-add user site-packages if missing
user_site = os.path.expanduser("~/Library/Python/3.11/lib/python/site-packages")
if os.path.exists(user_site) and user_site not in sys.path:
    sys.path.insert(0, user_site)

import json

def check_mlx():
    try:
        import mlx.core as mx
        from mlx_embeddings.utils import load
        return True
    except ImportError:
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        print("mlx" if check_mlx() else "cpu")
        sys.exit(0)

    if not check_mlx():
        sys.stderr.write("Error: mlx or mlx-embeddings not installed\n")
        sys.exit(1)

    from mlx_embeddings.utils import load
    import mlx.core as mx

    # Use the pre-converted MLX community model, or allow override via env
    model_name = os.environ.get("CTXSYS_MLX_MODEL", "mlx-community/mxbai-embed-large-v1")

    sys.stderr.write(f"[ctx-sys] Loading MLX embedding model: {model_name}...\n")
    model, tokenizer = load(model_name)
    sys.stderr.write("[ctx-sys] MLX model ready.\n")

    sys.stdout.write("READY\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            texts = json.loads(line)

            # Batch encode directly into MLX arrays (zero-copy unified memory)
            inputs = tokenizer.batch_encode_plus(
                texts,
                return_tensors="mlx",
                padding=True,
                truncation=True,
                max_length=512
            )

            outputs = model(
                inputs["input_ids"],
                attention_mask=inputs["attention_mask"]
            )

            # For BERT-based models this is already mean-pooled + L2-normalized
            embeddings = outputs.text_embeds

            sys.stdout.write(json.dumps(embeddings.tolist()) + "\n")
            sys.stdout.flush()

        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            sys.stderr.flush()
            sys.stdout.write(json.dumps({"error": str(e)}) + "\n")
            sys.stdout.flush()

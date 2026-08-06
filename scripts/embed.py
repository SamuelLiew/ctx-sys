#!/usr/bin/env python3
"""
Fast MPS (Metal GPU) persistent embedding worker for Apple Silicon M1/M2/M3/M4 Macs.
Reads line-delimited JSON arrays of strings from stdin, writes line-delimited JSON arrays of float embeddings to stdout.
"""

import sys
import os

# Auto-add user site-packages if missing
user_site = os.path.expanduser("~/Library/Python/3.11/lib/python/site-packages")
if os.path.exists(user_site) and user_site not in sys.path:
    sys.path.insert(0, user_site)

import json
import torch
from transformers import AutoTokenizer, AutoModel

_model = None
_tokenizer = None
_device = None

function_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(function_dir)
model_base = os.environ.get("CTXSYS_MODEL_PATH") or os.path.join(project_dir, "models")
model_dir = os.path.join(model_base, "mxbai-embed-large")

def load_model():
    global _model, _tokenizer, _device
    if _model is not None:
        return

    if torch.backends.mps.is_available():
        _device = torch.device("mps")
    elif torch.cuda.is_available():
        _device = torch.device("cuda")
    else:
        _device = torch.device("cpu")

    _tokenizer = AutoTokenizer.from_pretrained(model_dir)
    _model = AutoModel.from_pretrained(model_dir).to(_device)
    _model.eval()

def embed_texts(texts):
    load_model()
    inputs = _tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors="pt").to(_device)
    with torch.no_grad():
        outputs = _model(**inputs)
        attention_mask = inputs["attention_mask"].unsqueeze(-1)
        embeddings = (outputs.last_hidden_state * attention_mask).sum(dim=1) / attention_mask.sum(dim=1).clamp(min=1e-9)
        # Normalize
        embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)

    if _device.type == "mps":
        torch.mps.synchronize()

    return embeddings.cpu().tolist()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        if torch.backends.mps.is_available():
            print("mps")
        elif torch.cuda.is_available():
            print("cuda")
        else:
            print("cpu")
        sys.exit(0)

    load_model()
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            texts = json.loads(line)
            results = embed_texts(texts)
            sys.stdout.write(json.dumps(results) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            sys.stderr.flush()
            sys.stdout.write(json.dumps({"error": str(e)}) + "\n")
            sys.stdout.flush()

#!/usr/bin/env python3
"""
Convert sentence-transformers / safetensors model to ONNX for onnxruntime-node.
Auto-installs optimum if missing.
"""

import sys
import os
import subprocess

def ensure_optimum():
    try:
        import optimum  # noqa: F401
    except ImportError:
        print("[ctx-sys] Installing optimum[onnxruntime] (one-time)...")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install",
            "optimum[onnxruntime]", "-q"
        ])

def convert(model_path: str) -> str:
    ensure_optimum()

    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from transformers import AutoTokenizer

    output_path = os.path.join(model_path, "onnx")
    os.makedirs(output_path, exist_ok=True)

    print(f"[ctx-sys] Converting {model_path} -> ONNX...")
    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = ORTModelForFeatureExtraction.from_pretrained(
        model_path,
        export=True
    )
    model.save_pretrained(output_path)
    tokenizer.save_pretrained(output_path)

    onnx_file = os.path.join(output_path, "model.onnx")
    if not os.path.exists(onnx_file):
        # optimum sometimes names it model_optimized.onnx
        for f in os.listdir(output_path):
            if f.endswith(".onnx"):
                os.rename(os.path.join(output_path, f), onnx_file)
                break

    print(f"[ctx-sys] ONNX ready: {onnx_file}")
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python convert-to-onnx.py <model_dir>")
        sys.exit(1)
    convert(sys.argv[1])

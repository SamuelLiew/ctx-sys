#!/usr/bin/env python3
"""
ctx-sys-chat — Local AI chat client that connects to ctx-sys MCP for codebase context
and runs Qwen3-Coder-30B locally via MLX.

Usage:
    cd your-project/          # must have .ctx-sys/ index already
    python3 scripts/chat.py

Requirements:
    pip install kagglehub mlx_lm mcp
    # ctx-sys must be installed: npm install -g ctx-sys (or npm link)
    # Kaggle API key: ~/.kaggle/kaggle.json
"""

import os
import sys
import asyncio
import importlib.util

os.environ["TOKENIZERS_PARALLELISM"] = "false"

# ─── Dependency guard ────────────────────────────────────────────────
def _require(*pkgs):
    missing = []
    for p in pkgs:
        spec = importlib.util.find_spec(p)
        if spec is None:
            missing.append(p)
    if missing:
        print(f"[chat] Missing packages: {missing}", file=sys.stderr)
        print(f"[chat] Run: pip install {' '.join(missing)}", file=sys.stderr)
        sys.exit(1)

_require("kagglehub", "mlx_lm", "mcp")

import kagglehub
from mlx_lm import load, generate
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# ─── Config ──────────────────────────────────────────────────────────
DATASET = "coolgamerz/qwen3-coder-30b"
CTX_SYS_CMD = os.environ.get("CTXSYS_CLI_BIN", "ctx-sys")
CTX_SYS_ARGS = ["serve"]

# ─── 1. Model check / download ───────────────────────────────────────
def ensure_model() -> str:
    """Download via kagglehub if not cached; return local path."""
    print("[chat] Checking for Qwen3-Coder-30B...", file=sys.stderr)
    path = kagglehub.dataset_download(DATASET)
    if not os.path.exists(path):
        raise RuntimeError(f"Model path missing after download: {path}")
    print(f"[chat] Model ready at: {path}", file=sys.stderr)
    return path

# ─── 2. MLX LLM wrapper ──────────────────────────────────────────────
class MLXChat:
    def __init__(self, model_path: str):
        print("[chat] Loading model into MLX (30–60s first time)...", file=sys.stderr)
        self.model, self.tokenizer = load(model_path)
        print("[chat] MLX model loaded.", file=sys.stderr)

    def generate(self, messages: list[dict], max_tokens: int = 2048, temperature: float = 0.1) -> str:
        prompt = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        return generate(
            self.model,
            self.tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            temp=temperature,
            verbose=False,
        )

# ─── 3. ctx-sys MCP context retrieval ────────────────────────────────
async def retrieve_context(session: ClientSession, query: str, max_tokens: int = 4000) -> str:
    """Call ctx-sys context_query MCP tool."""
    result = await session.call_tool(
        "context_query",
        {"query": query, "max_tokens": max_tokens, "expand": True},
    )
    texts = []
    for item in result.content:
        if getattr(item, "type", None) == "text":
            texts.append(item.text)
    return "\n\n".join(texts)

# ─── 4. Chat loop ────────────────────────────────────────────────────
SYSTEM_PROMPT = (
    "You are an expert software engineering assistant with access to the user's codebase. "
    "Use the retrieved codebase context to answer accurately. "
    "Cite file paths when referencing code. If the context doesn't contain the answer, say so."
)

async def chat_loop(session: ClientSession, llm: MLXChat):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    print("\n" + "=" * 60)
    print(" ctx-sys-chat  |  MLX + ctx-sys MCP")
    print(" Type your question, or 'exit' to quit.")
    print("=" * 60 + "\n")

    while True:
        try:
            raw_input = await asyncio.to_thread(input, "You: ")
            user_input = raw_input.strip()
        except (EOFError, KeyboardInterrupt):
            print("\n[chat] Goodbye.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "q"):
            print("[chat] Goodbye.")
            break

        # Retrieve codebase context via ctx-sys MCP
        print("[chat] Retrieving context from ctx-sys...", file=sys.stderr)
        try:
            context = await retrieve_context(session, user_input)
        except Exception as e:
            print(f"[chat] ctx-sys retrieval failed: {e}", file=sys.stderr)
            context = ""

        if context:
            print(f"[chat] Retrieved {len(context)} chars of context.", file=sys.stderr)
        else:
            print("[chat] No context found.", file=sys.stderr)

        # Build augmented prompt
        user_msg = f"""Question: {user_input}

Retrieved codebase context:
{'-' * 50}
{context or '(No relevant context found.)'}
{'-' * 50}

Answer based on the context. Be concise and cite file paths."""

        messages.append({"role": "user", "content": user_msg})

        # Generate with MLX in executor thread to prevent starving event loop
        print("[chat] Generating...", file=sys.stderr)
        response = await asyncio.to_thread(llm.generate, messages, 2048, 0.1)

        print(f"\nAssistant: {response}\n")
        messages.append({"role": "assistant", "content": response})

# ─── 5. Main ─────────────────────────────────────────────────────────
async def main():
    # Ensure model exists (downloads if needed)
    model_path = ensure_model()
    llm = MLXChat(model_path)

    # Spawn ctx-sys MCP server over stdio
    server_params = StdioServerParameters(
        command=CTX_SYS_CMD,
        args=CTX_SYS_ARGS,
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Sanity-check available tools
            tools_result = await session.list_tools()
            tool_names = [t.name for t in tools_result.tools]
            print(f"[chat] ctx-sys tools: {tool_names}", file=sys.stderr)

            if "context_query" not in tool_names:
                print(
                    "[chat] ERROR: ctx-sys does not expose 'context_query'. "
                    "Make sure you're inside a ctx-sys initialized project.",
                    file=sys.stderr,
                )
                return

            await chat_loop(session, llm)

if __name__ == "__main__":
    asyncio.run(main())

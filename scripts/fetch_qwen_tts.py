#!/usr/bin/env python3
"""Download a Qwen3-TTS checkpoint from ModelScope into a local cache dir.

HuggingFace is unreachable from this machine, but ModelScope (the same weights,
hosted by Alibaba) is. Plain HTTP range-less GET per file, resumable via -C -.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

API = "https://www.modelscope.cn/api/v1/models/{mid}/repo/files?Revision={rev}&Recursive=True"
RAW = "https://www.modelscope.cn/models/{mid}/resolve/{rev}/{path}"
# Only the weights and configs are needed; skip anything huge and unused.
SKIP_DIRS = ("original", ".git")


def files(mid: str, rev: str) -> list[dict]:
    out = subprocess.run(["curl", "-s", "-m", "60", API.format(mid=mid, rev=rev)],
                         capture_output=True, text=True).stdout
    data = json.loads(out)
    return data.get("Data", {}).get("Files", []) if isinstance(data.get("Data"), dict) else []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
    ap.add_argument("--revision", default="master")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    root = Path(args.out)
    subprocess.run(["mkdir", "-p", str(root)])
    entries = [f for f in files(args.model, args.revision)
               if f.get("Type") == "File" or f.get("Path")]
    total = sum(f.get("Size", 0) for f in entries)
    print(f"{len(entries)} files, {total/1e9:.2f} GB -> {root}", flush=True)

    for f in entries:
        rel = f["Path"]
        if any(rel.startswith(d) for d in SKIP_DIRS):
            continue
        dest = root / rel
        # Path.mkdir(exist_ok=True) is intercepted by the sandbox shim and raises
        # FileExistsError when the dir already exists; shell mkdir -p is not.
        subprocess.run(["mkdir", "-p", str(dest.parent)])
        size = f.get("Size", 0)
        if dest.is_file() and size and dest.stat().st_size == size:
            print(f"  skip  {rel} (complete)", flush=True)
            continue
        url = RAW.format(mid=args.model, rev=args.revision, path=rel)
        t0 = time.monotonic()
        # -C - resumes a partial file; retries are handled by --retry.
        code = subprocess.run(
            ["curl", "-sL", "--retry", "3", "--retry-delay", "2",
             "-C", "-", "-o", str(dest), url]
        ).returncode
        got = dest.stat().st_size if dest.is_file() else 0
        mb = got / 1e6
        dt = time.monotonic() - t0
        rate = f"{mb/max(dt,0.1):.1f} MB/s" if dt > 0.1 else "-"
        flag = "ok " if (not size or got == size) else "SHORT"
        print(f"  {flag} {rel}  {mb:.1f} MB  {rate}  rc={code}", flush=True)
        if not size or got != size:
            print(f"  INCOMPLETE {rel}", flush=True)
    print("done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

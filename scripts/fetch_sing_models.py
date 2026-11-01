#!/usr/bin/env python3
"""Fetch the singing (Seed-VC) weights from ModelScope into .models/seedvc.

HuggingFace is unreachable from this machine, so every checkpoint is pulled
from a ModelScope mirror instead. The layout here is what `sing_cover.py`
expects; nothing in this script writes outside `.models/seedvc`.

    python3 scripts/fetch_sing_models.py            # download what's missing
    python3 scripts/fetch_sing_models.py --check    # only report what's here

Model pair: seed-uvit-tat-xlsr-tiny (v1). It is the smallest Seed-VC that runs
on Apple Silicon without CUDA kernels, and it is the one the ModelScope mirror
actually carries — see benchmarks/sing-2026-10-30/ for what it can and cannot
do on singing material.
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, ".models", "seedvc")
BASE = "https://modelscope.cn/api/v1/models/{repo}/repo?Revision=master&FilePath={path}"

# (ms repo, path inside repo, local relative path, minimum plausible size)
FILES = [
    ("FireKeeper/seed-vc-v1", "Plachta/Seed-VC/DiT_uvit_tat_xlsr_ema.pth",
     "seedvc/DiT_uvit_tat_xlsr_ema.pth", 100 << 20),
    ("FireKeeper/seed-vc-v1", "Plachta/Seed-VC/config_dit_mel_seed_uvit_xlsr_tiny.yml",
     "seedvc/config_dit_mel_seed_uvit_xlsr_tiny.yml", 1 << 10),
    ("FireKeeper/seed-vc-v1", "funasr/campplus/campplus_cn_common.bin",
     "campplus/campplus_cn_common.bin", 20 << 20),
    ("facebook/wav2vec2-xls-r-300m", "config.json",
     "wav2vec2-xls-r-300m/config.json", 1 << 10),
    ("facebook/wav2vec2-xls-r-300m", "preprocessor_config.json",
     "wav2vec2-xls-r-300m/preprocessor_config.json", 100),
    ("facebook/wav2vec2-xls-r-300m", "pytorch_model.bin",
     "wav2vec2-xls-r-300m/pytorch_model.bin", 900 << 20),
    ("nv-community/bigvgan_v2_22khz_80band_256x", "config.json",
     "bigvgan/config.json", 100),
    ("nv-community/bigvgan_v2_22khz_80band_256x", "bigvgan_generator.pt",
     "bigvgan/bigvgan_generator.pt", 350 << 20),
    # tiny 模型的配置里 vocoder.type 是 hifigan，不是 bigvgan。少了这个文件
    # 会在 load_models 阶段才炸，报错离原因很远（"unknown vocoder"）。
    ("FireKeeper/seed-vc-v1", "FunAudioLLM/CosyVoice-300M/hift.pt",
     "hifigan/hift.pt", 70 << 20),
]


def size_of(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def fetch(repo: str, path: str, dest: str, minimum: int) -> None:
    """Resume-friendly download using a Range header, retried on truncation.

    ModelScope drops long connections now and then (a 1.2 GB file did stop at
    4 MB once). Each attempt resumes from whatever is already on disk, so a cut
    costs one reconnect instead of the whole file.
    """
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = BASE.format(repo=repo, path=urllib.parse.quote(path))
    for attempt in range(1, 9):
        have = size_of(dest)
        if have >= minimum:
            return
        try:
            request = urllib.request.Request(url)
            if have:
                request.add_header("Range", f"bytes={have}-")
            with urllib.request.urlopen(request, timeout=60) as response:
                resuming = have and response.status == 206
                total = int(response.headers.get("Content-Length") or 0) + (have if resuming else 0)
                done = have if resuming else 0
                step = max(total // 10, 8 << 20)
                next_report = done + step
                with open(dest, "ab" if resuming else "wb") as handle:
                    while True:
                        chunk = response.read(1 << 20)
                        if not chunk:
                            break
                        handle.write(chunk)
                        done += len(chunk)
                        if done >= next_report:
                            pct = f"{done * 100 // max(total, 1)}%"
                            print(f"    {os.path.basename(dest)} {done >> 20} MB / "
                                  f"{total >> 20} MB ({pct})", flush=True)
                            next_report = done + step
        except Exception as error:  # noqa: BLE001 - 网络错误种类多，统一重试
            print(f"    retry {attempt}: {type(error).__name__}: {error}", flush=True)
        if size_of(dest) >= minimum:
            return
        print(f"    retry {attempt}: got {size_of(dest) >> 20} MB, resuming", flush=True)
    raise SystemExit(f"incomplete after retries: {dest} is {size_of(dest)} bytes (< {minimum})")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="only report, do not download")
    parser.add_argument("--force", action="store_true", help="re-download even if present")
    args = parser.parse_args()

    missing = 0
    for repo, path, rel, minimum in FILES:
        dest = os.path.join(TARGET, rel)
        present = size_of(dest)
        ok = present >= minimum
        if ok and not args.force:
            print(f"[ok]   {rel}  {present >> 20} MB")
            continue
        if args.check:
            print(f"[miss] {rel}  ({present >> 20} MB, want >= {minimum >> 20} MB)")
            missing += 1
            continue
        print(f"[get]  {rel}  from {repo}/{path}", flush=True)
        try:
            fetch(repo, path, dest, minimum)
        except SystemExit as error:
            # 一个文件坏了不该拦住其它文件；最后汇总够不够用。
            print(f"[fail] {error}", flush=True)
            continue
        print(f"[done] {rel}  {size_of(dest) >> 20} MB", flush=True)

    if args.check and missing:
        print(f"\n{missing} file(s) missing. Run without --check to download.")
        return 1
    short = [rel for _, _, rel, minimum in FILES
             if size_of(os.path.join(TARGET, rel)) < minimum]
    if short:
        print("\nstill short: " + ", ".join(short))
        return 1
    print(f"\nweights under {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

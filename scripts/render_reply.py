#!/usr/bin/env python3
"""【已废弃，仅保留作参考】手工导出的离线桥：job.json -> 系统 TTS -> MuseTalk MLX -> result.json。

不要再按这个脚本装依赖：`research/2026-10-28/measured-verification` 已在本机实测确认，
官方 MuseTalk + PyTorch/MPS 可直接跑通（15.1 FPS），MLX 移植这条路可以整个跳过。
桌面应用现在走 `engine_bridge.py`，直接调用已跑通的 LiveTalking 引擎出片，不再需要
人工导出 job.json、再人工把 result.json 选回来。

保留原因：它演示了「任务清单 + 音频预处理 + 结果校验」的字段约定，接别的引擎时可以参考。
"""

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import uuid


class JobError(Exception):
    pass


def member(folder, name):
    path = folder / name
    if path.is_symlink():
        raise JobError("Task members must not be symbolic links: " + name)
    return path


def read_job(path):
    path = Path(path).resolve()
    if path.stat().st_size > 100_000:
        raise JobError("Manifest is too large")
    job = json.loads(path.read_text(encoding="utf-8"))
    if job.get("schema_version") != 1:
        raise JobError("Unsupported schema_version")
    try:
        uuid.UUID(job["reply_id"])
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise JobError("Invalid reply_id") from exc
    if not isinstance(job.get("text"), str) or not 0 < len(job["text"].strip()) <= 12000:
        raise JobError("Reply text must contain 1–12000 characters")
    for field, expected in [("source_video", "source.mp4"), ("audio", "speech.wav"), ("output", "reply.mp4")]:
        if job.get(field) != expected:
            raise JobError("Unexpected task filename: " + field)
    if not member(path.parent, "source.mp4").is_file():
        raise JobError("Missing source.mp4")
    return path.parent, job


def executable(name):
    found = shutil.which(name)
    if not found:
        raise JobError("Executable not found: " + name)
    return found


def run_command(argv, folder, timeout, capture=False):
    """Terminate the entire child process group on timeout or Ctrl-C."""
    with member(folder, "render.log").open("ab") as log:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE if capture else log,
                                   stderr=log, start_new_session=True)
        try:
            output, _ = process.communicate(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=3)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            raise
        if process.returncode:
            raise JobError("Command failed (exit %s), see render.log: %s" % (process.returncode, Path(argv[0]).name))
        return output


def render_command(engine, folder, weights=None, mlx_dir=None, fps=30):
    if bool(weights) == bool(mlx_dir):
        raise JobError("Specify exactly one of --weights or --mlx-dir")
    model_dir = Path(weights or mlx_dir).expanduser().resolve()
    if not model_dir.is_dir():
        raise JobError("Model directory does not exist: " + str(model_dir))
    return [engine, "--weights" if weights else "--mlx-dir", str(model_dir),
            "--audio", str(member(folder, "speech.wav")),
            "--video", str(member(folder, "source.mp4")),
            "--out", str(member(folder, "reply.pending.mp4")),
            "--fps", str(fps), "--sink", "numpy"]


def prepare_audio(folder, job, ffmpeg, voice, timeout):
    # Never reuse a stale WAV from an earlier attempt or a different edited manifest.
    text_file = member(folder, "text.txt")
    text_file.write_text(job["text"], encoding="utf-8")
    aiff = member(folder, "speech.aiff")
    wav = member(folder, "speech.wav")
    run_command(["/usr/bin/say", "-v", voice, "-f", str(text_file), "-o", str(aiff)], folder, timeout)
    run_command([ffmpeg, "-nostdin", "-v", "error", "-y", "-i", str(aiff),
                 "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)], folder, timeout)
    if not wav.is_file() or wav.stat().st_size < 100:
        raise JobError("TTS did not produce a valid audio file")


def validate_media(payload):
    kinds = {stream.get("codec_type") for stream in payload.get("streams", [])}
    try:
        duration = float(payload.get("format", {}).get("duration", 0))
    except (ValueError, TypeError) as exc:
        raise JobError("Invalid rendered duration") from exc
    if not {"audio", "video"}.issubset(kinds) or not math.isfinite(duration) or not 0 < duration <= 600:
        raise JobError("Render needs both video and audio, duration 0–600 seconds")
    return duration


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", help="job.json exported by the app")
    parser.add_argument("--prepare-only", action="store_true", help="Generate real system TTS WAV only; no lip sync")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--weights")
    group.add_argument("--mlx-dir")
    parser.add_argument("--engine", default="musetalk-mlx-offline", help="Executable path from the MLX virtualenv")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--voice", default="Tingting")
    parser.add_argument("--fps", type=int, choices=[24, 25, 30], default=30)
    parser.add_argument("--timeout", type=int, default=900, help="Maximum seconds per subprocess")
    args = parser.parse_args(argv)
    if args.timeout < 1:
        raise JobError("--timeout must be positive")
    folder, job = read_job(args.job)
    if member(folder, "result.json").exists() or member(folder, "reply.mp4").exists():
        raise JobError("Completed output already exists; export a new job instead of overwriting it")
    ffmpeg = executable(args.ffmpeg)
    command = None
    if not args.prepare_only:
        engine = executable(args.engine)
        ffprobe = executable(args.ffprobe)
        command = render_command(engine, folder, args.weights, args.mlx_dir, args.fps)
    prepare_audio(folder, job, ffmpeg, args.voice, min(args.timeout, 120))
    if args.prepare_only:
        print(json.dumps({"status": "audio_ready", "reply_id": job["reply_id"], "audio": str(folder / "speech.wav"),
                          "lip_sync": False}, ensure_ascii=False))
        return 0
    run_command(command, folder, args.timeout)
    pending = member(folder, "reply.pending.mp4")
    if not pending.is_file() or pending.stat().st_size == 0:
        raise JobError("Engine finished without an output video")
    raw = run_command([ffprobe, "-v", "error", "-show_entries", "stream=codec_type:format=duration",
                       "-of", "json", str(pending)], folder, 30, capture=True)
    duration = validate_media(json.loads(raw))
    pending.replace(member(folder, "reply.mp4"))
    result = {"schema_version": 1, "reply_id": job["reply_id"], "status": "complete",
              "video": "reply.mp4", "duration": duration, "tts": "macos-system",
              "engine": "musetalk-mlx-offline", "visual_quality_verified": False}
    temporary = member(folder, "result.pending.json")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(member(folder, "result.json"))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Cancelled; no complete result published", file=sys.stderr)
        sys.exit(130)
    except (JobError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        sys.exit(1)

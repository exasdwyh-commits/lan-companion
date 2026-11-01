#!/usr/bin/env python3
"""只读本机检查；不下载模型、不访问远程服务、不改个人设置。"""
import json
from pathlib import Path
import platform
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main():
    python = ROOT / "LiveTalking/.venv/bin/python"
    info = {
        "platform": platform.platform(), "architecture": platform.machine(),
        "tools": {name: shutil.which(name) for name in ["swift", "ffmpeg", "ffprobe", "say", "ollama"]},
        "bridge": str(ROOT / "desktop-companion/scripts/engine_bridge.py"),
        "engine_python": str(python), "engine_python_exists": python.is_file(),
        "avatar_desk_muse_1_exists": (ROOT / "LiveTalking/data/avatars/desk_muse_1").is_dir(),
        "local_services": {},
    }
    if python.is_file():
        try:
            result = subprocess.run([str(python), "-c",
                "import importlib.util,json;print(json.dumps({n:importlib.util.find_spec(n) is not None for n in ['aiohttp','aiortc','torch','cv2']}))"],
                capture_output=True, text=True, check=True, timeout=10)
            info["engine_python_modules"] = json.loads(result.stdout)
        except (ValueError, subprocess.SubprocessError) as exc:
            info["engine_python_error"] = str(exc)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for name, url in [
        ("ollama", "http://127.0.0.1:11434/v1/models"),
        ("mlx_lm", "http://127.0.0.1:8080/v1/models"),
        ("livetalking", "http://127.0.0.1:8010/api/admin/config"),
    ]:
        try:
            with opener.open(url, timeout=2) as response:
                info["local_services"][name] = {"available": True, "data": json.loads(response.read(100_000))}
        except Exception as exc:
            info["local_services"][name] = {"available": False, "reason": str(exc)}
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

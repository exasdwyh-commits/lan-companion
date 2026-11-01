#!/usr/bin/env python3
"""可选真实验收：使用已安装的本地模型，临时 DB，不触碰个人聊天记录。

在工作区根目录运行 LiveTalking/.venv/bin/python desktop-companion/scripts/verify_live.py。
会启动/停止本脚本拥有的口型引擎；已有的引擎会保留。
"""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time

from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "desktop-companion/benchmarks/fixes-2026-10-29"
sys.path.insert(0, str(ROOT / "LiveTalking"))
spec = importlib.util.spec_from_file_location("live_service", ROOT / "LiveTalking/engine/service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"llm_model": service.LLM_MODEL, "tts": service.TTS, "avatar": service.AVATAR}
    try:
        with tempfile.TemporaryDirectory(prefix="lingdesk-live-") as folder:
            service.DB = str(Path(folder) / "verification.db")
            service.CLIPS = folder
            async with TestClient(TestServer(service.make_app())) as client:
                response = await client.post("/v1/chat", json={"text": "用一句简短中文打招呼，不超过十五个字。", "session": "live-verification"})
                assert response.status == 200, await response.text()
                jid = (await response.json())["job_id"]
                deadline = time.monotonic() + 180
                while True:
                    job = await (await client.get(f"/v1/jobs/{jid}")).json()
                    if job["status"] in ("done", "failed", "cancelled"):
                        break
                    assert time.monotonic() < deadline, "真实链路超时"
                    await asyncio.sleep(.25)
                assert job["status"] == "done", job
                report["job"] = job
                media = await client.get(job["clip_url"])
                assert media.status == 200
                target = OUT / "local-chat.mp4"
                target.write_bytes(await media.read())
                probe = await service.bridge.run_process(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(target)], check=True)
                assert {s["codec_type"] for s in json.loads(probe.stdout)["streams"]} == {"audio", "video"}
                history = await (await client.get("/v1/history?session=live-verification")).json()
                assert len(history) == 1 and history[0]["reply"] == job["reply"]
                started = time.monotonic()
                hit = await service.generate(job["reply"], str(OUT / "cache-hit.mp4"), avatar=service.AVATAR,
                                             voice=service.VOICE, tts=service.TTS)
                assert hit["cache_hit"], hit
                assert (OUT / "cache-hit.mp4").read_bytes() == target.read_bytes()
                report.update(status="passed", cache_hit_seconds=round(time.monotonic() - started, 3),
                              duration=await service.bridge.probe_duration(str(target)))
    except BaseException as exc:
        report.update(status="failed", error=str(exc))
        raise
    finally:
        service.bridge.stop_launched_engine()
        (OUT / "chat-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())

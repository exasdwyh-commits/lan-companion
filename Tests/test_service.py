"""HTTP 回归使用本地模拟模型和临时数据库，不调用云 API 或加载权重。"""
import asyncio
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "LiveTalking"))
spec = importlib.util.spec_from_file_location("service_tests", ROOT / "LiveTalking/engine/service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(service, "DB", str(Path(self.temp.name) / "test.db")),
                        patch.object(service, "CLIPS", self.temp.name)]
        for p in self.patches:
            p.start()
        service.JOBS.clear(); service.TASKS.clear(); service.ACTIVE_BY_SESSION.clear()
        self.client = TestClient(TestServer(service.make_app()))
        await self.client.start_server()
    async def asyncTearDown(self):
        await self.client.close()
        for p in self.patches:
            p.stop()
        self.temp.cleanup()
    async def chat(self, text="hi", session="default"):
        response = await self.client.post("/v1/chat", json={"text": text, "session": session})
        self.assertEqual(response.status, 200)
        return (await response.json())["job_id"]
    async def wait(self, condition):
        async def poll():
            while not condition():
                await asyncio.sleep(.005)
        await asyncio.wait_for(poll(), 2)

    async def test_cancel_releases_render_and_does_not_save_reply(self):
        started, stopped = asyncio.Event(), asyncio.Event()
        async def llm(*args):
            return "reply", .01
        async def render(*args):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
        with patch.object(service, "call_llm", llm), patch.object(service, "render_clip", render):
            jid = await self.chat()
            await started.wait()
            response = await self.client.post(f"/v1/jobs/{jid}/cancel")
            self.assertEqual(response.status, 200)
            self.assertTrue(stopped.is_set())
            self.assertEqual(service.JOBS[jid]["status"], "cancelled")
            self.assertNotIn(jid, service.TASKS)
            self.assertEqual(await (await self.client.get("/v1/history")).json(), [])

    async def test_new_message_cancels_old_and_terminal_cancel_preserves_done(self):
        started, stopped = asyncio.Event(), asyncio.Event()
        async def llm(text, *args):
            return text, .01
        async def render(text, *args):
            if text == "old":
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    stopped.set()
            else:
                self.assertTrue(stopped.is_set())
                return {"seconds": .1, "cache_hit": False}
        with patch.object(service, "call_llm", llm), patch.object(service, "render_clip", render):
            old = await self.chat("old")
            await started.wait()
            current = await self.chat("new")
            await self.wait(lambda: service.JOBS[current]["status"] == "done")
            await self.client.post(f"/v1/jobs/{current}/cancel")
        self.assertEqual(service.JOBS[old]["status"], "cancelled")
        self.assertEqual(service.JOBS[current]["status"], "done")

    async def test_cancel_before_task_started_cleans_registry(self):
        service.JOBS["early"] = {"status": "queued", "session": "default"}
        service.TASKS["early"] = asyncio.create_task(asyncio.sleep(60))
        await service.cancel_job("early")
        self.assertNotIn("early", service.TASKS)

    async def test_malformed_input_rejected(self):
        for payload in [[], {"text": 5}, {"text": ""}, {"text": "x" * 2001},
                        {"text": "ok", "session": []}, {"text": "ok", "voice": {}}]:
            response = await self.client.post("/v1/chat", json=payload)
            self.assertEqual(response.status, 400, payload)
        self.assertEqual((await self.client.get("/v1/history?limit=no")).status, 400)
        response = await self.client.post("/v1/chat", data="invalid JSON", headers={"Content-Type": "application/json"})
        self.assertEqual(response.status, 400)

    async def test_history_is_scoped_to_session(self):
        conn = service.db()
        for session in ["a", "b"]:
            conn.execute("INSERT INTO chat(session,user,reply) VALUES(?,?,?)", (session, session, "reply"))
        conn.commit(); conn.close()
        rows = await (await self.client.get("/v1/history?session=a")).json()
        self.assertEqual([r["user"] for r in rows], ["a"])

    async def test_cancelled_clip_is_not_served(self):
        jid = "a" * 16
        service.JOBS[jid] = {"status": "cancelled"}
        (Path(self.temp.name) / f"{jid}.mp4").write_bytes(b"cancelled")
        self.assertEqual((await self.client.get(f"/v1/clips/{jid}.mp4")).status, 404)

    async def test_shared_renderer_serializes_gpu_jobs(self):
        running = 0
        async def generate(text, out, **kwargs):
            nonlocal running
            running += 1
            self.assertEqual(running, 1)
            await asyncio.sleep(.01)
            running -= 1
            return {"path": out, "cache_hit": False}
        with patch.object(service, "generate", generate):
            await asyncio.gather(service.render_clip("a", "1", "voice"), service.render_clip("b", "2", "voice"))


if __name__ == "__main__":
    unittest.main()

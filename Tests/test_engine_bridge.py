import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("engine_bridge_tests", ROOT / "desktop-companion/scripts/engine_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FakeSession:
    sid = "test"
    def __init__(self):
        self.posts = []
    async def post(self, path, payload):
        self.posts.append(path)


class EngineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.events = []
        self.session = FakeSession()
        self.queue = asyncio.Queue()
        self.args = SimpleNamespace(stub=False, out_dir=self.temp.name, wait_speech=1, wait_done=1)
        self.emitter = patch.object(bridge, "emit", self.events.append)
        self.emitter.start()
    async def asyncTearDown(self):
        self.emitter.stop()
        self.temp.cleanup()
    async def wait(self, condition):
        async def poll():
            while not condition():
                await asyncio.sleep(.005)
        await asyncio.wait_for(poll(), 2)
    def put(self, op, id="old", **fields):
        self.queue.put_nowait(json.dumps(dict(op=op, id=id, **fields)))

    async def test_cancel_interrupts_before_completion_and_next_job_runs(self):
        started, stopped = asyncio.Event(), asyncio.Event()
        async def render(session, text, target, *args):
            if text == "old":
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    stopped.set()
            else:
                self.assertTrue(stopped.is_set())
                Path(target).write_bytes(b"new")
        async def duration(path):
            return 1
        with patch.object(bridge, "render", render), patch.object(bridge, "probe_duration", duration):
            task = asyncio.create_task(bridge.serve(self.session, self.args, self.queue))
            self.put("render", text="old")
            await started.wait()
            self.put("cancel")
            self.put("render", "new", text="new")
            await self.wait(lambda: any(e["event"] == "done" for e in self.events))
            self.put("quit")
            await task
        self.assertIn("/interrupt_talk", self.session.posts)
        self.assertEqual([e["id"] for e in self.events if e["event"] == "done"], ["new"])
        self.assertIn({"event": "cancelled", "id": "old"}, self.events)

    async def test_late_cancel_does_not_interrupt_current_job(self):
        started = asyncio.Event()
        async def render(*args):
            started.set()
            await asyncio.Event().wait()
        with patch.object(bridge, "render", render):
            task = asyncio.create_task(bridge.serve(self.session, self.args, self.queue))
            self.put("render", "current", text="hello")
            await started.wait()
            self.put("cancel", "stale")
            self.put("ping")
            await self.wait(lambda: any(e["event"] == "pong" for e in self.events))
            self.assertEqual(self.session.posts, [])
            self.queue.put_nowait(None)
            await task
        self.assertIn("/interrupt_talk", self.session.posts)
        self.assertFalse(any(e["event"] == "done" for e in self.events))

    async def test_replacing_job_without_explicit_cancel_stops_old(self):
        started = asyncio.Event()
        async def render(*args):
            started.set()
            await asyncio.Event().wait()
        with patch.object(bridge, "render", render):
            task = asyncio.create_task(bridge.serve(self.session, self.args, self.queue))
            self.put("render", text="hello")
            await started.wait()
            self.put("render", "new", text="hello")
            await self.wait(lambda: any(e == {"event": "cancelled", "id": "old"} for e in self.events))
            self.put("quit")
            await task
        self.assertFalse(any(e["event"] == "done" for e in self.events))

    async def test_invalid_command_keeps_loop_alive(self):
        for line in ["[]", "null", "bad", '{"op":"render","text":5}']:
            self.queue.put_nowait(line)
        self.put("ping")
        self.put("quit")
        await bridge.serve(self.session, self.args, self.queue)
        self.assertEqual(sum(e["event"] == "error" for e in self.events), 4)
        self.assertTrue(any(e["event"] == "pong" for e in self.events))

    async def test_cancel_kills_local_subprocess(self):
        marker = Path(self.temp.name) / "late"
        task = asyncio.create_task(bridge.run_process([sys.executable, "-c",
            "import time,pathlib;time.sleep(.5);pathlib.Path(__import__('sys').argv[1]).write_text('bad')", str(marker)]))
        await asyncio.sleep(.1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        await asyncio.sleep(.6)
        self.assertFalse(marker.exists())

    async def test_recording_stops_when_generation_is_cancelled(self):
        class RecordingSession(FakeSession):
            async def speaking(self):
                await asyncio.Event().wait()
            state = "connected"
        session = RecordingSession()
        task = asyncio.create_task(bridge.render(session, "hello", str(Path(self.temp.name) / "reply.mp4")))
        await self.wait(lambda: "/human" in session.posts)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(session.posts.count("/record"), 2)

    async def test_stub_contains_audio_and_video(self):
        target = str(Path(self.temp.name) / "stub.mp4")
        await bridge.stub_render("hello", target)
        self.assertAlmostEqual(await bridge.probe_duration(target), 2, delta=.1)
        result = await bridge.run_process(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", target], check=True)
        self.assertEqual({s["codec_type"] for s in json.loads(result.stdout)["streams"]}, {"audio", "video"})

    def test_only_loopback_engine_urls(self):
        for url in ["http://localhost:8010", "http://127.0.0.1:8010", "http://[::1]:8010"]:
            bridge.validate_base_url(url)
        for url in ["https://example.com", "http://127.0.0.1.evil", "http://user:pw@localhost", "http://localhost?a=1"]:
            with self.assertRaises(bridge.BridgeError):
                bridge.validate_base_url(url)


class CacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("cache_tests", ROOT / "LiveTalking/clip_cache.py")
        cls.cache = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.cache)
    def test_avatar_and_voice_backend_are_isolated(self):
        cache = self.cache
        with tempfile.TemporaryDirectory() as folder, patch.object(cache, "CACHE_ROOT", folder):
            source = Path(folder) / "source.mp4"
            source.write_bytes(b"fixture" * 1000)
            cache.put("hi", "musetalk", "voice", str(source), avatar="alice", tts="saytts")
            self.assertIsNotNone(cache.get("hi", "musetalk", "voice", avatar="alice", tts="saytts"))
            self.assertIsNone(cache.get("hi", "musetalk", "voice", avatar="bob", tts="saytts"))
            self.assertIsNone(cache.get("hi", "musetalk", "voice", avatar="alice", tts="edgetts"))
    def test_modified_assets_invalidate_cache_identity(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(self.cache, "ROOT", Path(folder)):
            p = Path(folder) / "data/avatars/alice/frame.png"
            p.parent.mkdir(parents=True)
            p.write_bytes(b"before")
            before = self.cache.avatar_revision("alice")
            p.write_bytes(b"after changed")
            self.assertNotEqual(before, self.cache.avatar_revision("alice"))


if __name__ == "__main__":
    unittest.main()

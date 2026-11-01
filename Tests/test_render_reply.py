import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location("render_reply", Path(__file__).resolve().parents[1] / "scripts/render_reply.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lingdesk-test-")
        self.root = Path(self.temp.name)
        self.job = {"schema_version": 1, "reply_id": str(uuid.uuid4()), "text": "你好",
                    "source_video": "source.mp4", "audio": "speech.wav", "output": "reply.mp4"}
        (self.root / "source.mp4").write_bytes(b"fixture")

    def tearDown(self):
        self.temp.cleanup()

    def write_job(self):
        path = self.root / "job.json"
        path.write_text(json.dumps(self.job), encoding="utf-8")
        return path

    def test_valid_manifest(self):
        folder, job = bridge.read_job(self.write_job())
        self.assertEqual(folder, self.root.resolve())
        self.assertEqual(job["text"], "你好")

    def test_path_traversal_rejected(self):
        self.job["output"] = "../outside.mp4"
        with self.assertRaises(bridge.JobError):
            bridge.read_job(self.write_job())

    def test_invalid_reply_id(self):
        self.job["reply_id"] = "not-an-id"
        with self.assertRaises(bridge.JobError):
            bridge.read_job(self.write_job())

    def test_symlink_output_rejected(self):
        (self.root / "reply.pending.mp4").symlink_to(self.root / "source.mp4")
        with self.assertRaises(bridge.JobError):
            bridge.render_command("/engine", self.root, mlx_dir=str(self.root))

    def test_command_uses_arguments_not_shell(self):
        command = bridge.render_command("/path with spaces/engine", self.root, mlx_dir=str(self.root))
        self.assertEqual(command[0], "/path with spaces/engine")
        self.assertIn("--mlx-dir", command)
        self.assertEqual(command[-2:], ["--sink", "numpy"])
        self.assertIn(str(self.root / "speech.wav"), command)

    def test_weights_are_required(self):
        with self.assertRaises(bridge.JobError):
            bridge.render_command("engine", self.root)

    def test_video_requires_sound_and_finite_duration(self):
        payload = {"streams": [{"codec_type": "video"}, {"codec_type": "audio"}], "format": {"duration": "2.5"}}
        self.assertEqual(bridge.validate_media(payload), 2.5)
        for duration in ["NaN", "inf", "0", "601", "bad"]:
            payload["format"]["duration"] = duration
            with self.assertRaises(bridge.JobError):
                bridge.validate_media(payload)
        with self.assertRaises(bridge.JobError):
            bridge.validate_media({"streams": [{"codec_type": "video"}], "format": {"duration": "3"}})

    def test_existing_completed_job_not_overwritten(self):
        (self.root / "result.json").write_text("original")
        with self.assertRaises(bridge.JobError):
            bridge.main([str(self.write_job()), "--prepare-only"])
        self.assertEqual((self.root / "result.json").read_text(), "original")


if __name__ == "__main__":
    unittest.main()

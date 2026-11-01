"""Real ffmpeg pipeline regressions; model inference alone is replaced by a copier."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FF = os.environ.get('FFMPEG') or shutil.which('ffmpeg') or '/Users/exasdwyh/bin/ffmpeg'
HAS_AUDIO_DEPS = all(importlib.util.find_spec(name) is not None for name in ('numpy', 'librosa'))


class CoverPipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="cover test's-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.work = self.root / 'work'
        self.stems = self.work / 'demucs/htdemucs/in'
        self.stems.mkdir(parents=True)
        self.runner = self.root / 'sing-python'
        self.runner.write_text('#!' + sys.executable + '\n' + '''import os, shutil, sys
if sys.argv[1].endswith('/sing_seedvc.py'):
    if os.environ.get('FAIL_CONVERSION'):
        raise SystemExit(9)
    args=sys.argv[2:]
    shutil.copyfile(args[args.index('--source')+1],args[args.index('--out')+1])
else:
    os.execv(sys.executable,[sys.executable,*sys.argv[1:]])
''')
        self.runner.chmod(0o755)

    def prepare(self, seconds):
        subprocess.run([FF, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                        f'sine=frequency=220:duration={seconds}', '-ar', '44100',
                        '-ac', '1', str(self.stems / 'vocals.wav')], check=True)
        for target in (self.work / 'in.wav', self.stems / 'no_vocals.wav'):
            shutil.copyfile(self.stems / 'vocals.wav', target)

    def run_pipeline(self, **extra):
        output = self.root / 'finished song.m4a'
        env = {**os.environ, 'FFMPEG': FF, 'SING_PYTHON': str(self.runner),
               'WORK': str(self.work), 'KEEP_WORK': '1', 'SHAPE': 'none', **extra}
        result = subprocess.run(['bash', str(ROOT / 'scripts/sing_cover_file.sh'),
                                 str(self.work / 'in.wav'), str(output)],
                                cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
        return result, output

    def assert_audio(self, output):
        self.assertGreater(output.stat().st_size, 1000)
        result = subprocess.run([FF, '-v', 'error', '-i', str(output), '-f', 'null', '-'],
                                capture_output=True)
        self.assertEqual(result.returncode, 0)

    def test_completed_mix_returns_success_instead_of_probe_failure(self):
        self.prepare(.4)
        shutil.copyfile(self.stems / 'vocals.wav', self.work / 'her.wav')
        result, output = self.run_pipeline(SHAPE='studio')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_audio(output)

    def test_short_track_continues_after_duration_probe(self):
        self.prepare(.4)
        result, output = self.run_pipeline()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.work / 'her.wav').exists())
        self.assert_audio(output)

    @unittest.skipUnless(HAS_AUDIO_DEPS, 'Run with ../.venvs/sing/bin/python for long-track dependencies')
    def test_long_track_concatenates_absolute_paths_with_spaces_and_quotes(self):
        self.prepare(32)
        result, output = self.run_pipeline()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        plan = json.loads((self.work / 'chunk-plan.json').read_text())
        self.assertGreater(len(plan), 1)
        self.assertTrue(all(0 < p['duration'] <= 29 for p in plan), plan)
        self.assert_audio(output)

    def test_conversion_failure_exposes_only_structured_stage_marker(self):
        self.prepare(.4)
        result, output = self.run_pipeline(FAIL_CONVERSION='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[cover-error] stage=converting code=9', result.stderr)
        self.assertFalse(output.exists())


@unittest.skipUnless(HAS_AUDIO_DEPS, 'Run with ../.venvs/sing/bin/python for chunk-planning dependencies')
class ChunkBoundsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('cover_split', ROOT / 'scripts/split_vocals.py')
        cls.split = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.split)

    def test_every_chunk_obeys_maximum_including_short_final_tail(self):
        import numpy as np
        for total in (30, 31, 32, 33, 34, 58, 59, 60, 210):
            times = np.arange(0, total, .01)
            bounds = self.split.plan_bounds(np.ones_like(times), times, total)
            self.assertEqual(bounds[0], 0)
            self.assertEqual(bounds[-1], total)
            self.assertTrue(all(0 < b-a <= 29.001 for a,b in zip(bounds,bounds[1:])), bounds)

    def test_non_default_chunk_size_is_used_on_every_iteration(self):
        import numpy as np
        times = np.arange(0, 80, .01)
        bounds = self.split.plan_bounds(np.ones_like(times), times, 80, chunk=15)
        self.assertTrue(all(0 < b-a <= 15.001 for a,b in zip(bounds,bounds[1:])), bounds)


if __name__ == '__main__':
    unittest.main()

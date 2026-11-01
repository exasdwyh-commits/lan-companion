"""音域分析与升调推荐。

recommend() 是纯算术，永远跑；analyze()/loudest_window() 需要 pyworld 与
soundfile，环境里没有就跳过（它们用的是唱歌虚拟环境，系统 python 通常没有）。
"""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

import voice_range  # noqa: E402  - 必须在 sys.path 就位之后

HAS_AUDIO_DEPS = all(importlib.util.find_spec(name) is not None
                     for name in ('numpy', 'soundfile', 'pyworld'))


class RecommendationTests(unittest.TestCase):
    """推荐值决定整首歌（含伴奏）升多少，算错一次整首就白做。"""

    def test_male_high_tenor_gets_a_fifth_up(self):
        # 薛之谦《我好像在哪见过你》实测 p05，升 6 半音后 p50 落在 E4
        self.assertEqual(voice_range.recommend(115.2)[0], 6)

    def test_voice_already_in_female_range_stays_put(self):
        self.assertEqual(voice_range.recommend(165.0)[0], 0)
        self.assertEqual(voice_range.recommend(180.0)[0], 0)

    def test_extremes_are_clamped_so_the_backing_stays_listenable(self):
        # 低到离谱也只升 8 个半音；再高就进尖叫区，伴奏也会被拉得面目全非
        self.assertEqual(voice_range.recommend(60.0)[0], 8)
        # 女高音源不自动降调：降调是审美选择，交给用户手动设
        self.assertEqual(voice_range.recommend(400.0)[0], 0)

    def test_leading_zeros_and_missing_pitch_fall_back_to_no_shift(self):
        self.assertEqual(voice_range.recommend(0)[0], 0)
        self.assertEqual(voice_range.recommend(None)[0], 0)

    def test_reason_is_human_readable_and_mentions_the_measured_floor(self):
        steps, reason = voice_range.recommend(115.2)
        self.assertEqual(steps, 6)
        self.assertIn('115', reason)
        self.assertIn('升', reason)


@unittest.skipUnless(HAS_AUDIO_DEPS, '需要 numpy + soundfile + pyworld')
class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='voice-range-')
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def _tone(self, path, freq, seconds, gain=0.6, sr=44100):
        import numpy as np
        import soundfile as sf
        t = np.arange(int(sr * seconds)) / sr
        # 纯正弦会被 pyworld 判成清音（缺少谐波结构），加两个谐波才像人声
        wave = (np.sin(2 * np.pi * freq * t)
                + 0.5 * np.sin(2 * np.pi * 2 * freq * t)
                + 0.25 * np.sin(2 * np.pi * 3 * freq * t))
        sf.write(path, (gain * wave / 1.75).astype('float32'), sr)

    def test_analyze_reports_ordered_percentiles_around_the_tone(self):
        path = self.dir / 'tone.wav'
        self._tone(path, 200.0, 3.0)
        stats = voice_range.analyze(str(path))
        self.assertLessEqual(stats['p05'], stats['p50'])
        self.assertLessEqual(stats['p50'], stats['p90'])
        # p50 应该贴着 200Hz；harvest 对纯正弦偶尔抓到谐波，给一格容差
        self.assertAlmostEqual(stats['p50'], 200.0, delta=35.0)

    def test_silence_is_rejected_rather_than_silently_recommending_zero(self):
        import numpy as np
        import soundfile as sf
        path = self.dir / 'silence.wav'
        sf.write(path, np.zeros(44100 * 2, dtype='float32'), 44100)
        with self.assertRaises(ValueError):
            voice_range.analyze(str(path))

    def test_missing_file_is_rejected(self):
        with self.assertRaises(ValueError):
            voice_range.analyze(str(self.dir / 'nope.wav'))

    def test_loudest_window_picks_the_chorus_not_the_intro(self):
        import numpy as np
        import soundfile as sf
        sr = 44100
        quiet = 0.02 * np.sin(2 * np.pi * 200 * np.arange(sr * 3) / sr)
        loud = 0.6 * np.sin(2 * np.pi * 300 * np.arange(sr * 3) / sr)
        tail = 0.02 * np.sin(2 * np.pi * 200 * np.arange(sr * 4) / sr)
        path = self.dir / 'song.wav'
        sf.write(path, np.concatenate([quiet, loud, tail]).astype('float32'), sr)
        start = voice_range.loudest_window(str(path), 2.0)
        # 副歌在 3~6 秒，窗口起点应落在这里，不能挑到开头或结尾
        self.assertGreater(start, 1.6)
        self.assertLess(start, 5.5)

    def test_window_never_runs_past_the_end_of_a_short_file(self):
        path = self.dir / 'short.wav'
        self._tone(path, 220.0, 4.0)
        # 要 10 秒但只有 4 秒：只能从头开始，不能给出负起点
        self.assertEqual(voice_range.loudest_window(str(path), 10.0), 0.0)


if __name__ == '__main__':
    unittest.main()

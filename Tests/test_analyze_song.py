"""歌曲分析报告里那些不依赖音频的部分：调性移调、结论文案、音色档案读取。

analyze()/detect_tempo()/detect_key() 需要 librosa 与真实音频，走另一条
（用唱歌虚拟环境跑的）手工验证路径，这里不重复造音频。
"""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

import analyze_song  # noqa: E402

VOICES = ROOT / 'assets' / 'voices' / 'voices.json'


class TransposeTests(unittest.TestCase):
    """升完 K 之后是什么调，用户会照着这个去核对，不能错。"""

    def test_wraps_around_the_octave(self):
        a_sharp_minor = {'tonic': 'A#', 'mode': '小调'}
        # A# 升 6 个半音是 E，升 7 个是 F
        self.assertEqual(analyze_song.transpose_key(a_sharp_minor, 6), 'E 小调')
        self.assertEqual(analyze_song.transpose_key(a_sharp_minor, 7), 'F 小调')

    def test_full_octave_comes_back_to_the_same_key(self):
        self.assertEqual(analyze_song.transpose_key({'tonic': 'C', 'mode': '大调'}, 12), 'C 大调')

    def test_negative_shift_wraps_backwards(self):
        self.assertEqual(analyze_song.transpose_key({'tonic': 'C', 'mode': '大调'}, -1), 'B 大调')

    def test_missing_key_or_zero_shift_is_not_guessed(self):
        self.assertIsNone(analyze_song.transpose_key(None, 6))
        self.assertEqual(
            analyze_song.transpose_key({'tonic': 'C', 'mode': '大调', 'label': 'C 大调'}, 0),
            'C 大调')


class AdviceTests(unittest.TestCase):
    """结论要能对着上面的数字说清依据，而且要能判断该不该提醒。"""

    def _plan(self, **over):
        base = {'name': '磁性', 'semitones': 6, 'conflict': False,
                'span': {'song': 18.2, 'voice': None}}
        base.update(over)
        return base

    def test_every_report_starts_with_the_no_tempo_change_fact(self):
        lines = analyze_song.build_advice({'voicedRatio': 0.7}, 100, [self._plan()], None)
        self.assertEqual(len(lines), 1)
        self.assertIn('节奏和速度不用调', lines[0])

    def test_fast_song_with_a_big_shift_gets_an_optional_tempo_hint(self):
        lines = analyze_song.build_advice({'voicedRatio': 0.7}, 140, [self._plan()], None)
        self.assertTrue(any('咬字' in line for line in lines))

    def test_slow_song_gets_no_tempo_hint_even_with_a_big_shift(self):
        lines = analyze_song.build_advice({'voicedRatio': 0.7}, 90, [self._plan()], None)
        self.assertFalse(any('咬字' in line for line in lines))

    def test_conflict_names_the_voice_and_both_spans(self):
        plans = [self._plan(name='孙燕姿', semitones=1, conflict=True,
                            span={'song': 24.8, 'voice': 19.0})]
        lines = analyze_song.build_advice({'voicedRatio': 0.8}, 100, plans, None)
        hit = [line for line in lines if '孙燕姿' in line]
        self.assertEqual(len(hit), 1)
        self.assertIn('24.8', hit[0])
        self.assertIn('19.0', hit[0])

    def test_breathy_song_warns_about_shaping(self):
        lines = analyze_song.build_advice({'voicedRatio': 0.4}, 100, [], None)
        self.assertTrue(any('气声' in line for line in lines))


class VoicesManifestTests(unittest.TestCase):
    """音色档案是分析与合成的共同输入，字段缺一个就会静默退化成「通用女声」。"""

    def test_missing_file_is_empty_not_an_error(self):
        self.assertEqual(analyze_song.load_voices('/definitely/not/here.json'), [])

    def test_real_manifest_carries_ranges_and_optional_upper_bound(self):
        voices = {v['id']: v for v in analyze_song.load_voices(VOICES)}
        self.assertIn('magnetic', voices)
        self.assertIn('sunyanzi', voices)
        self.assertEqual(voices['magnetic']['lo'], 165)
        # 合成音色不设上界：跟着 f0 条件走，没有生理极限
        self.assertIsNone(voices['magnetic']['hi'])
        # 真人歌手上界是硬约束，超了会挤
        self.assertEqual(voices['sunyanzi']['hi'], 493.9)


if __name__ == '__main__':
    unittest.main()

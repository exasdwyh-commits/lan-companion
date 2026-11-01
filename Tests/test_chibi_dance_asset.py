"""Reject the observed multi-character crop regression using actual PNG alpha."""
import itertools
import json
import unittest
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def portrait_runs(image, rect):
    x, y, width, height = rect
    alpha = image.crop((x, y, x + width, y + height)).getchannel('A')
    rows = [sum(value > 100 for value in alpha.crop((0, row, width, row + 1)).getdata()) >= 5
            for row in range(height)]
    return sum(active and len(list(group)) >= 5 for active, group in itertools.groupby(rows))


class DanceAssetTests(unittest.TestCase):
    def test_current_frames_each_contain_one_complete_portrait(self):
        folder = ROOT / 'assets/whale-chibi-style-v1/dance'
        source = json.loads((folder / 'source.json').read_text())
        with Image.open(folder / source['texture']) as image:
            for frame in source['frames']:
                with self.subTest(frame=frame['name']):
                    self.assertEqual(portrait_runs(image, frame['rect']), 1)
                    self.assertGreaterEqual(frame['rect'][1], 416)

    def test_detector_rejects_actual_previous_two_row_crop(self):
        with Image.open(ROOT / 'assets/whale-chibi-style-v1/dance/atlas.png') as image:
            self.assertGreater(portrait_runs(image, [50, 30, 179, 481]), 1)


if __name__ == '__main__':
    unittest.main()

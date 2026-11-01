"""Import cleaning regressions using synthetic books only."""
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ebook', ROOT / 'MALFOY-ENGINE/lib/read-ebook.py')
ebook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ebook)
CASES = json.loads((ROOT / 'Tests/fixtures/ebook-markup.json').read_text())


class Markup(unittest.TestCase):
    def test_shared_markup_fixtures(self):
        for case in CASES:
            with self.subTest(case=case['name']):
                self.assertEqual(ebook.clean(case['raw']), case['text'])

    def test_txt_and_markdown_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            for ext in ['txt', 'md']:
                p = Path(tmp) / f'合成测试.{ext}'
                p.write_text('第一章 海边&lt;br&gt;她来了。<br />风停了。')
                self.assertEqual(ebook.read(p)['text'], '第一章 海边\n她来了。\n风停了。')

    def test_epub_real_and_escaped_tags(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'synthetic.epub'
            with zipfile.ZipFile(p, 'w') as z:
                z.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
                z.writestr('content.opf', '<package xmlns="urn:opf"><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>')
                z.writestr('chapter.xhtml', '<html><body><h1>第一章 海边</h1><p>她来了。<br/>风停了。&lt;br&gt;月亮升起。</p></body></html>')
            self.assertEqual(ebook.read(p)['text'], '第一章 海边\n她来了。\n风停了。\n月亮升起。')


if __name__ == '__main__':
    unittest.main()

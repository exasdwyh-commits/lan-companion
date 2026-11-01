import unittest, tempfile, zipfile, importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('ebook',Path(__file__).resolve().parents[1]/'MALFOY-ENGINE/lib/read-ebook.py');ebook=importlib.util.module_from_spec(spec);spec.loader.exec_module(ebook)
class Books(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_plain_encoding(self):
        for encoding in ('utf-8-sig','utf-16','gb18030'):
            p=self.root/'海边.txt';p.write_bytes('第一段。\n第二段。'.encode(encoding));self.assertEqual(ebook.read(p)['text'],'第一段。\n第二段。')
    def epub(self,href='two.xhtml'):
        p=self.root/'test.epub'
        with zipfile.ZipFile(p,'w') as z:
            z.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
            z.writestr('OEBPS/content.opf',f'<package xmlns="urn:opf"><metadata><title>海边</title></metadata><manifest><item id="a" href="one.xhtml" media-type="application/xhtml+xml"/><item id="b" href="{href}" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>')
            z.writestr('OEBPS/one.xhtml','<html><body><p>第一章。</p><script>doNotRead()</script></body></html>')
            z.writestr('OEBPS/two.xhtml','<html><body><h1>第二章。</h1><style>hidden</style></body></html>')
        return p
    def test_epub_spine_order_and_no_scripts(self):
        b=ebook.read(self.epub());self.assertEqual(b['title'],'海边');self.assertEqual(b['text'],'第二章。\n第一章。')
    def test_bad_path_and_corrupt_epub(self):
        with self.assertRaises(ValueError):ebook.read(self.epub('../../outside.xhtml'))
        p=self.root/'bad.epub';p.write_bytes(b'bad')
        with self.assertRaises(zipfile.BadZipFile):ebook.read(p)
    def test_empty_and_unsupported(self):
        p=self.root/'empty.txt';p.write_text(' ')
        with self.assertRaises(ValueError):ebook.read(p)
        with self.assertRaises(ValueError):ebook.read(self.root/'scan.pdf')
    def test_title_from_text_and_front_matter_stripped(self):
        # 下载站的 TXT：文件名带发布号，开头一整块元信息。书名要取正文里的，
        # 元信息行不能被当成第一段念出来。
        p=self.root/'爱如灰烬-178348275950.txt'
        p.write_text('书名：爱如灰烬\n作者：谓景梨梨\n分类：甜宠\n\n　　第一段正文。\n　　第二段正文。\n',encoding='utf-8')
        book=ebook.read(p)
        self.assertEqual(book['title'],'爱如灰烬')
        self.assertEqual(book['text'],'第一段正文。\n第二段正文。')
    def test_front_matter_only_stripped_at_the_top(self):
        # 正文里的「作者：」不是元信息，不能动
        p=self.root/'novel.txt'
        p.write_text('第一段。\n作者：某人说\n',encoding='utf-8')
        self.assertEqual(ebook.read(p)['text'],'第一段。\n作者：某人说')
        self.assertEqual(ebook.read(p)['title'],'novel','没有书名行就退回文件名，剥掉的是纯数字后缀')
if __name__=='__main__':unittest.main()

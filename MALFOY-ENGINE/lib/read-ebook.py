#!/usr/bin/env python3
"""Read local text/EPUB without executing HTML or extracting archive files.

输出的是「干净正文」：URL、图片说明、页脚页码、目录行、脚注标记、重复页眉、
纯符号行都会被剥掉，硬换行的 TXT 会被还原成自然段落。
读音与分段不在这里做 —— 交给 lib/narration.js。
"""
import json, os, re, sys, zipfile, posixpath
from pathlib import Path
from html.parser import HTMLParser
from html import unescape
import xml.etree.ElementTree as ET

MAX_TEXT = 2000000

# EPUB 里这些容器不属于正文
SKIP_TAGS = {'script', 'style', 'head', 'nav', 'svg', 'sup', 'sub', 'figure', 'figcaption'}
BLOCK_TAGS = {'p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'section',
              'blockquote', 'tr', 'td', 'article', 'aside', 'header', 'footer', 'hr'}

URL_RE = re.compile(r'(?:https?://|ftp://|www\.)\S+', re.I)
MAIL_RE = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
MD_IMG_RE = re.compile(r'!\[[^\]]*\]\([^)]*\)')
MD_LINK_RE = re.compile(r'\[([^\]]*)\]\([^)]*\)')
PAGE_RE = re.compile(r'^[\s\-—–·*]*\d{1,4}[\s\-—–·*]*$')
PAGE_CN_RE = re.compile(r'^第\s*\d{1,4}\s*页$|^\d{1,4}\s*/\s*\d{1,4}$')
TOC_RE = re.compile(r'^.{0,60}?(?:[.．·…—]{2,}|\s{3,})\s*\d{1,4}\s*$')
FIG_RE = re.compile(
    r'^(?:图|圖|表|插图|插圖|附图|附圖|图版|Figure|Fig\.?|Illustration|Image|Table)\s*'
    r'[\d一二三四五六七八九十IVXivx]+(?:[-—–.．]\d+)*\s*[:：.]?', re.I)
FOOT_LINE_RE = re.compile(r'^\s*[\[\(【（]\s*(?:注|註|Note|Footnote)?\s*\d{1,3}\s*[\]\)】）]\s*')
FOOT_INLINE_RE = re.compile(r'[\[［【]\s*(?:注|註)?\s*\d{1,3}\s*[\]］】]')
# 链接被挖掉之后剩下的「参见。」「详见。」读出来毫无意义
DANGLING_RE = re.compile(
    r'^(?:更多内容见|延伸阅读|详见|参见|参阅|点击|访问|跳转|见)\s*'
    r'(?:文献|原文|附录|注释|註釋|链接|說明|说明|本书|上文|下文)?\s*[。，.,]?$')
CJK = re.compile(r'[\u3400-\u9fff\u3040-\u30ffA-Za-z0-9]')
# 书名优先从正文取：下载来的 TXT 常带发布号后缀，文件名不能直接当书名
META_TITLE_RE = re.compile(r'^\s*(?:书名|書名|title)\s*[:：]\s*(.+?)\s*$', re.I)
DUP_SUFFIX_RE = re.compile(r'[-_ ]\d{6,}$')
SENT_END = '。！？…!?"”」』）)】~～'
ZERO_WIDTH = dict.fromkeys(map(ord, '\u200b\u200c\u200d\u2060\ufeff\u00ad'), None)


class Text(HTMLParser):
    """把 XHTML 拍平成文本行。外链与脚注锚点文字不进正文。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
        self.anchor_skip = []

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self.skip += 1
            return
        if tag == 'a':
            href = dict(attrs).get('href') or ''
            external = bool(re.match(r'\s*(?:https?:|ftp:|mailto:)', href, re.I))
            self.anchor_skip.append(external or href.startswith('#'))
            return
        if tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_startendtag(self, tag, attrs):
        if tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if tag == 'a':
            if self.anchor_skip:
                self.anchor_skip.pop()
            return
        if tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_data(self, data):
        if self.skip or any(self.anchor_skip):
            return
        self.parts.append(data)


def _unwrap_archive(ext, path):
    """返回 (title, 各章节原始文本)。"""
    if ext != '.epub':
        raw = path.read_bytes()
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = raw.decode('utf-16') if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else raw.decode('gb18030')
        return path.stem, [text]
    with zipfile.ZipFile(path) as z:
        if sum(i.file_size for i in z.infolist()) > 20 << 20:
            raise ValueError('EPUB 解压内容超过 20MB。')

        def entry(name):
            name = posixpath.normpath(name)
            if name.startswith(('../', '/')):
                raise ValueError('EPUB 路径无效。')
            info = z.getinfo(name)
            if info.file_size > 8 << 20 or info.flag_bits & 1:
                raise ValueError('不支持加密或过大的 EPUB 章节。')
            return z.read(info)

        root = ET.fromstring(entry('META-INF/container.xml'))
        opf = next(e.attrib['full-path'] for e in root.iter() if e.tag.endswith('rootfile'))
        package = ET.fromstring(entry(opf))
        base = posixpath.dirname(opf)
        title = path.stem
        titles = [e.text for e in package.iter() if e.tag.endswith('}title') and e.text]
        if titles:
            title = titles[0]
        manifest = {e.attrib['id']: e.attrib for e in package.iter()
                    if e.tag.endswith('}item') and 'id' in e.attrib}
        from urllib.parse import unquote
        chapters = []
        for e in package.iter():
            if not e.tag.endswith('}itemref') or e.attrib.get('linear') == 'no':
                continue
            item = manifest.get(e.attrib.get('idref'), {})
            if item.get('media-type') not in ('application/xhtml+xml', 'text/html'):
                continue
            parser = Text()
            parser.feed(entry(posixpath.join(base, unquote(item['href'].split('#')[0]))).decode('utf-8-sig'))
            chapters.append(''.join(parser.parts))
        return title, chapters


def _drop_lines(lines, epub):
    """行级过滤：页码、目录、图注、脚注、重复页眉页脚、无正文字符的行。"""
    # 先统计：两次以上出现的短行 + 只含数字的行，多半是版式噪音
    tally = {}
    for line in lines:
        if len(line) <= 30:
            tally[line] = tally.get(line, 0) + 1
    bare_number_lines = {line for line in lines if PAGE_RE.match(line)}
    drop_numbers = len(bare_number_lines) >= 2

    kept = []
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if drop_numbers and PAGE_RE.match(s):
            continue
        if PAGE_CN_RE.match(s) or TOC_RE.match(s):
            continue
        if len(s) <= 60 and FIG_RE.match(s):
            continue
        if DANGLING_RE.match(s):
            continue
        if FOOT_LINE_RE.match(s):
            s = FOOT_LINE_RE.sub('', s).strip()
            if not s:
                continue
        # 重复页眉页脚：EPUB 常见，且这类行通常不带句末标点
        if epub and tally.get(s, 0) >= 4 and len(s) <= 30 and not s.endswith(tuple(SENT_END)):
            continue
        if not CJK.search(s):
            continue
        kept.append(s)
    return kept


def _merge_hard_wraps(lines):
    """把「每 40 字硬换行」的 TXT 还原成自然段：上一行没说完就接上。"""
    if len(lines) < 8:
        return lines
    widths = [len(s) for s in lines]
    narrow = sum(1 for w in widths if 30 <= w <= 50)
    if narrow / len(widths) < 0.32:
        return lines
    merged, buf = [], ''
    for line in lines:
        # 章节标题、署名这类短行自成一节，别和正文粘成一条
        if len(line) < 15:
            if buf:
                merged.append(buf)
                buf = ''
            merged.append(line)
            continue
        buf += line
        if line.endswith(tuple(SENT_END)) or len(buf) >= 400:
            merged.append(buf)
            buf = ''
    if buf:
        merged.append(buf)
    return merged


def clean(raw, epub=False):
    text = raw.replace('\x00', '').translate(ZERO_WIDTH).replace('\r\n', '\n').replace('\r', '\n')
    # TXT/Markdown can contain copied HTML too. Decode markup before line
    # filtering so <br> becomes a boundary rather than surviving as spoken "br".
    # EPUB's first parse also leaves escaped &lt;br&gt; as literal markup.
    for _ in range(4):
        decoded = unescape(text)
        if decoded == text:
            break
        text = decoded
    parser = Text()
    parser.feed(text)
    parser.close()
    text = ''.join(parser.parts).replace('\xa0', ' ')
    text = MD_IMG_RE.sub('', text)
    text = MD_LINK_RE.sub(r'\1', text)
    text = URL_RE.sub('', text)
    text = MAIL_RE.sub('', text)
    text = FOOT_INLINE_RE.sub('', text)
    # 挖掉链接/脚注后留下的空括号、标点前的悬空空格
    text = re.sub(r'[\(（\[【]\s*[\)）\]】]', '', text)
    text = re.sub(r'[ \t\u3000]+([。，、；：！？])', r'\1', text)
    text = re.sub(r'[ \t\u3000]+', ' ', text)

    lines = [line.strip(' \t\u3000') for line in text.split('\n')]
    lines = _drop_lines(lines, epub)
    if not epub:
        lines = _merge_hard_wraps(lines)
    out = '\n'.join(lines)
    out = re.sub(r'\n{3,}', '\n\n', out)
    return out.strip()


# 下载站文本开头常有一整块「书名／作者／分类／来源节选」。这些行留着会被念出来，
# 「书名：爱如灰烬」当第一段朗读非常出戏，所以在最前面连着剥掉。
FRONT_KEYS = ('书名', '書名', '作者', '分类', '分類', '类型', '類型', '标签', '標籤',
              '状态', '狀態', '字数', '字數', '来源', '來源', '简介', '簡介',
              'ID', 'id', '命中', '更新', '简介')
FRONT_RE = re.compile(r'^\s*(?:' + '|'.join(FRONT_KEYS) + r')\s*[:：]')


def _strip_front_matter(text):
    """只在最开头剥元信息，遇到第一行正文就停 —— 正文里出现「作者：」不能动。"""
    lines = text.split('\n')
    i = 0
    while i < len(lines) and i < 16:
        line = lines[i]
        if FRONT_RE.match(line):
            i += 1
            continue
        if not line.strip() and i < 3:
            i += 1
            continue
        break
    return '\n'.join(lines[i:]).strip()


def _better_title(text, fallback):
    """书名优先从正文取。

    TXT 的书名只能来自文件名，而下载来的文件常带发布号（「爱如灰烬-178348275950」），
    直接当书名又长又没法认。正文开头往往有「书名：」，有就用它；
    没有才退回文件名，并把纯数字后缀剥掉。
    """
    for line in text.splitlines()[:12]:
        hit = META_TITLE_RE.match(line)
        if hit:
            cand = hit.group(1).strip().strip('《》').strip()
            if 0 < len(cand) <= 60:
                return cand
    stem = DUP_SUFFIX_RE.sub('', str(fallback)).strip()
    return stem or str(fallback)


def read(file):
    path = Path(file)
    ext = path.suffix.lower()
    if ext not in ('.txt', '.md', '.epub'):
        raise ValueError('支持 TXT、Markdown 和 EPUB 文本电子书。')
    limit = 50 << 20 if ext == '.epub' else 8 << 20
    if path.stat().st_size > limit:
        raise ValueError('电子书太大：文本上限 8MB，EPUB 上限 50MB。')

    title, chapters = _unwrap_archive(ext, path)
    epub = ext == '.epub'
    parts, size = [], 0
    for chapter in chapters:
        part = clean(chapter, epub)
        if not part:
            continue
        size += len(part)
        if size > MAX_TEXT:
            raise ValueError('电子书超过 200 万字，请分卷打开。')
        parts.append(part)
    text = '\n'.join(parts).strip()
    if not text:
        raise ValueError('没有读到文字；扫描版或 DRM 电子书暂不支持。')
    title = _better_title(text, title)
    text = _strip_front_matter(text)
    if not text:
        raise ValueError('没有读到文字；扫描版或 DRM 电子书暂不支持。')
    return {'title': str(title)[:100], 'text': text}


if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, **read(sys.argv[1])}, ensure_ascii=False))
    except Exception as e:
        msg = str(e) if isinstance(e, (ValueError, UnicodeError)) else '无法打开电子书，请检查文件格式或是否加密。'
        print(json.dumps({'ok': False, 'error': msg}, ensure_ascii=False))
        sys.exit(1)

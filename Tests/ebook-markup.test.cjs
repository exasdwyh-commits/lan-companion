const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../MALFOY-ENGINE/lib/narration');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ebook-markup.json')));

test('reading markup becomes text before speech punctuation cleanup', () => {
  const { ebookText } = require('../MALFOY-ENGINE/lib/ebook-text');
  for (const item of cases) assert.equal(ebookText(item.raw), item.text, item.name);
});

for (const mode of ['live', 'studio']) test(`${mode} pasted markup preserves paragraphs and chapter headings`, () => {
  const raw = '<h2>第一章 海边</h2>她来了。&lt;br/&gt;风停了。<BR />月亮升起。';
  const book = N.buildBook(raw, { mode });
  assert.deepEqual(book.paragraphs.map(p => p.text), ['第一章 海边', '她来了。', '风停了。', '月亮升起。']);
  assert.equal(book.chapters[0].title, '第一章 海边');
  const spoken = book.paragraphs.flatMap(p => p.segments.map(s => s.say)).join('');
  assert.doesNotMatch(spoken, /\bbr\b|lt;|gt;|amp;/i);
  assert.match(spoken, /她来了。风停了。月亮升起。/);
});

test('direct speech cleanup removes whole tags instead of leaving tag names', () => {
  assert.equal(N.toSpeech('她来了。<br/>风停了。'), '她来了。 风停了。');
  assert.equal(N.toSpeech('她来了。&lt;br&gt;风停了。'), '她来了。 风停了。');
  assert.equal(N.toSpeech('bravo 和 BRCA1'), 'bravo 和 BRCA1');
});

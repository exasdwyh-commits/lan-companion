"use strict";

// Plain-text extraction for pasted ebook HTML. This does not render HTML and
// is not an HTML security sanitizer. Imported files use Python's HTMLParser.
const BLOCKS = new Set(['p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'section', 'blockquote', 'tr', 'td', 'article', 'aside', 'header', 'footer', 'hr']);
const SKIP = new Set(['script', 'style', 'head', 'nav', 'svg', 'sup', 'sub', 'figure', 'figcaption']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ',
  ensp: ' ', emsp: ' ', thinsp: ' ', newline: '\n', tab: '\t',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–' };

function decodeEntities(text) {
  // Bound repeated decoding for copied &amp;lt;br&amp;gt; without an open-ended loop.
  for (let i = 0; i < 4; i++) {
    const next = text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw, name) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? raw;
      const hex = /^#x/i.test(name);
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : '\ufffd';
    });
    if (next === text) break;
    text = next;
  }
  return text;
}

function ebookText(input) {
  const text = decodeEntities(String(input ?? '')).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  // Quoted > characters belong to attributes, not to the tag terminator.
  const tags = /<!--[\s\S]*?(?:-->|$)|<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  const parts = [], skipped = [];
  let cursor = 0, match;
  while ((match = tags.exec(text))) {
    if (!skipped.length) parts.push(text.slice(cursor, match.index));
    cursor = tags.lastIndex;
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    const closing = /^<\//.test(match[0]);
    const selfClosing = /\/\s*>$/.test(match[0]) || VOID.has(tag);
    if (SKIP.has(tag)) {
      if (closing) {
        const index = skipped.lastIndexOf(tag);
        if (index >= 0) skipped.splice(index);
      } else if (!selfClosing) skipped.push(tag);
    } else if (!skipped.length && BLOCKS.has(tag)) parts.push('\n');
  }
  if (!skipped.length) parts.push(text.slice(cursor));
  return parts.join('').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

module.exports = { ebookText };

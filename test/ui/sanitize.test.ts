import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, htmlToText } from '../../src/ui/sanitize';

test('removes script blocks with their content', () => {
  const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
  assert.equal(out, '<p>ok</p>');
});

test('removes style and iframe blocks', () => {
  const out = sanitizeHtml('<style>body{}</style><iframe src="x"></iframe><p>keep</p>');
  assert.equal(out, '<p>keep</p>');
});

test('strips inline event handler attributes', () => {
  const out = sanitizeHtml('<img src="x" onerror="alert(1)" />');
  assert.ok(!/onerror/i.test(out));
  assert.ok(out.includes('src="x"'));
});

test('neutralizes javascript: URLs', () => {
  const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
  assert.ok(!/javascript:/i.test(out));
});

test('keeps safe formatting markup intact', () => {
  const html = '<h2>Why</h2><p>Use <code>try</code>-with-resources.</p><pre>code()</pre>';
  assert.equal(sanitizeHtml(html), html);
});

test('handles empty/non-string-ish input gracefully', () => {
  assert.equal(sanitizeHtml(''), '');
});

test('htmlToText strips tags and collapses whitespace', () => {
  const out = htmlToText('<h2>Why</h2>\n<p>Use <code>try</code>  it.</p>');
  assert.equal(out, 'Why Use try it.');
});

test('htmlToText removes script content entirely', () => {
  const out = htmlToText('<p>ok</p><script>alert(1)</script>');
  assert.equal(out, 'ok');
});

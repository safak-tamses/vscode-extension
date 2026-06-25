import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixContext } from '../../src/fix/context';
import type { SonarIssue } from '../../src/sonar/types';

const fileText = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');

function issueAt(startLine: number, endLine = startLine): SonarIssue {
  return {
    key: 'k',
    rule: 'java:S2095',
    severity: 'MAJOR',
    type: 'BUG',
    component: 'proj:src/A.java',
    project: 'proj',
    line: startLine,
    message: 'Use try-with-resources',
    status: 'OPEN',
    textRange: { startLine, endLine, startOffset: 0, endOffset: 3 }
  };
}

test('extracts a snippet padded around the issue range', () => {
  const ctx = buildFixContext(issueAt(10), 'Kuralın açıklaması', fileText, 3);

  assert.equal(ctx.startLine, 7);
  assert.equal(ctx.endLine, 13);
  assert.equal(ctx.snippet, 'line7\nline8\nline9\nline10\nline11\nline12\nline13');
});

test('clamps the snippet to the start of the file', () => {
  const ctx = buildFixContext(issueAt(1), 'd', fileText, 3);
  assert.equal(ctx.startLine, 1);
  assert.equal(ctx.endLine, 4);
});

test('clamps the snippet to the end of the file', () => {
  const ctx = buildFixContext(issueAt(20), 'd', fileText, 3);
  assert.equal(ctx.startLine, 17);
  assert.equal(ctx.endLine, 20);
});

test('prompt includes the message, rule description and the snippet', () => {
  const ctx = buildFixContext(issueAt(10), 'Kaynaklar kapatılmalı', fileText, 2);
  assert.match(ctx.prompt, /Use try-with-resources/);
  assert.match(ctx.prompt, /Kaynaklar kapatılmalı/);
  assert.ok(ctx.prompt.includes('line10'));
  assert.match(ctx.prompt, /GEREKÇE/);
});

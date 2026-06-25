import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixResponse } from '../../src/fix/parse';

test('parses fenced code block and RATIONALE section', () => {
  const raw = 'İşte düzeltme:\n```java\nfoo();\nbar();\n```\nRATIONALE: closes the resource.';
  const result = parseFixResponse(raw);
  assert.equal(result.newCode, 'foo();\nbar();');
  assert.match(result.rationale, /closes the resource/);
});

test('supports Turkish GEREKÇE marker', () => {
  const raw = '```java\nx();\n```\nGEREKÇE: kaynak kapatıldı, S2095 kapanır.';
  const result = parseFixResponse(raw);
  assert.equal(result.newCode, 'x();');
  assert.match(result.rationale, /kaynak kapatıldı/);
});

test('no fence yields empty newCode and full text as rationale', () => {
  const result = parseFixResponse('Bu bulguyu otomatik düzeltemiyorum.');
  assert.equal(result.newCode, '');
  assert.match(result.rationale, /düzeltemiyorum/);
});

test('rationale falls back to text after the code block when no marker', () => {
  const raw = '```java\nx();\n```\nBu değişiklik kaynağı kapatır.';
  const result = parseFixResponse(raw);
  assert.equal(result.newCode, 'x();');
  assert.match(result.rationale, /kaynağı kapatır/);
});

test('trims trailing newlines from the captured code', () => {
  const raw = '```\na();\nb();\n\n```\nGEREKÇE: x';
  const result = parseFixResponse(raw);
  assert.equal(result.newCode, 'a();\nb();');
});

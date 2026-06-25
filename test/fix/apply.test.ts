import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spliceLines } from '../../src/fix/apply';

test('replaces an inclusive line range with new code', () => {
  const file = 'a\nb\nc\nd\ne';
  const out = spliceLines(file, 2, 3, 'X\nY');
  assert.equal(out, 'a\nX\nY\nd\ne');
});

test('replaces a single line', () => {
  const file = 'a\nb\nc';
  assert.equal(spliceLines(file, 2, 2, 'B'), 'a\nB\nc');
});

test('replaces the first line preserving the rest', () => {
  const file = 'a\nb\nc';
  assert.equal(spliceLines(file, 1, 1, 'A'), 'A\nb\nc');
});

test('replaces the last line preserving the rest', () => {
  const file = 'a\nb\nc';
  assert.equal(spliceLines(file, 3, 3, 'C'), 'a\nb\nC');
});

test('multi-line replacement collapsing several lines into fewer', () => {
  const file = 'a\nb\nc\nd';
  assert.equal(spliceLines(file, 2, 3, 'ONE'), 'a\nONE\nd');
});

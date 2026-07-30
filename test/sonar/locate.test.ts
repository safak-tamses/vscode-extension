import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseName,
  isAbsolutePath,
  normalizeRelPath,
  pickBestSuffixMatch,
  relativeToRoot
} from '../../src/sonar/locate';

// ------------------------------------------------------------------ isAbsolutePath

test('isAbsolutePath recognises POSIX, Windows drive and UNC paths', () => {
  assert.equal(isAbsolutePath('/Users/ben/proje'), true);
  assert.equal(isAbsolutePath('C:\\projeler\\backend'), true);
  assert.equal(isAbsolutePath('c:/projeler/backend'), true);
  assert.equal(isAbsolutePath('\\\\sunucu\\pay\\proje'), true);
});

test('isAbsolutePath rejects relative and empty paths', () => {
  assert.equal(isAbsolutePath('backend'), false);
  assert.equal(isAbsolutePath('./backend/src'), false);
  assert.equal(isAbsolutePath('../backend'), false);
  assert.equal(isAbsolutePath(''), false);
  assert.equal(isAbsolutePath('   '), false);
});

// ---------------------------------------------------------------- normalizeRelPath

test('normalizeRelPath splits on both separators and drops empty/dot segments', () => {
  assert.deepEqual(normalizeRelPath('./src//main/java/Foo.java'), ['src', 'main', 'java', 'Foo.java']);
  assert.deepEqual(normalizeRelPath('src\\main\\java\\Foo.java'), ['src', 'main', 'java', 'Foo.java']);
  assert.deepEqual(normalizeRelPath(''), []);
});

test('normalizeRelPath keeps .. segments for the caller to reject', () => {
  assert.deepEqual(normalizeRelPath('../gizli/Foo.java'), ['..', 'gizli', 'Foo.java']);
});

test('baseName returns the last segment', () => {
  assert.equal(baseName('src/main/java/com/Foo.java'), 'Foo.java');
  assert.equal(baseName('Foo.java'), 'Foo.java');
  assert.equal(baseName(''), '');
});

// ------------------------------------------------------------- pickBestSuffixMatch

test('pickBestSuffixMatch returns the only candidate that matches', () => {
  const best = pickBestSuffixMatch('src/main/java/com/Foo.java', [
    '/w/backend/src/main/java/com/Foo.java',
    '/w/frontend/src/index.ts'
  ]);
  assert.equal(best, '/w/backend/src/main/java/com/Foo.java');
});

test('pickBestSuffixMatch prefers the candidate sharing the longest suffix', () => {
  const best = pickBestSuffixMatch('src/main/java/com/Foo.java', [
    '/w/other/com/Foo.java',
    '/w/backend/src/main/java/com/Foo.java'
  ]);
  assert.equal(best, '/w/backend/src/main/java/com/Foo.java');
});

test('pickBestSuffixMatch gives up when two candidates tie', () => {
  const best = pickBestSuffixMatch('src/main/java/com/Foo.java', [
    '/w/a/src/main/java/com/Foo.java',
    '/w/b/src/main/java/com/Foo.java'
  ]);
  assert.equal(best, undefined);
});

test('pickBestSuffixMatch returns undefined without candidates or matches', () => {
  assert.equal(pickBestSuffixMatch('src/Foo.java', []), undefined);
  assert.equal(pickBestSuffixMatch('src/Foo.java', ['/w/Bar.java']), undefined);
  assert.equal(pickBestSuffixMatch('', ['/w/Foo.java']), undefined);
});

test('pickBestSuffixMatch tolerates Windows separators in candidates', () => {
  const best = pickBestSuffixMatch('src/main/java/Foo.java', ['C:\\w\\backend\\src\\main\\java\\Foo.java']);
  assert.equal(best, 'C:\\w\\backend\\src\\main\\java\\Foo.java');
});

// ----------------------------------------------------------------- relativeToRoot

test('relativeToRoot returns a relative path for folders inside the workspace', () => {
  assert.equal(relativeToRoot('/w/mono', '/w/mono/backend/api'), 'backend/api');
});

test('relativeToRoot returns an empty string when the root itself is chosen', () => {
  assert.equal(relativeToRoot('/w/mono', '/w/mono'), '');
});

test('relativeToRoot keeps the absolute path for folders outside the workspace', () => {
  assert.equal(relativeToRoot('/w/mono', '/other/backend'), '/other/backend');
});

test('relativeToRoot does not treat a sibling with a shared prefix as inside', () => {
  assert.equal(relativeToRoot('/w/mono', '/w/mono-eski/backend'), '/w/mono-eski/backend');
});

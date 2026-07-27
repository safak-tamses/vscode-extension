import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, isIncluded, matchAny, matchGlob, normalizePath } from '../../src/coverage/glob';

test('normalizePath makes Windows and relative paths comparable', () => {
  assert.equal(normalizePath('src\\main\\java\\A.java'), 'src/main/java/A.java');
  assert.equal(normalizePath('./src/main/java/A.java'), 'src/main/java/A.java');
  assert.equal(normalizePath('/src//main/java/A.java'), 'src/main/java/A.java');
});

test('** spans zero or more directory levels', () => {
  assert.ok(matchGlob('**/target/site/jacoco/jacoco.xml', 'target/site/jacoco/jacoco.xml'));
  assert.ok(
    matchGlob('**/target/site/jacoco/jacoco.xml', 'modules/order-service/target/site/jacoco/jacoco.xml')
  );
  assert.ok(!matchGlob('**/target/site/jacoco/jacoco.xml', 'target/site/jacoco/jacoco.csv'));
});

test('* stays inside a single path segment', () => {
  assert.ok(matchGlob('src/main/java/*.java', 'src/main/java/A.java'));
  assert.ok(!matchGlob('src/main/java/*.java', 'src/main/java/com/A.java'));
  assert.ok(matchGlob('**/*Application.java', 'src/main/java/com/x/DemoApplication.java'));
  assert.ok(!matchGlob('**/*Application.java', 'src/main/java/com/x/DemoApplicationHelper.java'));
});

test('? matches exactly one character', () => {
  assert.ok(matchGlob('src/A?.java', 'src/A1.java'));
  assert.ok(!matchGlob('src/A?.java', 'src/A12.java'));
  assert.ok(!matchGlob('src/A?.java', 'src/A/1.java'));
});

test('a trailing ** matches everything below the directory', () => {
  assert.ok(matchGlob('**/dto/**', 'src/main/java/com/x/dto/OrderDto.java'));
  assert.ok(matchGlob('**/dto/**', 'dto/A.java'));
  assert.ok(!matchGlob('**/dto/**', 'src/main/java/com/x/dtox/A.java'));
});

test('regex metacharacters in the pattern are matched literally', () => {
  assert.ok(matchGlob('src/a+b/(x).java', 'src/a+b/(x).java'));
  assert.ok(!matchGlob('src/a+b/(x).java', 'src/aab/x.java'));
  assert.equal(globToRegExp('a.b').source, '^a\\.b$');
});

test('matchAny is false for an empty pattern list', () => {
  assert.equal(matchAny([], 'anything'), false);
  assert.equal(matchAny(['**/*.java', '**/*.kt'], 'src/A.kt'), true);
});

test('isIncluded requires an include hit and no exclude hit', () => {
  const include = ['**/src/main/java/**/*.java'];
  const exclude = ['**/*Application.java', '**/dto/**'];

  assert.ok(isIncluded('src/main/java/com/x/OrderService.java', include, exclude));
  assert.ok(!isIncluded('src/main/java/com/x/DemoApplication.java', include, exclude));
  assert.ok(!isIncluded('src/main/java/com/x/dto/OrderDto.java', include, exclude));
  assert.ok(!isIncluded('src/test/java/com/x/OrderServiceTest.java', include, exclude));
});

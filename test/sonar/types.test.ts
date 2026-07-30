import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentToPath } from '../../src/sonar/types';

test('componentToPath strips a simple project key prefix', () => {
  assert.equal(componentToPath('my-proj:src/main/java/Foo.java', 'my-proj'), 'src/main/java/Foo.java');
});

test('componentToPath handles a Maven style key containing a colon', () => {
  assert.equal(
    componentToPath('org.kurum:proje:src/main/java/com/Foo.java', 'org.kurum:proje'),
    'src/main/java/com/Foo.java'
  );
});

test('componentToPath falls back to the LAST colon when the key is unknown', () => {
  // Anahtar verilmese bile Maven tarzı component bozulmamalı.
  assert.equal(
    componentToPath('org.kurum:proje:src/main/java/com/Foo.java'),
    'src/main/java/com/Foo.java'
  );
});

test('componentToPath ignores a project key that does not prefix the component', () => {
  assert.equal(componentToPath('other:src/Foo.java', 'my-proj'), 'src/Foo.java');
});

test('componentToPath returns the value unchanged when there is no colon', () => {
  assert.equal(componentToPath('src/Foo.java', 'my-proj'), 'src/Foo.java');
});

test('componentToPath keeps path segments that follow the key prefix verbatim', () => {
  // Ön ek eşleşmesi son ':' kuralından önce gelir: yol içindeki ':' korunur.
  assert.equal(componentToPath('proj:src/a:b/Foo.java', 'proj'), 'src/a:b/Foo.java');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestParseError, parseTestResponse } from '../../src/testgen/parse';
import type { TestParseOptions } from '../../src/testgen/parse';

const opts: TestParseOptions = {
  expectedPath: 'modules/order/src/test/java/com/kurum/order/OrderServiceTest.java',
  testRoot: 'modules/order/src/test/java',
  expectedPackage: 'com.kurum.order'
};

const BODY = [
  'package com.kurum.order;',
  '',
  'import org.junit.jupiter.api.Test;',
  '',
  'class OrderServiceTest {',
  '  @Test',
  '  void create_whenValid_returnsOrder() {}',
  '}'
].join('\n');

function response(path: string, body = BODY, rationale = 'create metodu için mutlu yol testi eklendi.'): string {
  return `DOSYA: ${path}\n\`\`\`java\n${body}\n\`\`\`\nGEREKÇE: ${rationale}`;
}

test('a well-formed response yields the path, content and rationale', () => {
  const parsed = parseTestResponse(response(opts.expectedPath), opts);

  assert.equal(parsed.filePath, opts.expectedPath);
  assert.ok(parsed.content.startsWith('package com.kurum.order;'));
  assert.ok(parsed.content.endsWith('\n'), 'dosya sonunda yeni satır olmalı');
  assert.equal(parsed.rationale, 'create metodu için mutlu yol testi eklendi.');
});

test('the expected path is used when the model omits the DOSYA line', () => {
  const parsed = parseTestResponse(`\`\`\`java\n${BODY}\n\`\`\`\nGEREKÇE: eklendi`, opts);

  assert.equal(parsed.filePath, opts.expectedPath);
});

test('an absolute path is rejected', () => {
  assert.throws(
    () => parseTestResponse(response('/etc/cron.d/payload.java'), opts),
    (err: unknown) => err instanceof TestParseError && /mutlak dosya yolu/.test(err.message)
  );
  assert.throws(
    () => parseTestResponse(response('C:\\Windows\\Temp\\x.java'), opts),
    /mutlak dosya yolu/
  );
});

test('a path escaping the test root is rejected', () => {
  assert.throws(
    () => parseTestResponse(response('modules/order/src/test/java/../../../../.ssh/authorized_keys.java'), opts),
    (err: unknown) => err instanceof TestParseError && /üst dizine çıkan yol/.test(err.message)
  );
  assert.throws(
    () => parseTestResponse(response('modules/order/src/main/java/com/kurum/order/OrderService.java'), opts),
    /yalnızca "modules\/order\/src\/test\/java" altına yazılabilir/
  );
});

test('a non-java target is rejected', () => {
  assert.throws(
    () => parseTestResponse(response('modules/order/src/test/java/com/kurum/order/pom.xml'), opts),
    /\.java" ile bitmeli/
  );
});

test('a differently named but still in-root test file is accepted with its own class name', () => {
  const path = 'modules/order/src/test/java/com/kurum/order/OrderServiceUnitTest.java';
  const body = BODY.replace('class OrderServiceTest', 'class OrderServiceUnitTest');

  const parsed = parseTestResponse(response(path, body), opts);

  assert.equal(parsed.filePath, path);
});

test('a class name that does not match the file name is rejected', () => {
  const body = BODY.replace('class OrderServiceTest', 'class SomethingElse');

  assert.throws(
    () => parseTestResponse(response(opts.expectedPath, body), opts),
    (err: unknown) => err instanceof TestParseError && /beklenen tip bildirimi bulunamadı: "OrderServiceTest"/.test(err.message)
  );
});

test('a mismatched or missing package declaration is rejected', () => {
  assert.throws(
    () => parseTestResponse(response(opts.expectedPath, BODY.replace('com.kurum.order;', 'com.baska;')), opts),
    /Paket uyuşmuyor/
  );
  assert.throws(
    () => parseTestResponse(response(opts.expectedPath, BODY.replace('package com.kurum.order;\n', '')), opts),
    /paket bildirimi yok/
  );
});

test('the default package requires no package declaration', () => {
  const rootOpts: TestParseOptions = {
    expectedPath: 'src/test/java/AppTest.java',
    testRoot: 'src/test/java',
    expectedPackage: ''
  };
  const body = 'class AppTest {\n  void t() {}\n}';

  const parsed = parseTestResponse(response('src/test/java/AppTest.java', body), rootOpts);
  assert.equal(parsed.filePath, 'src/test/java/AppTest.java');

  assert.throws(
    () => parseTestResponse(response('src/test/java/AppTest.java', 'package com.x;\n' + body), rootOpts),
    /varsayılan pakette olmalı/
  );
});

test('the block declaring the expected class wins over chatter blocks', () => {
  const raw = [
    'Önce bağımlılıkları ekleyin:',
    '```xml',
    '<dependency><artifactId>assertj-core</artifactId></dependency>',
    '```',
    `DOSYA: ${opts.expectedPath}`,
    '```java',
    BODY,
    '```',
    'GEREKÇE: iki senaryo eklendi.'
  ].join('\n');

  const parsed = parseTestResponse(raw, opts);

  assert.ok(parsed.content.includes('class OrderServiceTest'));
  assert.ok(!parsed.content.includes('assertj-core'));
  assert.equal(parsed.rationale, 'iki senaryo eklendi.');
});

test('a response without any code block is rejected', () => {
  assert.throws(
    () => parseTestResponse('Üzgünüm, bu sınıf için test yazamıyorum.', opts),
    (err: unknown) => err instanceof TestParseError && /kod bloğu döndürmedi/.test(err.message)
  );
});

test('an empty code block is rejected', () => {
  assert.throws(() => parseTestResponse('```java\n\n```', opts), /boş bir kod bloğu/);
});

test('a missing rationale falls back to a readable placeholder', () => {
  const parsed = parseTestResponse(`DOSYA: ${opts.expectedPath}\n\`\`\`java\n${BODY}\n\`\`\``, opts);

  assert.equal(parsed.rationale, 'Model gerekçe belirtmedi.');
});

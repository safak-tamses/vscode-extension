import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TestGenContextTooLargeError,
  buildTestPrompt,
  formatLineRanges,
  testClassName,
  truncateJavaSource
} from '../../src/testgen/prompt';
import { parseRuleSet } from '../../src/coverage/rules';
import type { TestRuleSet } from '../../src/coverage/rules';
import type { CoverageGap } from '../../src/coverage/gaps';

const GUIDELINES = [
  '## Yazım Kuralları',
  '- Assertion’lar AssertJ (`assertThat`) ile yazılır.',
  '- Dış bağımlılıklar `@Mock` + `@InjectMocks` ile izole edilir.'
].join('\n');

function ruleSet(): TestRuleSet {
  const parsed = parseRuleSet(
    [
      '---',
      'id: java-unit',
      'name: "Kurum Birim Test Kuralları"',
      'include:',
      '  - "**/src/main/java/**/*.java"',
      'coverage:',
      '  buildCommand: "mvn clean install"',
      '---',
      GUIDELINES
    ].join('\n'),
    'r.md'
  );
  if (!parsed.ruleSet) {
    throw new Error('kural seti geçersiz');
  }
  return parsed.ruleSet;
}

function gap(over: Partial<CoverageGap> = {}): CoverageGap {
  return {
    ruleSetId: 'java-unit',
    moduleRoot: 'modules/order',
    moduleName: 'order',
    qualifiedName: 'com.kurum.order.OrderService',
    simpleName: 'OrderService',
    packageName: 'com.kurum.order',
    packagePath: 'com/kurum/order',
    sourcePath: 'modules/order/src/main/java/com/kurum/order/OrderService.java',
    testPath: 'modules/order/src/test/java/com/kurum/order/OrderServiceTest.java',
    testExists: false,
    lineCoverage: 30,
    branchCoverage: 0,
    methodCoverage: 50,
    totalMethods: 2,
    uncoveredMethods: [
      {
        name: 'create',
        signature: 'create(OrderRequest): Order',
        line: 24,
        lineCoverage: 0,
        branchCoverage: 0,
        missedInstructions: 22,
        complexity: 3,
        executed: false
      }
    ],
    partialMethods: [
      {
        name: 'findAll',
        signature: 'findAll(): List',
        line: 40,
        lineCoverage: 100,
        branchCoverage: 50,
        missedInstructions: 0,
        complexity: 2,
        executed: true
      }
    ],
    uncoveredLines: [24, 25, 26, 31, 32],
    partiallyCoveredLines: [40],
    reasons: ['no-test-file', 'below-threshold', 'uncovered-methods'],
    score: 120,
    thresholds: { line: 80, branch: 70, method: 80 },
    reportMissing: false,
    ...over
  };
}

test('formatLineRanges collapses consecutive lines', () => {
  assert.equal(formatLineRanges([24, 25, 26, 31, 32, 40]), '24-26, 31-32, 40');
  assert.equal(formatLineRanges([7]), '7');
  assert.equal(formatLineRanges([]), '');
  assert.equal(formatLineRanges([3, 1, 2]), '1-3', 'sıralanmamış girdi de çalışır');
  assert.match(formatLineRanges([1, 3, 5, 7, 9], 2), /… \(\+3 aralık\)/);
});

test('testClassName derives the type name from the path', () => {
  assert.equal(testClassName('modules/o/src/test/java/com/x/OrderServiceTest.java'), 'OrderServiceTest');
});

test('the prompt carries the team rules verbatim', () => {
  const { prompt } = buildTestPrompt(gap(), ruleSet(), { sourceText: 'class OrderService {}' });

  assert.ok(prompt.includes(GUIDELINES), 'kural gövdesi birebir istemde olmalı');
  assert.match(prompt, /Kurum Birim Test Kuralları/);
  assert.match(prompt, /uymak ZORUNLUDUR/);
});

test('the prompt names the uncovered methods, lines and thresholds', () => {
  const { prompt } = buildTestPrompt(gap(), ruleSet(), { sourceText: 'class OrderService {}' });

  assert.match(prompt, /HİÇ TEST EDİLMEMİŞ METOTLAR/);
  assert.match(prompt, /create\(OrderRequest\): Order \(satır 24\)/);
  assert.match(prompt, /KISMEN KAPSANAN METOTLAR/);
  assert.match(prompt, /findAll\(\): List \(satır 40\), dal kapsamı %50/);
  assert.match(prompt, /Çalıştırılmamış satırlar: 24-26, 31-32/);
  assert.match(prompt, /Kısmen kapsanan satırlar: 40/);
  assert.match(prompt, /satır: {2}%30 \(en az %80\)/);
});

test('the prompt states the exact output contract, path, class and package', () => {
  const { prompt, testPath } = buildTestPrompt(gap(), ruleSet(), { sourceText: 'class OrderService {}' });

  assert.equal(testPath, 'modules/order/src/test/java/com/kurum/order/OrderServiceTest.java');
  assert.match(prompt, /DOSYA: modules\/order\/src\/test\/java\/com\/kurum\/order\/OrderServiceTest\.java/);
  assert.match(prompt, /GEREKÇE:/);
  assert.match(prompt, /Sınıf adı OrderServiceTest, paket com\.kurum\.order olmalıdır/);
});

test('a new test file and an existing one produce different instructions', () => {
  const fresh = buildTestPrompt(gap(), ruleSet(), { sourceText: 'class A {}' }).prompt;
  assert.match(fresh, /\(YOK — sıfırdan yazılacak\)/);
  assert.ok(!fresh.includes('MEVCUT TEST DOSYASI'));

  const grown = buildTestPrompt(gap({ testExists: true }), ruleSet(), {
    sourceText: 'class A {}',
    existingTestText: 'class OrderServiceTest { @Test void eski() {} }'
  }).prompt;
  assert.match(grown, /\(VAR — korunacak ve genişletilecek\)/);
  assert.match(grown, /MEVCUT TEST DOSYASI/);
  assert.match(grown, /SİLME ve DEĞİŞTİRME/);
  assert.ok(grown.includes('void eski()'));
});

test('a class missing from the report is described as never executed', () => {
  const { prompt } = buildTestPrompt(gap({ reportMissing: true, uncoveredMethods: [], partialMethods: [] }), ruleSet(), {
    sourceText: 'class A {}'
  });

  assert.match(prompt, /hiçbir satırı test tarafından çalıştırılmamış/);
  assert.ok(!prompt.includes('Mevcut kapsam'));
});

test('the repair round includes the compiler errors and the failed attempt', () => {
  const { prompt } = buildTestPrompt(gap(), ruleSet(), {
    sourceText: 'class A {}',
    compilerErrors: '[ERROR] cannot find symbol: assertThat',
    previousAttempt: 'class OrderServiceTest { bozuk }'
  });

  assert.match(prompt, /DERLENMEDİ/);
  assert.match(prompt, /cannot find symbol: assertThat/);
  assert.match(prompt, /class OrderServiceTest \{ bozuk \}/);
});

test('truncateJavaSource keeps the header and windows around target lines', () => {
  const source = Array.from({ length: 400 }, (_, i) => `line${i + 1} ${'x'.repeat(20)}`).join('\n');

  const { text, truncated } = truncateJavaSource(source, [300], 2000);

  assert.equal(truncated, true);
  assert.ok(text.length <= 2400);
  assert.ok(text.includes('line1 '), 'dosya başı korunur');
  assert.ok(text.includes('line300 '), 'hedef satır korunur');
  assert.ok(text.includes('// ... (kırpıldı) ...'));
  assert.ok(!text.includes('line200 '), 'ilgisiz orta bölüm kırpılır');
});

test('truncateJavaSource returns the source untouched when it already fits', () => {
  const { text, truncated } = truncateJavaSource('class A {}', [1], 1000);
  assert.equal(text, 'class A {}');
  assert.equal(truncated, false);
});

test('a long source is truncated and the prompt says so', () => {
  const source = Array.from({ length: 3000 }, (_, i) => `  // satır ${i + 1} ${'y'.repeat(40)}`).join('\n');

  const ctx = buildTestPrompt(gap(), ruleSet(), { sourceText: source }, 12000);

  assert.equal(ctx.sourceTruncated, true);
  assert.match(ctx.prompt, /kırpıldı/);
  assert.ok(ctx.prompt.length <= 13000, `istem bütçeye yakın kalmalı, oldu: ${ctx.prompt.length}`);
});

test('an impossible context budget fails loudly instead of silently dropping the existing tests', () => {
  assert.throws(
    () =>
      buildTestPrompt(gap({ testExists: true }), ruleSet(), {
        sourceText: 'class A {}',
        existingTestText: 'x'.repeat(5000)
      }, 2000),
    (err: unknown) => err instanceof TestGenContextTooLargeError && /maxContextChars/.test(err.message)
  );
});

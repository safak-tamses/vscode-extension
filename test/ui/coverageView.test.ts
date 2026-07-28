import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageView, gapId } from '../../src/ui/coverageView';
import type { CoverageGap } from '../../src/coverage/gaps';
import { summarize } from '../../src/coverage/gaps';
import { parseRuleSet } from '../../src/coverage/rules';
import type { TestRuleSet } from '../../src/coverage/rules';
import type { CoverageScanResult } from '../../src/coverage/service';
import type { ProviderStatus } from '../../src/ui/messages';

const provider: ProviderStatus = { id: 'local', label: 'Local LLM · qwen', available: true };
const scannedAt = new Date('2026-07-27T14:05:00');

function ruleSet(): TestRuleSet {
  const parsed = parseRuleSet(
    [
      '---',
      'id: java-unit',
      'name: "Kurum Kuralları"',
      'include:',
      '  - "**/src/main/java/**/*.java"',
      'coverage:',
      '  buildCommand: "mvn -B clean install"',
      '  minLineCoverage: 85',
      '---',
      'kurallar'
    ].join('\n'),
    '.code-health/rules/java.md'
  );
  if (!parsed.ruleSet) {
    throw new Error('kural seti geçersiz');
  }
  return parsed.ruleSet;
}

function method(name: string, line?: number): CoverageGap['uncoveredMethods'][number] {
  return {
    name,
    signature: `${name}(): void`,
    ...(line !== undefined ? { line } : {}),
    lineCoverage: 0,
    branchCoverage: 0,
    missedInstructions: 5,
    complexity: 1,
    executed: false
  };
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
    branchCoverage: 10,
    methodCoverage: 50,
    totalMethods: 4,
    uncoveredMethods: [method('create', 24), method('cancel', 40)],
    partialMethods: [],
    uncoveredLines: [24, 25],
    partiallyCoveredLines: [],
    reasons: ['no-test-file', 'below-threshold', 'uncovered-methods'],
    score: 120,
    thresholds: { line: 85, branch: 70, method: 80 },
    reportMissing: false,
    ...over
  };
}

function result(over: Partial<CoverageScanResult> = {}): CoverageScanResult {
  return {
    ruleSets: [ruleSet()],
    ruleFiles: [],
    modules: [],
    gaps: [gap()],
    summary: summarize([]),
    problems: [],
    builds: [],
    ...over
  };
}

test('gapId is stable and distinguishes classes across modules and rule sets', () => {
  assert.equal(gapId(gap()), 'java-unit::modules/order::com.kurum.order.OrderService');
  assert.notEqual(gapId(gap()), gapId(gap({ moduleRoot: 'modules/bff' })));
  assert.notEqual(gapId(gap()), gapId(gap({ ruleSetId: 'other' })));
});

test('the view carries the gap details the panel renders', () => {
  const view = buildCoverageView(result(), provider, scannedAt);
  const first = view.gaps[0];

  assert.ok(first);
  assert.equal(first.id, gapId(gap()));
  assert.equal(first.simpleName, 'OrderService');
  assert.equal(first.moduleName, 'order');
  assert.equal(first.testExists, false);
  assert.equal(first.uncoveredMethodCount, 2);
  assert.deepEqual(first.uncoveredMethods, ['create(): void', 'cancel(): void']);
  assert.deepEqual(first.thresholds, { line: 85, branch: 70, method: 80 });
  assert.deepEqual(first.reasons, ['test dosyası yok', 'eşik altında', 'kapsanmayan metot']);
});

test('long method lists are trimmed with an explicit remainder marker', () => {
  const many = Array.from({ length: 9 }, (_, i) => method(`m${i}`));
  const view = buildCoverageView(result({ gaps: [gap({ uncoveredMethods: many })] }), provider, scannedAt);
  const first = view.gaps[0];

  assert.ok(first);
  assert.equal(first.uncoveredMethods.length, 7, '6 imza + 1 kalan satırı');
  assert.equal(first.uncoveredMethods.at(-1), '+3 metot daha');
  assert.equal(first.uncoveredMethodCount, 9, 'gerçek sayı korunur');
});

test('summary thresholds come from the highest priority rule set', () => {
  const view = buildCoverageView(result(), provider, scannedAt);

  assert.deepEqual(view.thresholds, { line: 85, branch: 70, method: 80 });
  assert.equal(view.summary.gapCount, 1);
  assert.equal(view.ruleSets[0]?.name, 'Kurum Kuralları');
  assert.equal(view.ruleSets[0]?.buildCommand, 'mvn -B clean install');
});

test('defaults are used when no rule set is loaded', () => {
  const view = buildCoverageView(result({ ruleSets: [], gaps: [] }), provider, scannedAt);

  assert.deepEqual(view.thresholds, { line: 80, branch: 70, method: 80 });
  assert.deepEqual(view.gaps, []);
});

test('the blocker and build summary are surfaced to the panel', () => {
  const view = buildCoverageView(
    result({
      blocker: 'Etkin kural seti yok.',
      builds: [
        {
          ruleSetId: 'java-unit',
          command: 'mvn -B clean install',
          cwd: '',
          ok: true,
          durationMs: 42000,
          timedOut: false,
          cancelled: false,
          output: ''
        }
      ]
    }),
    provider,
    scannedAt
  );

  assert.equal(view.blocker, 'Etkin kural seti yok.');
  assert.match(view.buildSummary, /mvn -B clean install: başarılı \(42\.0 sn\)/);
  assert.match(view.scannedAt, /^\d{2}:\d{2}$/);
});

test('report problems are flattened into readable lines', () => {
  const view = buildCoverageView(
    result({ problems: [{ path: 'a/target/jacoco.xml', message: 'bozuk XML' }] }),
    provider,
    scannedAt
  );

  assert.equal(view.problems[0]?.message, 'a/target/jacoco.xml: bozuk XML');
});

test('the provider status travels with the view so the panel can disable generation', () => {
  const view = buildCoverageView(result(), { id: 'copilot', label: 'GitHub Copilot', available: false, hint: 'kapalı' }, scannedAt);

  assert.equal(view.provider.available, false);
  assert.equal(view.provider.hint, 'kapalı');
});

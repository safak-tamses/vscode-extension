import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestGenOrchestrator, testRootOf } from '../../src/testgen/orchestrator';
import { TestParseError } from '../../src/testgen/parse';
import { LlmUnavailableError } from '../../src/llm/gateway';
import type { ChatRequest, ChatResponse, LlmGateway, LlmProbeResult } from '../../src/llm/gateway';
import type { AuditInput, AuditSink } from '../../src/audit/audit';
import { parseRuleSet } from '../../src/coverage/rules';
import type { TestRuleSet } from '../../src/coverage/rules';
import type { CoverageGap } from '../../src/coverage/gaps';

function ruleSet(): TestRuleSet {
  const parsed = parseRuleSet(
    [
      '---',
      'id: java-unit',
      'include:',
      '  - "**/src/main/java/**/*.java"',
      'coverage:',
      '  buildCommand: "mvn clean install"',
      '---',
      '- AssertJ kullan.'
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
    lineCoverage: 0,
    branchCoverage: 0,
    methodCoverage: 0,
    totalMethods: 1,
    uncoveredMethods: [],
    partialMethods: [],
    uncoveredLines: [],
    partiallyCoveredLines: [],
    reasons: ['no-test-file', 'no-covered-method'],
    score: 90,
    thresholds: { line: 80, branch: 70, method: 80 },
    reportMissing: true,
    ...over
  };
}

const GOOD_RESPONSE = [
  'DOSYA: modules/order/src/test/java/com/kurum/order/OrderServiceTest.java',
  '```java',
  'package com.kurum.order;',
  '',
  'class OrderServiceTest {',
  '  void create_whenValid_returnsOrder() {}',
  '}',
  '```',
  'GEREKÇE: create için mutlu yol ve hata yolu testleri eklendi.'
].join('\n');

class FakeLm implements LlmGateway {
  readonly id = 'local' as const;
  readonly label = 'Local LLM · test';
  public lastRequest: ChatRequest | undefined;
  public calls = 0;
  constructor(
    private readonly available: boolean,
    private readonly raw: string
  ) {}
  unavailableHint(): string {
    return 'Sunucu kapalı.';
  }
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async complete(req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    this.lastRequest = req;
    return { raw: this.raw };
  }
  async probe(): Promise<LlmProbeResult> {
    return { ok: true, detail: '' };
  }
}

class CaptureAudit implements AuditSink {
  public events: AuditInput[] = [];
  async record(input: AuditInput): Promise<void> {
    this.events.push(input);
  }
}

test('testRootOf prefixes the module root', () => {
  assert.equal(testRootOf(gap(), ruleSet()), 'modules/order/src/test/java');
  assert.equal(testRootOf(gap({ moduleRoot: '' }), ruleSet()), 'src/test/java');
});

test('propose builds the prompt, parses the file and records a test-suggestion', async () => {
  const lm = new FakeLm(true, GOOD_RESPONSE);
  const audit = new CaptureAudit();

  const proposal = await new TestGenOrchestrator(lm, audit).propose(gap(), ruleSet(), {
    sourceText: 'package com.kurum.order;\nclass OrderService {}'
  });

  assert.equal(proposal.testPath, 'modules/order/src/test/java/com/kurum/order/OrderServiceTest.java');
  assert.equal(proposal.isNewFile, true);
  assert.equal(proposal.ruleSetId, 'java-unit');
  assert.equal(proposal.qualifiedName, 'com.kurum.order.OrderService');
  assert.ok(proposal.content.includes('class OrderServiceTest'));
  assert.match(proposal.rationale, /mutlu yol/);

  assert.match(lm.lastRequest?.prompt ?? '', /AssertJ kullan/);
  assert.equal(lm.lastRequest?.temperature, 0);

  assert.equal(audit.events.length, 1);
  const event = audit.events[0];
  assert.equal(event?.type, 'test-suggestion');
  assert.equal(event?.ruleKey, 'java-unit');
  assert.equal(event?.issueKey, 'com.kurum.order.OrderService');
  assert.equal(event?.file, 'modules/order/src/test/java/com/kurum/order/OrderServiceTest.java');
  assert.equal(event?.provider, 'local');
  assert.equal(event?.detail, 'no-test-file,no-covered-method');
});

test('propose marks an existing test file as an update, not a create', async () => {
  const lm = new FakeLm(true, GOOD_RESPONSE);

  const proposal = await new TestGenOrchestrator(lm, new CaptureAudit()).propose(
    gap({ testExists: true }),
    ruleSet(),
    { sourceText: 'class OrderService {}', existingTestText: 'class OrderServiceTest {}' }
  );

  assert.equal(proposal.isNewFile, false);
});

test('propose never asks the model when the provider is unavailable', async () => {
  const lm = new FakeLm(false, GOOD_RESPONSE);
  const audit = new CaptureAudit();

  await assert.rejects(
    () => new TestGenOrchestrator(lm, audit).propose(gap(), ruleSet(), { sourceText: 'class A {}' }),
    (err: unknown) => err instanceof LlmUnavailableError
  );
  assert.equal(lm.calls, 0);
  assert.deepEqual(audit.events, []);
});

test('an unusable response is rejected and nothing is recorded as a suggestion', async () => {
  const lm = new FakeLm(true, 'Bunu yapamam.');
  const audit = new CaptureAudit();

  await assert.rejects(
    () => new TestGenOrchestrator(lm, audit).propose(gap(), ruleSet(), { sourceText: 'class A {}' }),
    (err: unknown) => err instanceof TestParseError
  );
  assert.deepEqual(audit.events, [], 'ayrıştırılamayan yanıt öneri olarak kaydedilmez');
});

test('a path outside the test root is refused even if the model insists', async () => {
  const evil = [
    'DOSYA: modules/order/src/main/java/com/kurum/order/OrderService.java',
    '```java',
    'package com.kurum.order;',
    'class OrderService {}',
    '```'
  ].join('\n');
  const audit = new CaptureAudit();

  await assert.rejects(
    () => new TestGenOrchestrator(new FakeLm(true, evil), audit).propose(gap(), ruleSet(), { sourceText: 'x' }),
    (err: unknown) => err instanceof TestParseError && /altına yazılabilir/.test(err.message)
  );
  assert.deepEqual(audit.events, []);
});

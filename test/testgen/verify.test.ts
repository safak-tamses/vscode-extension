import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta, formatDelta } from '../../src/testgen/verify';
import type { CoverageGap } from '../../src/coverage/gaps';

function gap(over: Partial<CoverageGap> = {}): CoverageGap {
  return {
    ruleSetId: 'java-unit',
    moduleRoot: '',
    moduleName: '(kök)',
    qualifiedName: 'com.kurum.OrderService',
    simpleName: 'OrderService',
    packageName: 'com.kurum',
    packagePath: 'com/kurum',
    sourcePath: 'src/main/java/com/kurum/OrderService.java',
    testPath: 'src/test/java/com/kurum/OrderServiceTest.java',
    testExists: false,
    lineCoverage: 30,
    branchCoverage: 0,
    methodCoverage: 50,
    totalMethods: 2,
    uncoveredMethods: [],
    partialMethods: [],
    uncoveredLines: [],
    partiallyCoveredLines: [],
    reasons: ['below-threshold'],
    score: 100,
    thresholds: { line: 80, branch: 70, method: 80 },
    reportMissing: false,
    ...over
  };
}

test('a gap that disappeared from the list counts as resolved', () => {
  const delta = computeDelta(gap(), undefined);

  assert.equal(delta.resolved, true);
  assert.deepEqual(delta.after, { line: 100, branch: 100, method: 100 });
  assert.equal(delta.delta.line, 70);
  assert.deepEqual(delta.remainingUncoveredMethods, []);
  assert.match(formatDelta(delta), /satır %30 → %100 \(\+70\)/);
  assert.match(formatDelta(delta), /Eşikler karşılandı/);
});

test('coverage that improved but stayed below the threshold is not resolved', () => {
  const after = gap({
    lineCoverage: 60,
    branchCoverage: 40,
    methodCoverage: 75,
    uncoveredMethods: [
      {
        name: 'cancel',
        signature: 'cancel(long): void',
        lineCoverage: 0,
        branchCoverage: 0,
        missedInstructions: 8,
        complexity: 2,
        executed: false
      }
    ]
  });

  const delta = computeDelta(gap(), after);

  assert.equal(delta.resolved, false);
  assert.equal(delta.unchanged, false);
  assert.equal(delta.delta.line, 30);
  assert.deepEqual(delta.remainingUncoveredMethods, ['cancel(long): void']);
  assert.match(formatDelta(delta), /Hâlâ eşik altında \(1 metot test edilmemiş\)/);
});

test('coverage that did not move at all is called out explicitly', () => {
  const delta = computeDelta(gap(), gap());

  assert.equal(delta.unchanged, true);
  assert.equal(delta.resolved, false);
  assert.match(formatDelta(delta), /Kapsam değişmedi/);
});

test('meeting every threshold resolves the gap even if the class is still listed', () => {
  const delta = computeDelta(gap(), gap({ lineCoverage: 85, branchCoverage: 72, methodCoverage: 90 }));

  assert.equal(delta.resolved, true);
  assert.match(formatDelta(delta), /dal %0 → %72 \(\+72\)/);
});

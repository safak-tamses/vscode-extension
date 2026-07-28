import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupGaps } from '../../src/ui/coverageGrouping';
import type { CoverageGap } from '../../src/coverage/gaps';

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
    reasons: ['no-test-file'],
    score: 50,
    thresholds: { line: 80, branch: 70, method: 80 },
    reportMissing: false,
    ...over
  };
}

test('gaps are grouped into module > package > class', () => {
  const tree = groupGaps([
    gap(),
    gap({ simpleName: 'OrderMapper', qualifiedName: 'com.kurum.order.OrderMapper' }),
    gap({
      moduleName: 'bff',
      moduleRoot: 'modules/bff',
      packageName: 'com.kurum.bff',
      simpleName: 'BffController',
      qualifiedName: 'com.kurum.bff.BffController'
    })
  ]);

  assert.deepEqual(
    tree.map((m) => m.moduleName),
    ['order', 'bff'],
    'en çok boşluğu olan modül üstte'
  );
  assert.equal(tree[0]?.gapCount, 2);
  assert.equal(tree[0]?.children[0]?.label, 'com.kurum.order');
  assert.deepEqual(
    tree[0]?.children[0]?.children.map((c) => c.label),
    ['OrderMapper', 'OrderService'],
    'eşit skorda alfabetik'
  );
});

test('classes are ordered worst-first by score', () => {
  const tree = groupGaps([
    gap({ simpleName: 'Low', score: 10 }),
    gap({ simpleName: 'High', score: 300 }),
    gap({ simpleName: 'Mid', score: 120 })
  ]);

  assert.deepEqual(
    tree[0]?.children[0]?.children.map((c) => c.label),
    ['High', 'Mid', 'Low']
  );
});

test('uncovered methods become leaf nodes carrying their line numbers', () => {
  const tree = groupGaps([
    gap({
      uncoveredMethods: [
        {
          name: 'create',
          signature: 'create(OrderRequest): Order',
          line: 24,
          lineCoverage: 0,
          branchCoverage: 0,
          missedInstructions: 9,
          complexity: 2,
          executed: false
        },
        {
          name: 'cancel',
          signature: 'cancel(long): void',
          lineCoverage: 0,
          branchCoverage: 0,
          missedInstructions: 4,
          complexity: 1,
          executed: false
        }
      ]
    })
  ]);

  const methods = tree[0]?.children[0]?.children[0]?.children ?? [];
  assert.equal(methods.length, 2);
  assert.equal(methods[0]?.label, 'create(OrderRequest): Order');
  assert.equal(methods[0]?.line, 24);
  assert.equal(methods[1]?.line, undefined, 'satırı olmayan metot da listelenir');
});

test('the default package gets a readable label and packages sort alphabetically', () => {
  const tree = groupGaps([
    gap({ packageName: '', simpleName: 'App' }),
    gap({ packageName: 'com.a', simpleName: 'A' })
  ]);

  assert.deepEqual(
    tree[0]?.children.map((p) => p.label),
    ['(varsayılan paket)', 'com.a']
  );
});

test('an empty gap list produces an empty tree', () => {
  assert.deepEqual(groupGaps([]), []);
});

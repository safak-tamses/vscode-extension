import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classInfoFromSourcePath,
  joinPath,
  moduleNameOf,
  moduleRootFromReportPath,
  sourcePathFor,
  testPathFor
} from '../../src/coverage/paths';

test('moduleRootFromReportPath finds the Maven module that owns the report', () => {
  assert.equal(
    moduleRootFromReportPath('modules/order-service/target/site/jacoco/jacoco.xml'),
    'modules/order-service'
  );
  assert.equal(moduleRootFromReportPath('target/site/jacoco/jacoco.xml'), '');
  assert.equal(
    moduleRootFromReportPath('backend\\bff\\target\\site\\jacoco\\jacoco.xml'),
    'backend/bff'
  );
});

test('moduleNameOf labels the root module readably', () => {
  assert.equal(moduleNameOf(''), '(kök)');
  assert.equal(moduleNameOf('modules/order-service'), 'order-service');
});

test('joinPath drops empty segments so root modules do not produce leading slashes', () => {
  assert.equal(joinPath('', 'src/main/java', 'com/x', 'A.java'), 'src/main/java/com/x/A.java');
  assert.equal(joinPath('m', 'src/main/java', '', 'A.java'), 'm/src/main/java/A.java');
});

test('sourcePathFor and testPathFor mirror the Maven layout', () => {
  assert.equal(
    sourcePathFor('modules/order', 'src/main/java', 'com/kurum/order', 'OrderService.java'),
    'modules/order/src/main/java/com/kurum/order/OrderService.java'
  );
  assert.equal(
    testPathFor('modules/order', 'src/test/java', 'com/kurum/order', 'OrderService', 'Test'),
    'modules/order/src/test/java/com/kurum/order/OrderServiceTest.java'
  );
  assert.equal(
    testPathFor('', 'src/test/java', 'com/kurum', 'OrderService', 'IT'),
    'src/test/java/com/kurum/OrderServiceIT.java'
  );
});

test('classInfoFromSourcePath recovers module, package and class from a source path', () => {
  const info = classInfoFromSourcePath(
    'modules/order/src/main/java/com/kurum/order/OrderService.java',
    'src/main/java'
  );

  assert.deepEqual(info, {
    moduleRoot: 'modules/order',
    packagePath: 'com/kurum/order',
    fileName: 'OrderService.java',
    simpleName: 'OrderService'
  });
});

test('classInfoFromSourcePath handles a single-module project and the default package', () => {
  assert.deepEqual(classInfoFromSourcePath('src/main/java/App.java', 'src/main/java'), {
    moduleRoot: '',
    packagePath: '',
    fileName: 'App.java',
    simpleName: 'App'
  });
});

test('classInfoFromSourcePath returns undefined when the path is outside the source root', () => {
  assert.equal(classInfoFromSourcePath('scripts/tool.java', 'src/main/java'), undefined);
});

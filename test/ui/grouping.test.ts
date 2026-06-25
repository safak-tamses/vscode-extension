import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFindings } from '../../src/ui/grouping';
import type { Severity, SonarIssue } from '../../src/sonar/types';

function iss(key: string, project: string, component: string, severity: Severity): SonarIssue {
  return {
    key,
    rule: 'java:S1',
    severity,
    type: 'BUG',
    component,
    project,
    message: 'msg ' + key,
    status: 'OPEN'
  };
}

test('groups issues by project > file > severity > issue with counts', () => {
  const tree = groupFindings([
    iss('a', 'projA', 'projA:src/Foo.java', 'MAJOR'),
    iss('b', 'projA', 'projA:src/Foo.java', 'BLOCKER'),
    iss('c', 'projA', 'projA:src/Bar.java', 'MINOR'),
    iss('d', 'projB', 'projB:src/Baz.java', 'CRITICAL')
  ]);

  assert.equal(tree.length, 2);

  const projA = tree.find((p) => p.project === 'projA');
  assert.ok(projA);
  assert.equal(projA.count, 3);
  assert.equal(projA.children.length, 2);
});

test('sorts projects and files alphabetically and severities by priority', () => {
  const tree = groupFindings([
    iss('a', 'projB', 'projB:src/Z.java', 'INFO'),
    iss('b', 'projA', 'projA:src/Foo.java', 'MAJOR'),
    iss('c', 'projA', 'projA:src/Foo.java', 'BLOCKER'),
    iss('d', 'projA', 'projA:src/Bar.java', 'MINOR')
  ]);

  // projects alphabetical
  assert.deepEqual(tree.map((p) => p.project), ['projA', 'projB']);

  const projA = tree[0];
  assert.ok(projA);
  // files alphabetical: Bar before Foo
  assert.deepEqual(projA.children.map((f) => f.path), ['src/Bar.java', 'src/Foo.java']);

  const foo = projA.children.find((f) => f.path === 'src/Foo.java');
  assert.ok(foo);
  // severities by priority: BLOCKER before MAJOR
  assert.deepEqual(foo.children.map((s) => s.severity), ['BLOCKER', 'MAJOR']);
  // the blocker severity node holds issue 'c'
  assert.equal(foo.children[0]?.children[0]?.issue.key, 'c');
});

test('aggregates multiple issues of the same severity under one severity node', () => {
  const tree = groupFindings([
    iss('x', 'p', 'p:F.java', 'MAJOR'),
    iss('y', 'p', 'p:F.java', 'MAJOR')
  ]);

  const sev = tree[0]?.children[0]?.children[0];
  assert.ok(sev);
  assert.equal(sev.severity, 'MAJOR');
  assert.equal(sev.count, 2);
  assert.equal(sev.children.length, 2);
});

test('returns empty array for no issues', () => {
  assert.deepEqual(groupFindings([]), []);
});

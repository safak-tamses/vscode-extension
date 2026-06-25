import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindingView } from '../../src/ui/findingView';
import type { SonarIssue, SonarRule } from '../../src/sonar/types';

const issue: SonarIssue = {
  key: 'k',
  rule: 'java:S2095',
  severity: 'MAJOR',
  type: 'BUG',
  component: 'proj:src/A.java',
  project: 'proj',
  message: 'Use try-with-resources',
  status: 'OPEN',
  textRange: { startLine: 10, endLine: 12, startOffset: 0, endOffset: 5 }
};

test('maps issue + rule into a view and sanitizes the description', () => {
  const rule: SonarRule = {
    key: 'java:S2095',
    name: 'Resources should be closed',
    htmlDesc: '<p>Close it</p><script>alert(1)</script>'
  };

  const view = buildFindingView(issue, rule, true);

  assert.equal(view.issueKey, 'k');
  assert.equal(view.ruleKey, 'java:S2095');
  assert.equal(view.ruleName, 'Resources should be closed');
  assert.equal(view.severity, 'MAJOR');
  assert.equal(view.issueType, 'BUG');
  assert.equal(view.filePath, 'src/A.java');
  assert.equal(view.line, 10);
  assert.equal(view.copilotAvailable, true);
  assert.ok(view.descriptionHtml.includes('Close it'));
  assert.ok(!view.descriptionHtml.includes('<script>'));
});

test('falls back to rule key and placeholder description when rule is missing', () => {
  const view = buildFindingView(issue, undefined, false);

  assert.equal(view.ruleName, 'java:S2095');
  assert.equal(view.copilotAvailable, false);
  assert.ok(view.descriptionHtml.length > 0);
});

test('uses issue.line when textRange is absent', () => {
  const noRange: SonarIssue = { ...issue, textRange: undefined, line: 7 };
  const view = buildFindingView(noRange, undefined, false);
  assert.equal(view.line, 7);
});

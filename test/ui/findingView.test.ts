import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindingView } from '../../src/ui/findingView';
import type { ProviderStatus } from '../../src/ui/messages';
import type { SonarIssue, SonarRule } from '../../src/sonar/types';

const copilotReady: ProviderStatus = { id: 'copilot', label: 'GitHub Copilot', available: true };
const localDown: ProviderStatus = {
  id: 'local',
  label: 'Local LLM · qwen2.5-coder',
  available: false,
  hint: 'Sunucuya ulaşılamıyor.'
};

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

  const view = buildFindingView(issue, rule, copilotReady);

  assert.equal(view.issueKey, 'k');
  assert.equal(view.ruleKey, 'java:S2095');
  assert.equal(view.ruleName, 'Resources should be closed');
  assert.equal(view.severity, 'MAJOR');
  assert.equal(view.issueType, 'BUG');
  assert.equal(view.filePath, 'src/A.java');
  assert.equal(view.line, 10);
  assert.deepEqual(view.provider, copilotReady);
  assert.ok(view.descriptionHtml.includes('Close it'));
  assert.ok(!view.descriptionHtml.includes('<script>'));
});

test('falls back to rule key and placeholder description when rule is missing', () => {
  const view = buildFindingView(issue, undefined, localDown);

  assert.equal(view.ruleName, 'java:S2095');
  assert.equal(view.provider.available, false);
  assert.equal(view.provider.label, 'Local LLM · qwen2.5-coder');
  assert.ok(view.descriptionHtml.length > 0);
});

test('uses issue.line when textRange is absent', () => {
  const noRange: SonarIssue = { ...issue, textRange: undefined, line: 7 };
  const view = buildFindingView(noRange, undefined, localDown);
  assert.equal(view.line, 7);
});

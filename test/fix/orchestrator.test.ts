import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixOrchestrator, CopilotUnavailableError } from '../../src/fix/orchestrator';
import type { LanguageModelGateway } from '../../src/fix/orchestrator';
import type { FixContext } from '../../src/fix/context';
import type { AuditInput, AuditSink } from '../../src/audit/audit';
import type { SonarIssue } from '../../src/sonar/types';

const issue: SonarIssue = {
  key: 'issue-1',
  rule: 'java:S2095',
  severity: 'MAJOR',
  type: 'BUG',
  component: 'proj:src/A.java',
  project: 'proj',
  line: 6,
  message: 'Close it',
  status: 'OPEN',
  textRange: { startLine: 6, endLine: 6, startOffset: 0, endOffset: 3 }
};

const ctx: FixContext = { snippet: 'old();', startLine: 5, endLine: 7, prompt: 'PROMPT-TEXT' };

class FakeLm implements LanguageModelGateway {
  public lastPrompt = '';
  constructor(private available: boolean, private raw: string) {}
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async sendFix(prompt: string): Promise<{ raw: string }> {
    this.lastPrompt = prompt;
    return { raw: this.raw };
  }
}

class CaptureAudit implements AuditSink {
  public events: AuditInput[] = [];
  async record(input: AuditInput): Promise<void> {
    this.events.push(input);
  }
}

test('propose calls lm with the context prompt, parses fix, records suggestion, never applies', async () => {
  const lm = new FakeLm(true, '```java\nclose();\n```\nGEREKÇE: kaynak kapatıldı');
  const audit = new CaptureAudit();
  const orch = new FixOrchestrator(lm, audit);

  const proposal = await orch.propose(issue, ctx);

  assert.equal(lm.lastPrompt, 'PROMPT-TEXT');
  assert.equal(proposal.newCode, 'close();');
  assert.match(proposal.rationale, /kaynak kapatıldı/);
  assert.equal(proposal.startLine, 5);
  assert.equal(proposal.endLine, 7);
  assert.equal(proposal.filePath, 'src/A.java');
  assert.equal(proposal.issueKey, 'issue-1');
  assert.equal(proposal.ruleKey, 'java:S2095');

  // audit: tam olarak bir 'suggestion'
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0]?.type, 'suggestion');
  assert.equal(audit.events[0]?.issueKey, 'issue-1');
  assert.equal(audit.events[0]?.file, 'src/A.java');
});

test('propose throws CopilotUnavailableError when lm is unavailable and records nothing', async () => {
  const lm = new FakeLm(false, '');
  const audit = new CaptureAudit();
  const orch = new FixOrchestrator(lm, audit);

  await assert.rejects(() => orch.propose(issue, ctx), (err: unknown) => err instanceof CopilotUnavailableError);
  assert.equal(audit.events.length, 0);
});

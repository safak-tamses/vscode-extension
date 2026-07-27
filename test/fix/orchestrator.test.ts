import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixOrchestrator } from '../../src/fix/orchestrator';
import { LlmUnavailableError } from '../../src/llm/gateway';
import type { ChatRequest, ChatResponse, LlmGateway, LlmProbeResult } from '../../src/llm/gateway';
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

const ctx: FixContext = {
  snippet: 'old();',
  startLine: 5,
  endLine: 7,
  system: 'SYSTEM-TEXT',
  prompt: 'PROMPT-TEXT'
};

class FakeLm implements LlmGateway {
  readonly id = 'local' as const;
  readonly label = 'Local LLM · test';
  public lastRequest: ChatRequest | undefined;
  constructor(
    private readonly available: boolean,
    private readonly raw: string
  ) {}
  unavailableHint(): string {
    return 'Sunucu kapalı olabilir.';
  }
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async complete(req: ChatRequest): Promise<ChatResponse> {
    this.lastRequest = req;
    return { raw: this.raw };
  }
  async probe(): Promise<LlmProbeResult> {
    return { ok: this.available, detail: '' };
  }
}

class CaptureAudit implements AuditSink {
  public events: AuditInput[] = [];
  async record(input: AuditInput): Promise<void> {
    this.events.push(input);
  }
}

test('propose sends the context prompt, parses the fix, records a suggestion and never applies', async () => {
  const lm = new FakeLm(true, '```java\nclose();\n```\nGEREKÇE: kaynak kapatıldı');
  const audit = new CaptureAudit();
  const orch = new FixOrchestrator(lm, audit);

  const proposal = await orch.propose(issue, ctx);

  assert.equal(lm.lastRequest?.prompt, 'PROMPT-TEXT');
  assert.equal(lm.lastRequest?.system, 'SYSTEM-TEXT');
  assert.equal(proposal.newCode, 'close();');
  assert.match(proposal.rationale, /kaynak kapatıldı/);
  assert.equal(proposal.startLine, 5);
  assert.equal(proposal.endLine, 7);
  assert.equal(proposal.filePath, 'src/A.java');
  assert.equal(proposal.issueKey, 'issue-1');
  assert.equal(proposal.ruleKey, 'java:S2095');

  // audit: tam olarak bir 'suggestion', sağlayıcı bilgisiyle
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0]?.type, 'suggestion');
  assert.equal(audit.events[0]?.issueKey, 'issue-1');
  assert.equal(audit.events[0]?.file, 'src/A.java');
  assert.equal(audit.events[0]?.provider, 'local');
  assert.equal(audit.events[0]?.model, 'Local LLM · test');
});

test('propose throws LlmUnavailableError when the provider is unreachable and records nothing', async () => {
  const lm = new FakeLm(false, '');
  const audit = new CaptureAudit();
  const orch = new FixOrchestrator(lm, audit);

  await assert.rejects(
    () => orch.propose(issue, ctx),
    (err: unknown) => err instanceof LlmUnavailableError && /Sunucu kapalı olabilir/.test(err.message)
  );
  assert.equal(audit.events.length, 0);
});

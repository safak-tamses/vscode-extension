import { componentToPath } from '../sonar/types';
import type { SonarIssue } from '../sonar/types';
import type { AuditSink } from '../audit/audit';
import { unavailable } from '../llm/gateway';
import type { CancelSignal, LlmGateway } from '../llm/gateway';
import type { FixContext } from './context';
import { parseFixResponse } from './parse';

export interface FixProposal {
  issueKey: string;
  ruleKey: string;
  filePath: string;
  /** Düzeltilecek satır aralığı (1-tabanlı, dahil). */
  startLine: number;
  endLine: number;
  /** Önerilen yeni kod; boşsa uygulanabilir öneri yok. */
  newCode: string;
  rationale: string;
}

/**
 * Bulgu için seçili model sağlayıcıdan (Copilot veya local LLM) fix önerisi üretir.
 * ÖNERİYİ ASLA UYGULAMAZ; yalnızca üretir ve audit'e 'suggestion' işler.
 * Uygulama kararı diff/onay katmanına aittir.
 */
export class FixOrchestrator {
  constructor(
    private readonly llm: LlmGateway,
    private readonly audit: AuditSink
  ) {}

  async propose(issue: SonarIssue, context: FixContext, cancel?: CancelSignal): Promise<FixProposal> {
    if (!(await this.llm.isAvailable())) {
      throw unavailable(this.llm);
    }
    const startedAt = Date.now();
    const { raw } = await this.llm.complete(
      { system: context.system, prompt: context.prompt, temperature: 0 },
      cancel
    );
    const parsed = parseFixResponse(raw);
    const filePath = componentToPath(issue.component, issue.project);

    await this.audit.record({
      type: 'suggestion',
      ruleKey: issue.rule,
      issueKey: issue.key,
      file: filePath,
      provider: this.llm.id,
      model: this.llm.label,
      durationMs: Date.now() - startedAt
    });

    return {
      issueKey: issue.key,
      ruleKey: issue.rule,
      filePath,
      startLine: context.startLine,
      endLine: context.endLine,
      newCode: parsed.newCode,
      rationale: parsed.rationale
    };
  }
}

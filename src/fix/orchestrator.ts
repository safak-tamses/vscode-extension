import { componentToPath } from '../sonar/types';
import type { SonarIssue } from '../sonar/types';
import type { AuditSink } from '../audit/audit';
import type { FixContext } from './context';
import { parseFixResponse } from './parse';

/** Copilot / Language Model erişimi portu (vscode.lm gerçek implementasyon ile bağlanır). */
export interface LanguageModelGateway {
  isAvailable(): Promise<boolean>;
  sendFix(prompt: string): Promise<{ raw: string }>;
}

export class CopilotUnavailableError extends Error {
  constructor(message = 'GitHub Copilot (Language Model API) bu ortamda kullanılamıyor.') {
    super(message);
    this.name = 'CopilotUnavailableError';
  }
}

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
 * Bulgu için Copilot'tan fix önerisi üretir. ÖNERİYİ ASLA UYGULAMAZ; yalnızca üretir ve
 * audit'e 'suggestion' işler. Uygulama kararı diff/onay katmanına aittir.
 */
export class FixOrchestrator {
  constructor(private readonly lm: LanguageModelGateway, private readonly audit: AuditSink) {}

  async propose(issue: SonarIssue, context: FixContext): Promise<FixProposal> {
    if (!(await this.lm.isAvailable())) {
      throw new CopilotUnavailableError();
    }
    const { raw } = await this.lm.sendFix(context.prompt);
    const parsed = parseFixResponse(raw);
    const filePath = componentToPath(issue.component);

    await this.audit.record({
      type: 'suggestion',
      ruleKey: issue.rule,
      issueKey: issue.key,
      file: filePath
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

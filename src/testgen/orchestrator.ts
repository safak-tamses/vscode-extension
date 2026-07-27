import type { AuditSink } from '../audit/audit';
import type { CoverageGap } from '../coverage/gaps';
import type { TestRuleSet } from '../coverage/rules';
import { unavailable } from '../llm/gateway';
import type { CancelSignal, LlmGateway } from '../llm/gateway';
import { parseTestResponse } from './parse';
import { buildTestPrompt } from './prompt';
import type { TestGenSources } from './prompt';

export interface TestProposal {
  ruleSetId: string;
  /** Hedef sınıfın tam adı (audit ve başlık için). */
  qualifiedName: string;
  /** Workspace'e göreli test dosyası yolu. */
  testPath: string;
  content: string;
  isNewFile: boolean;
  rationale: string;
  /** Kaynak, bağlam bütçesi nedeniyle kırpıldı mı? */
  sourceTruncated: boolean;
}

export interface ProposeOptions {
  maxContextChars?: number;
  cancel?: CancelSignal;
}

/**
 * Bir kapsam boşluğu için test dosyası önerisi üretir.
 * DOSYAYA ASLA YAZMAZ; yalnızca öneri üretir ve audit'e 'test-suggestion' işler.
 * Yazma kararı diff/onay katmanına aittir.
 */
export class TestGenOrchestrator {
  constructor(
    private readonly llm: LlmGateway,
    private readonly audit: AuditSink
  ) {}

  async propose(
    gap: CoverageGap,
    ruleSet: TestRuleSet,
    sources: TestGenSources,
    options: ProposeOptions = {}
  ): Promise<TestProposal> {
    if (!(await this.llm.isAvailable())) {
      throw unavailable(this.llm);
    }
    const context = buildTestPrompt(gap, ruleSet, sources, options.maxContextChars);
    const startedAt = Date.now();
    const { raw } = await this.llm.complete(
      { system: context.system, prompt: context.prompt, temperature: 0 },
      options.cancel
    );
    const parsed = parseTestResponse(raw, {
      expectedPath: gap.testPath,
      testRoot: testRootOf(gap, ruleSet),
      expectedPackage: gap.packageName
    });

    await this.audit.record({
      type: 'test-suggestion',
      ruleKey: ruleSet.id,
      issueKey: gap.qualifiedName,
      file: parsed.filePath,
      provider: this.llm.id,
      model: this.llm.label,
      durationMs: Date.now() - startedAt,
      detail: gap.reasons.join(',')
    });

    return {
      ruleSetId: ruleSet.id,
      qualifiedName: gap.qualifiedName,
      testPath: parsed.filePath,
      content: parsed.content,
      isNewFile: !gap.testExists || parsed.filePath !== gap.testPath,
      rationale: parsed.rationale,
      sourceTruncated: context.sourceTruncated
    };
  }
}

/** Modül dahil test kökü: `modules/order` + `src/test/java` -> `modules/order/src/test/java`. */
export function testRootOf(gap: CoverageGap, ruleSet: TestRuleSet): string {
  return [gap.moduleRoot, ruleSet.test.testRoot].filter((part) => part !== '').join('/');
}

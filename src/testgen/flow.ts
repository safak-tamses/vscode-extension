import * as vscode from 'vscode';
import type { AuditSink } from '../audit/audit';
import { extractCompilerErrors } from '../coverage/build';
import type { CoverageGap } from '../coverage/gaps';
import type { TestRuleSet } from '../coverage/rules';
import type { CoverageScanResult } from '../coverage/service';
import { PreviewContentProvider, previewFileAndDecide } from '../fix/diff';
import { LlmConfigError, LlmUnavailableError } from '../llm/gateway';
import type { CancelSignal, LlmGateway } from '../llm/gateway';
import { TestGenOrchestrator } from './orchestrator';
import { TestGenContextTooLargeError } from './prompt';
import type { TestGenSources } from './prompt';
import { TestParseError } from './parse';
import { computeDelta, formatDelta } from './verify';

export type TestFlowOutcome = 'applied' | 'rejected' | 'noop' | 'error' | 'unavailable';

export interface TestFlowDeps {
  /** Güncel model sağlayıcı (ayar değişikliklerinde yenilenir). */
  llm: () => LlmGateway;
  audit: AuditSink;
  previewProvider: PreviewContentProvider;
  resolveUri: (relPath: string) => Promise<vscode.Uri | undefined>;
  targetUri: (relPath: string) => vscode.Uri | undefined;
  maxContextChars: () => number;
  maxRepairAttempts: () => number;
  /** Doğrulama adımı: derleme komutunu çalıştırıp kapsamı yeniden tarar. */
  rescan: (cancel?: CancelSignal) => Promise<CoverageScanResult>;
  /** Tarama sonucu yenilendiğinde arayüzü güncellemek için. */
  onRescanned?: (result: CoverageScanResult) => void;
}

/** vscode iptal jetonunu llm/coverage katmanlarının portuna uyarlar. */
export function toCancelSignal(token: vscode.CancellationToken): CancelSignal {
  return {
    get isCancellationRequested(): boolean {
      return token.isCancellationRequested;
    },
    onCancellationRequested(listener: () => void): { dispose(): void } {
      return token.onCancellationRequested(() => listener());
    }
  };
}

/**
 * Bir kapsam boşluğu için uçtan uca test üretim akışı:
 * kaynağı oku → öneri üret → DIFF ONAYI → (onaylanırsa) yaz → isteğe bağlı doğrulama.
 *
 * Onay olmadan hiçbir dosya yazılmaz. Doğrulama, derleme komutunu yeniden çalıştırıp
 * önce/sonra kapsam farkını gösterir; derleme kırılırsa sınırlı sayıda onarım turu önerilir.
 */
export async function runTestGeneration(
  gap: CoverageGap,
  ruleSet: TestRuleSet,
  deps: TestFlowDeps
): Promise<TestFlowOutcome> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Kod Sağlığı: ${gap.simpleName} için test üretiliyor`,
      cancellable: true
    },
    async (progress, token) => {
      const cancel = toCancelSignal(token);
      try {
        const sources = await readSources(gap, deps);
        if (!sources) {
          void vscode.window.showErrorMessage(
            `Kaynak dosya workspace içinde bulunamadı: ${gap.sourcePath}`
          );
          return 'error';
        }

        progress.report({ message: deps.llm().label });
        const orchestrator = new TestGenOrchestrator(deps.llm(), deps.audit);
        const proposal = await orchestrator.propose(gap, ruleSet, sources, {
          maxContextChars: deps.maxContextChars(),
          cancel
        });
        if (token.isCancellationRequested) {
          return 'rejected';
        }
        if (proposal.sourceTruncated) {
          void vscode.window.showWarningMessage(
            'Kaynak dosya bağlam bütçesine sığmadı ve kırpıldı; üretilen testi dikkatle gözden geçirin.'
          );
        }

        const outcome = await previewFileAndDecide(
          {
            filePath: proposal.testPath,
            content: proposal.content,
            rationale: proposal.rationale,
            title: `Kod Sağlığı: ${gap.simpleName} testi  (←mevcut | önerilen→)`
          },
          {
            resolveUri: deps.resolveUri,
            targetUri: deps.targetUri,
            provider: deps.previewProvider,
            onAccept: () =>
              deps.audit.record({
                type: 'test-accept',
                ruleKey: ruleSet.id,
                issueKey: gap.qualifiedName,
                file: proposal.testPath
              }),
            onReject: () =>
              deps.audit.record({
                type: 'test-reject',
                ruleKey: ruleSet.id,
                issueKey: gap.qualifiedName,
                file: proposal.testPath
              })
          }
        );

        if (outcome !== 'applied') {
          return outcome === 'noop' ? 'noop' : outcome === 'rejected' ? 'rejected' : 'error';
        }

        await offerVerification(gap, ruleSet, deps, proposal.content, 0);
        return 'applied';
      } catch (err) {
        return await reportError(err, gap, deps);
      }
    }
  );
}

async function readSources(gap: CoverageGap, deps: TestFlowDeps): Promise<TestGenSources | undefined> {
  const sourceUri = await deps.resolveUri(gap.sourcePath);
  if (!sourceUri) {
    return undefined;
  }
  const sourceText = (await vscode.workspace.openTextDocument(sourceUri)).getText();
  const testUri = await deps.resolveUri(gap.testPath);
  const existingTestText = testUri
    ? (await vscode.workspace.openTextDocument(testUri)).getText()
    : undefined;
  return { sourceText, ...(existingTestText ? { existingTestText } : {}) };
}

/** Uygulanan testi derleyip kapsam farkını gösterir; derleme kırılırsa onarım önerir. */
async function offerVerification(
  gap: CoverageGap,
  ruleSet: TestRuleSet,
  deps: TestFlowDeps,
  appliedContent: string,
  attempt: number
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Test yazıldı: ${gap.testPath}`,
    { detail: `Doğrulamak için "${ruleSet.coverage.buildCommand}" çalıştırılabilir.`, modal: false },
    'Derle ve Doğrula',
    'Şimdilik Atla'
  );
  if (choice !== 'Derle ve Doğrula') {
    return;
  }

  const result = await deps.rescan();
  deps.onRescanned?.(result);

  const failedBuild = result.builds.find((b) => !b.ok && !b.skippedReason);
  if (failedBuild) {
    await deps.audit.record({
      type: 'test-verify',
      ruleKey: ruleSet.id,
      issueKey: gap.qualifiedName,
      file: gap.testPath,
      detail: failedBuild.timedOut ? 'derleme zaman aşımı' : 'derleme başarısız'
    });
    await offerRepair(gap, ruleSet, deps, appliedContent, failedBuild.output, attempt);
    return;
  }
  if (result.builds.length === 0 || result.builds.every((b) => b.skippedReason)) {
    void vscode.window.showWarningMessage(
      'Derleme çalıştırılmadı; kapsam farkı hesaplanamadı. ' +
        (result.builds[0]?.skippedReason ?? 'Kural dosyasındaki derleme komutunu ve workspace güvenini kontrol edin.')
    );
    return;
  }

  const after = result.gaps.find((g) => g.qualifiedName === gap.qualifiedName);
  const delta = computeDelta(gap, after);
  await deps.audit.record({
    type: 'test-verify',
    ruleKey: ruleSet.id,
    issueKey: gap.qualifiedName,
    file: gap.testPath,
    detail: formatDelta(delta)
  });

  if (delta.resolved) {
    void vscode.window.showInformationMessage('Kod Sağlığı: ' + formatDelta(delta));
  } else {
    void vscode.window.showWarningMessage('Kod Sağlığı: ' + formatDelta(delta));
  }
}

/** Derlenmeyen testi, derleyici hatasını modele vererek sınırlı sayıda düzeltmeyi dener. */
async function offerRepair(
  gap: CoverageGap,
  ruleSet: TestRuleSet,
  deps: TestFlowDeps,
  previousAttempt: string,
  buildOutput: string,
  attempt: number
): Promise<void> {
  const maxAttempts = Math.max(0, deps.maxRepairAttempts());
  const errors = extractCompilerErrors(buildOutput);
  if (attempt >= maxAttempts) {
    void vscode.window.showErrorMessage(
      'Üretilen test derlenmedi ve onarım denemesi hakkı bitti. Hataları "Kod Sağlığı Derleme" kanalında görebilirsiniz.'
    );
    return;
  }

  const choice = await vscode.window.showErrorMessage(
    'Üretilen test derlenmedi.',
    { modal: true, detail: errors.slice(0, 1200) },
    'Onarmayı Dene',
    'Bırak'
  );
  if (choice !== 'Onarmayı Dene') {
    return;
  }

  try {
    const sources = await readSources(gap, deps);
    if (!sources) {
      return;
    }
    const orchestrator = new TestGenOrchestrator(deps.llm(), deps.audit);
    const proposal = await orchestrator.propose(
      gap,
      ruleSet,
      { ...sources, compilerErrors: errors, previousAttempt },
      { maxContextChars: deps.maxContextChars() }
    );

    const outcome = await previewFileAndDecide(
      {
        filePath: proposal.testPath,
        content: proposal.content,
        rationale: proposal.rationale,
        title: `Kod Sağlığı: ${gap.simpleName} testi — onarım ${attempt + 1}`
      },
      {
        resolveUri: deps.resolveUri,
        targetUri: deps.targetUri,
        provider: deps.previewProvider,
        onAccept: () =>
          deps.audit.record({
            type: 'test-accept',
            ruleKey: ruleSet.id,
            issueKey: gap.qualifiedName,
            file: proposal.testPath,
            detail: `onarım ${attempt + 1}`
          }),
        onReject: () =>
          deps.audit.record({
            type: 'test-reject',
            ruleKey: ruleSet.id,
            issueKey: gap.qualifiedName,
            file: proposal.testPath,
            detail: `onarım ${attempt + 1}`
          })
      }
    );
    if (outcome === 'applied') {
      await offerVerification(gap, ruleSet, deps, proposal.content, attempt + 1);
    }
  } catch (err) {
    await reportError(err, gap, deps);
  }
}

async function reportError(err: unknown, gap: CoverageGap, deps: TestFlowDeps): Promise<TestFlowOutcome> {
  if (err instanceof LlmUnavailableError) {
    await deps.audit.record({
      type: 'error',
      issueKey: gap.qualifiedName,
      provider: deps.llm().id,
      detail: 'llm-unavailable'
    });
    void vscode.window.showWarningMessage(err.message);
    return 'unavailable';
  }
  if (err instanceof LlmConfigError) {
    const pick = await vscode.window.showWarningMessage(err.message, 'Yapılandır');
    if (pick === 'Yapılandır') {
      await vscode.commands.executeCommand('code-health.configure');
    }
    return 'unavailable';
  }
  const message =
    err instanceof TestParseError || err instanceof TestGenContextTooLargeError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  await deps.audit.record({ type: 'error', issueKey: gap.qualifiedName, detail: message });
  void vscode.window.showErrorMessage('Test üretilemedi: ' + message);
  return 'error';
}

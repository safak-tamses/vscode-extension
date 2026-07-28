import { describeReasons } from '../coverage/gaps';
import type { CoverageGap } from '../coverage/gaps';
import type { CoverageScanResult } from '../coverage/service';
import { formatBuilds } from '../coverage/service';
import type { CoverageView, GapView, ProviderStatus } from './messages';

/** Panelde satırları eşlemek için kararlı kimlik: kural seti + sınıf. */
export function gapId(gap: CoverageGap): string {
  return `${gap.ruleSetId}::${gap.moduleRoot}::${gap.qualifiedName}`;
}

const MAX_METHODS_SHOWN = 6;

function toGapView(gap: CoverageGap): GapView {
  const shown = gap.uncoveredMethods.slice(0, MAX_METHODS_SHOWN).map((m) => m.signature);
  if (gap.uncoveredMethods.length > MAX_METHODS_SHOWN) {
    shown.push(`+${gap.uncoveredMethods.length - MAX_METHODS_SHOWN} metot daha`);
  }
  return {
    id: gapId(gap),
    ruleSetId: gap.ruleSetId,
    moduleName: gap.moduleName,
    qualifiedName: gap.qualifiedName,
    simpleName: gap.simpleName,
    packageName: gap.packageName,
    sourcePath: gap.sourcePath,
    testPath: gap.testPath,
    testExists: gap.testExists,
    lineCoverage: gap.lineCoverage,
    branchCoverage: gap.branchCoverage,
    methodCoverage: gap.methodCoverage,
    thresholds: gap.thresholds,
    uncoveredMethods: shown,
    uncoveredMethodCount: gap.uncoveredMethods.length,
    totalMethods: gap.totalMethods,
    reasons: describeReasons(gap.reasons).split(' · ').filter(Boolean),
    reportMissing: gap.reportMissing
  };
}

/** Tarama sonucunu webview'a güvenle aktarılabilir görünüme dönüştürür (saf fonksiyon). */
export function buildCoverageView(
  result: CoverageScanResult,
  provider: ProviderStatus,
  scannedAt: Date
): CoverageView {
  const primary = result.ruleSets[0];
  return {
    summary: {
      lineCoverage: result.summary.lineCoverage,
      branchCoverage: result.summary.branchCoverage,
      methodCoverage: result.summary.methodCoverage,
      moduleCount: result.summary.moduleCount,
      classCount: result.summary.classCount,
      gapCount: result.gaps.length
    },
    thresholds: primary
      ? {
          line: primary.coverage.minLineCoverage,
          branch: primary.coverage.minBranchCoverage,
          method: primary.coverage.minMethodCoverage
        }
      : { line: 80, branch: 70, method: 80 },
    gaps: result.gaps.map(toGapView),
    ruleSets: result.ruleSets.map((rs) => ({
      id: rs.id,
      name: rs.name,
      sourceFile: rs.sourceFile,
      thresholds: {
        line: rs.coverage.minLineCoverage,
        branch: rs.coverage.minBranchCoverage,
        method: rs.coverage.minMethodCoverage
      },
      buildCommand: rs.coverage.buildCommand
    })),
    buildSummary: formatBuilds(result.builds),
    problems: result.problems.map((p) => ({ line: 0, message: `${p.path}: ${p.message}` })),
    ...(result.blocker ? { blocker: result.blocker } : {}),
    provider,
    scannedAt: scannedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  };
}

import type { CoverageGap } from '../coverage/gaps';

export interface CoverageTriple {
  line: number;
  branch: number;
  method: number;
}

export interface CoverageDelta {
  qualifiedName: string;
  before: CoverageTriple;
  after: CoverageTriple;
  delta: CoverageTriple;
  thresholds: CoverageTriple;
  /** Eşiklerin tamamı karşılandı mı? (boşluk listesinden düştüyse de true) */
  resolved: boolean;
  /** Hâlâ hiç çalıştırılmamış metotların imzaları. */
  remainingUncoveredMethods: string[];
  /** Kapsam hiç değişmediyse true (test eklendi ama yeni yol çalıştırmadı). */
  unchanged: boolean;
}

function tripleOf(gap: CoverageGap): CoverageTriple {
  return { line: gap.lineCoverage, branch: gap.branchCoverage, method: gap.methodCoverage };
}

/**
 * Doğrulama derlemesinden sonra önce/sonra kapsam farkını hesaplar (saf fonksiyon).
 * `after` yoksa sınıf boşluk listesinden tamamen düşmüştür: eşikler karşılanmış demektir.
 */
export function computeDelta(before: CoverageGap, after: CoverageGap | undefined): CoverageDelta {
  const thresholds: CoverageTriple = {
    line: before.thresholds.line,
    branch: before.thresholds.branch,
    method: before.thresholds.method
  };
  const beforeTriple = tripleOf(before);
  const afterTriple = after ? tripleOf(after) : { line: 100, branch: 100, method: 100 };
  const delta: CoverageTriple = {
    line: afterTriple.line - beforeTriple.line,
    branch: afterTriple.branch - beforeTriple.branch,
    method: afterTriple.method - beforeTriple.method
  };
  const resolved =
    !after ||
    (afterTriple.line >= thresholds.line &&
      afterTriple.branch >= thresholds.branch &&
      afterTriple.method >= thresholds.method);

  return {
    qualifiedName: before.qualifiedName,
    before: beforeTriple,
    after: afterTriple,
    delta,
    thresholds,
    resolved,
    remainingUncoveredMethods: after ? after.uncoveredMethods.map((m) => m.signature) : [],
    unchanged: Boolean(after) && delta.line === 0 && delta.branch === 0 && delta.method === 0
  };
}

/** Kullanıcıya gösterilecek tek satırlık özet. */
export function formatDelta(delta: CoverageDelta): string {
  const sign = (value: number): string => (value > 0 ? `+${Math.round(value)}` : String(Math.round(value)));
  const parts = [
    `satır %${Math.round(delta.before.line)} → %${Math.round(delta.after.line)} (${sign(delta.delta.line)})`,
    `dal %${Math.round(delta.before.branch)} → %${Math.round(delta.after.branch)} (${sign(delta.delta.branch)})`,
    `metot %${Math.round(delta.before.method)} → %${Math.round(delta.after.method)} (${sign(delta.delta.method)})`
  ];
  const verdict = delta.resolved
    ? 'Eşikler karşılandı.'
    : delta.unchanged
      ? 'Kapsam değişmedi — eklenen test yeni bir yol çalıştırmamış olabilir.'
      : `Hâlâ eşik altında (${delta.remainingUncoveredMethods.length} metot test edilmemiş).`;
  return `${delta.qualifiedName}: ${parts.join(' · ')} — ${verdict}`;
}

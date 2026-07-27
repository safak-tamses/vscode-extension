import type { AuditSink } from '../audit/audit';
import type { CancelSignal } from '../llm/gateway';
import type { DiscoveryProblem, DiscoveryResult } from './discover';
import { computeGaps, summarize } from './gaps';
import type { CoverageGap, CoverageSummary, ModuleReport } from './gaps';
import type { TestRuleSet } from './rules';
import type { LoadedRules, RuleFileReport } from './rulesLoader';

export interface BuildRecord {
  ruleSetId: string;
  command: string;
  /** Komutun çalıştırıldığı, workspace'e göreli dizin. */
  cwd: string;
  ok: boolean;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  /** Atlandıysa gerekçe (onay verilmedi, güvenilmeyen workspace, kullanıcı istemedi). */
  skippedReason?: string;
  output: string;
}

export interface CoverageScanPorts {
  loadRules: () => Promise<LoadedRules>;
  discover: (ruleSets: TestRuleSet[]) => Promise<DiscoveryResult>;
  /**
   * Kural setinin derleme komutunu çalıştırır. `undefined` döndürmek "çalıştırılmadı"
   * anlamına gelir (onay yok, güvenilmeyen workspace vb.) ve tarama var olan raporlarla sürer.
   */
  runBuild: (ruleSet: TestRuleSet, cancel?: CancelSignal) => Promise<BuildRecord | undefined>;
  audit: AuditSink;
}

export interface CoverageScanOptions {
  /** Derleme komutu çalıştırılsın mı? false ise yalnızca var olan raporlar okunur. */
  build: boolean;
  cancel?: CancelSignal;
}

export interface CoverageScanResult {
  ruleSets: TestRuleSet[];
  ruleFiles: RuleFileReport[];
  modules: ModuleReport[];
  gaps: CoverageGap[];
  summary: CoverageSummary;
  problems: DiscoveryProblem[];
  builds: BuildRecord[];
  /** Tarama yapılamadıysa kullanıcıya gösterilecek gerekçe. */
  blocker?: string;
}

function emptyResult(extra: Partial<CoverageScanResult> = {}): CoverageScanResult {
  return {
    ruleSets: [],
    ruleFiles: [],
    modules: [],
    gaps: [],
    summary: summarize([]),
    problems: [],
    builds: [],
    ...extra
  };
}

/**
 * Kapsam taramasının tek akışı: kuralları yükle → (isteğe bağlı) derle → raporları oku →
 * eksik testleri hesapla. Hiçbir dosyaya yazmaz.
 *
 * Aynı derleme komutu birden fazla kural setinde geçiyorsa yalnızca bir kez çalıştırılır.
 */
export async function scanCoverage(
  ports: CoverageScanPorts,
  options: CoverageScanOptions
): Promise<CoverageScanResult> {
  const rules = await ports.loadRules();
  if (rules.ruleSets.length === 0) {
    return emptyResult({
      ruleFiles: rules.files,
      blocker: rules.hasErrors
        ? 'Kural dosyalarında hata var; düzeltilene kadar kapsam taraması yapılamaz.'
        : 'Etkin bir test kural seti bulunamadı. "Kod Sağlığı: Örnek Test Kural Setini Oluştur" ile başlayın.'
    });
  }

  const builds: BuildRecord[] = [];
  if (options.build) {
    const ranCommands = new Set<string>();
    for (const ruleSet of rules.ruleSets) {
      const command = ruleSet.coverage.buildCommand;
      if (ranCommands.has(command)) {
        continue;
      }
      ranCommands.add(command);
      const record = await ports.runBuild(ruleSet, options.cancel);
      if (!record) {
        continue;
      }
      builds.push(record);
      await ports.audit.record({
        type: 'build',
        ruleKey: ruleSet.id,
        file: record.cwd || '(workspace kökü)',
        durationMs: record.durationMs,
        detail: record.skippedReason ?? `${command} → ${record.ok ? 'başarılı' : 'başarısız'}`
      });
      if (options.cancel?.isCancellationRequested) {
        break;
      }
    }
  }

  const discovery = await ports.discover(rules.ruleSets);
  const gaps = computeGaps({
    modules: discovery.modules,
    ruleSets: rules.ruleSets,
    sourceFiles: discovery.sourceFiles,
    testFiles: discovery.testFiles
  });
  const summary = summarize(discovery.modules);

  await ports.audit.record({
    type: 'coverage-scan',
    detail:
      `${discovery.modules.length} rapor · ${gaps.length} eksik test · ` +
      `satır %${Math.round(summary.lineCoverage)} · dal %${Math.round(summary.branchCoverage)}`
  });

  return {
    ruleSets: rules.ruleSets,
    ruleFiles: rules.files,
    modules: discovery.modules,
    gaps,
    summary,
    problems: discovery.problems,
    builds,
    ...(discovery.modules.length === 0 && discovery.sourceFiles.length === 0
      ? {
          blocker:
            'Kural setinin include desenlerine uyan kaynak dosya bulunamadı. ' +
            'Kural dosyasındaki include/exclude desenlerini kontrol edin.'
        }
      : {})
  };
}

/** Derleme kayıtlarından kullanıcıya gösterilecek tek satırlık özet. */
export function formatBuilds(builds: readonly BuildRecord[]): string {
  if (builds.length === 0) {
    return 'Derleme çalıştırılmadı; var olan JaCoCo raporları okundu.';
  }
  return builds
    .map((b) => {
      if (b.skippedReason) {
        return `${b.command}: atlandı (${b.skippedReason})`;
      }
      const seconds = (b.durationMs / 1000).toFixed(1);
      if (b.cancelled) {
        return `${b.command}: iptal edildi (${seconds} sn)`;
      }
      if (b.timedOut) {
        return `${b.command}: zaman aşımı (${seconds} sn)`;
      }
      return `${b.command}: ${b.ok ? 'başarılı' : 'BAŞARISIZ'} (${seconds} sn)`;
    })
    .join(' · ');
}

/** Bir boşluğu, kendisini sahiplenen kural setiyle eşler. */
export function ruleSetFor(gap: CoverageGap, ruleSets: readonly TestRuleSet[]): TestRuleSet | undefined {
  return ruleSets.find((rs) => rs.id === gap.ruleSetId);
}

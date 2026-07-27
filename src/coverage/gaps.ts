import { isIncluded, normalizePath } from './glob';
import { addCounters, emptyCounters, ratio } from './jacoco';
import type { Counters, CoverageReport, MethodCoverage, SourceFileCoverage } from './jacoco';
import { classInfoFromSourcePath, moduleNameOf, sourcePathFor, testPathFor } from './paths';
import type { TestRuleSet } from './rules';

export type GapReason =
  /** Sınıfın kendi test dosyası yok. */
  | 'no-test-file'
  /** Rapora göre hiçbir metodu çalıştırılmamış (ya da rapor hiç yok). */
  | 'no-covered-method'
  /** Kural setindeki eşiklerin altında. */
  | 'below-threshold'
  /** Bazı metotlar hiç çalıştırılmamış. */
  | 'uncovered-methods';

export interface MethodGap {
  name: string;
  /** İnsan okur imza, ör. `create(OrderRequest): Order`. */
  signature: string;
  line?: number;
  lineCoverage: number;
  branchCoverage: number;
  missedInstructions: number;
  complexity: number;
  /** Metot hiç çalıştırılmamış mı? */
  executed: boolean;
}

export interface CoverageGap {
  ruleSetId: string;
  moduleRoot: string;
  moduleName: string;
  /** `com.kurum.OrderService` */
  qualifiedName: string;
  /** `OrderService` */
  simpleName: string;
  /** `com.kurum` */
  packageName: string;
  packagePath: string;
  sourcePath: string;
  testPath: string;
  testExists: boolean;
  lineCoverage: number;
  branchCoverage: number;
  methodCoverage: number;
  totalMethods: number;
  /** Hiç çalıştırılmamış metotlar (öncelikli hedef). */
  uncoveredMethods: MethodGap[];
  /** Kısmen kapsanan metotlar (dalı eksik olanlar). */
  partialMethods: MethodGap[];
  uncoveredLines: number[];
  partiallyCoveredLines: number[];
  reasons: GapReason[];
  /** Öncelik skoru; büyük olan daha acildir. */
  score: number;
  thresholds: { line: number; branch: number; method: number };
  /** Rapor bulunmadığı için kapsam bilinmiyor (tamamı eksik varsayılır). */
  reportMissing: boolean;
}

export interface ModuleReport {
  /** Workspace'e göreli modül kökü; tek modüllü projede "". */
  moduleRoot: string;
  /** Workspace'e göreli rapor yolu. */
  reportPath: string;
  report: CoverageReport;
}

export interface GapInput {
  modules: ModuleReport[];
  /** Öncelik sırasına göre (yüksek priority önce) kural setleri. */
  ruleSets: TestRuleSet[];
  /** Workspace'te bulunan kaynak dosyaların workspace'e göreli yolları. */
  sourceFiles: string[];
  /** Workspace'te var olan test dosyalarının workspace'e göreli yolları. */
  testFiles: string[];
}

export interface CoverageSummary {
  counters: Counters;
  lineCoverage: number;
  branchCoverage: number;
  methodCoverage: number;
  moduleCount: number;
  classCount: number;
}

/** Modül raporlarını tek bir özete indirger. */
export function summarize(modules: ModuleReport[]): CoverageSummary {
  let counters = emptyCounters();
  let classCount = 0;
  for (const module of modules) {
    counters = addCounters(counters, module.report.totals);
    classCount += module.report.classes.length;
  }
  return {
    counters,
    lineCoverage: ratio(counters.line),
    branchCoverage: ratio(counters.branch),
    methodCoverage: ratio(counters.method),
    moduleCount: modules.length,
    classCount
  };
}

function toMethodGap(method: MethodCoverage): MethodGap {
  return {
    name: method.name,
    signature: method.signature,
    ...(method.line !== undefined ? { line: method.line } : {}),
    lineCoverage: ratio(method.counters.line),
    branchCoverage: ratio(method.counters.branch),
    missedInstructions: method.counters.instruction.missed,
    complexity: method.counters.complexity.missed + method.counters.complexity.covered,
    executed: method.executed
  };
}

/** Eksiklik ne kadar acil? Testi olmayan, hiç çalıştırılmamış ve karmaşık olan üste çıkar. */
export function scoreGap(gap: Omit<CoverageGap, 'score'>): number {
  const lineGap = Math.max(0, gap.thresholds.line - gap.lineCoverage);
  const branchGap = Math.max(0, gap.thresholds.branch - gap.branchCoverage);
  const complexity = gap.uncoveredMethods.reduce((sum, m) => sum + m.complexity, 0);
  return (
    lineGap * 1.5 +
    branchGap * 0.75 +
    (gap.testExists ? 0 : 25) +
    (gap.reasons.includes('no-covered-method') ? 20 : 0) +
    gap.uncoveredMethods.length * 3 +
    complexity
  );
}

interface Candidate {
  ruleSet: TestRuleSet;
  moduleRoot: string;
  packagePath: string;
  fileName: string;
  simpleName: string;
  sourcePath: string;
  methods: MethodCoverage[];
  sourceFile?: SourceFileCoverage;
}

function buildGap(candidate: Candidate, testFiles: Set<string>): CoverageGap | undefined {
  const { ruleSet, sourceFile } = candidate;
  const thresholds = {
    line: ruleSet.coverage.minLineCoverage,
    branch: ruleSet.coverage.minBranchCoverage,
    method: ruleSet.coverage.minMethodCoverage
  };
  const testPath = testPathFor(
    candidate.moduleRoot,
    ruleSet.test.testRoot,
    candidate.packagePath,
    candidate.simpleName,
    ruleSet.test.suffix
  );
  const testExists = testFiles.has(testPath);

  // Kurucular ve statik başlatıcılar tek başına test hedefi değildir; ölçüme dahil edilir
  // ama "kapsanmayan metot" listesinde gösterilmez.
  const testable = candidate.methods.filter((m) => m.name !== '<clinit>');
  const uncoveredMethods = testable.filter((m) => !m.executed).map(toMethodGap);
  const partialMethods = testable
    .filter((m) => m.executed && (ratio(m.counters.line) < 100 || ratio(m.counters.branch) < 100))
    .map(toMethodGap);

  const lineCoverage = sourceFile ? ratio(sourceFile.counters.line) : 0;
  const branchCoverage = sourceFile ? ratio(sourceFile.counters.branch) : 100;
  const methodCoverage = sourceFile ? ratio(sourceFile.counters.method) : 0;

  const reasons: GapReason[] = [];
  if (!sourceFile || methodCoverage === 0) {
    reasons.push('no-covered-method');
  }
  if (lineCoverage < thresholds.line || branchCoverage < thresholds.branch || methodCoverage < thresholds.method) {
    reasons.push('below-threshold');
  }
  if (uncoveredMethods.length > 0) {
    reasons.push('uncovered-methods');
  }
  if (reasons.length === 0) {
    // Eşiklerin üstünde ve kapsanmayan metot yok: kendi test dosyası olmasa bile boşluk değildir.
    return undefined;
  }
  if (!testExists) {
    reasons.unshift('no-test-file');
  }

  const withoutScore: Omit<CoverageGap, 'score'> = {
    ruleSetId: ruleSet.id,
    moduleRoot: candidate.moduleRoot,
    moduleName: moduleNameOf(candidate.moduleRoot),
    qualifiedName: candidate.packagePath
      ? `${candidate.packagePath.replace(/\//g, '.')}.${candidate.simpleName}`
      : candidate.simpleName,
    simpleName: candidate.simpleName,
    packageName: candidate.packagePath.replace(/\//g, '.'),
    packagePath: candidate.packagePath,
    sourcePath: candidate.sourcePath,
    testPath,
    testExists,
    lineCoverage,
    branchCoverage,
    methodCoverage,
    totalMethods: testable.length,
    uncoveredMethods,
    partialMethods,
    uncoveredLines: sourceFile ? [...sourceFile.uncoveredLines].sort((a, b) => a - b) : [],
    partiallyCoveredLines: sourceFile ? [...sourceFile.partiallyCoveredLines].sort((a, b) => a - b) : [],
    reasons,
    thresholds,
    reportMissing: !sourceFile
  };

  return { ...withoutScore, score: scoreGap(withoutScore) };
}

/**
 * Kapsam raporları + kural setlerinden eksik test listesini üretir (saf fonksiyon).
 *
 * - Her kaynak dosya, `include`/`exclude` desenlerine uyan EN YÜKSEK öncelikli kural
 *   seti tarafından sahiplenilir; aynı dosya iki kez listelenmez.
 * - Raporda hiç görünmeyen kaynaklar (ör. hiç test olmadığı için JaCoCo dosyası
 *   üretilmemiş) `reportMissing` ile %0 kapsam olarak listelenir.
 */
export function computeGaps(input: GapInput): CoverageGap[] {
  const testFiles = new Set(input.testFiles.map(normalizePath));
  const gaps: CoverageGap[] = [];
  const claimed = new Set<string>();

  const ruleFor = (sourcePath: string): TestRuleSet | undefined =>
    input.ruleSets.find((rs) => isIncluded(sourcePath, rs.include, rs.exclude));

  // 1) Raporlarda görünen sınıflar
  for (const module of input.modules) {
    const methodsByFile = new Map<string, MethodCoverage[]>();
    const simpleNameByFile = new Map<string, string>();
    for (const cls of module.report.classes) {
      const key = `${cls.packagePath}/${cls.sourceFileName}`;
      const list = methodsByFile.get(key) ?? [];
      list.push(...cls.methods);
      methodsByFile.set(key, list);
      // İç sınıflar aynı dosyayı paylaşır; test dosyası üst düzey sınıfa göre adlandırılır.
      const topLevel = cls.simpleName.split('$')[0] ?? cls.simpleName;
      if (!simpleNameByFile.has(key) || !cls.simpleName.includes('$')) {
        simpleNameByFile.set(key, topLevel);
      }
    }

    for (const sourceFile of module.report.sourceFiles) {
      if (!sourceFile.name.toLowerCase().endsWith('.java')) {
        continue;
      }
      const key = `${sourceFile.packagePath}/${sourceFile.name}`;
      const simpleName = simpleNameByFile.get(key) ?? sourceFile.name.replace(/\.java$/i, '');
      // Kural seti sourceRoot'a göre yol kurar; hangi kural setinin sahiplendiğini bulmak için
      // önce aday yolu üret, sonra include/exclude uygula.
      let matched: { ruleSet: TestRuleSet; sourcePath: string } | undefined;
      for (const ruleSet of input.ruleSets) {
        const sourcePath = sourcePathFor(
          module.moduleRoot,
          ruleSet.test.sourceRoot,
          sourceFile.packagePath,
          sourceFile.name
        );
        if (isIncluded(sourcePath, ruleSet.include, ruleSet.exclude)) {
          matched = { ruleSet, sourcePath };
          break;
        }
      }
      if (!matched || claimed.has(matched.sourcePath)) {
        continue;
      }
      const gap = buildGap(
        {
          ruleSet: matched.ruleSet,
          moduleRoot: module.moduleRoot,
          packagePath: sourceFile.packagePath,
          fileName: sourceFile.name,
          simpleName,
          sourcePath: matched.sourcePath,
          methods: methodsByFile.get(key) ?? [],
          sourceFile
        },
        testFiles
      );
      claimed.add(matched.sourcePath);
      if (gap) {
        gaps.push(gap);
      }
    }
  }

  // 2) Raporda hiç görünmeyen kaynaklar
  for (const rawPath of input.sourceFiles) {
    const sourcePath = normalizePath(rawPath);
    if (claimed.has(sourcePath)) {
      continue;
    }
    const ruleSet = ruleFor(sourcePath);
    if (!ruleSet) {
      continue;
    }
    const info = classInfoFromSourcePath(sourcePath, ruleSet.test.sourceRoot);
    if (!info) {
      continue;
    }
    claimed.add(sourcePath);
    const gap = buildGap(
      {
        ruleSet,
        moduleRoot: info.moduleRoot,
        packagePath: info.packagePath,
        fileName: info.fileName,
        simpleName: info.simpleName,
        sourcePath,
        methods: []
      },
      testFiles
    );
    if (gap) {
      gaps.push(gap);
    }
  }

  gaps.sort((a, b) => b.score - a.score || a.qualifiedName.localeCompare(b.qualifiedName));
  return gaps;
}

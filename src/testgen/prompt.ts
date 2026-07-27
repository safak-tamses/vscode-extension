import type { CoverageGap, MethodGap } from '../coverage/gaps';
import type { TestRuleSet } from '../coverage/rules';

export interface TestGenSources {
  /** Hedef sınıfın tam kaynağı. */
  sourceText: string;
  /** Varsa mevcut test dosyasının TAM içeriği (kırpılmamış olmalı). */
  existingTestText?: string;
  /** Onarım turunda: önceki denemenin derleyici/test hataları. */
  compilerErrors?: string;
  /** Onarım turunda: derlenmeyen önceki test içeriği. */
  previousAttempt?: string;
}

export interface TestGenContext {
  system: string;
  prompt: string;
  /** Modelden beklenen test dosyası yolu. */
  testPath: string;
  /** İstem kaynak kodu kırpılarak mı üretildi? */
  sourceTruncated: boolean;
}

/** Bağlam bütçesi mevcut test dosyasını bile almaya yetmediğinde fırlatılır. */
export class TestGenContextTooLargeError extends Error {
  constructor(
    readonly requiredChars: number,
    readonly budgetChars: number
  ) {
    super(
      `Test üretimi için gereken bağlam (${requiredChars} karakter) ayrılan bütçeyi (${budgetChars}) aşıyor. ` +
        'Mevcut test dosyasını bölmeyi ya da "codeHealth.testGen.maxContextChars" değerini artırmayı deneyin.'
    );
    this.name = 'TestGenContextTooLargeError';
  }
}

export const TEST_SYSTEM_PROMPT = [
  'Sen kıdemli bir Java geliştiricisisin ve eksik birim testlerini yazıyorsun.',
  'Ekibin test yazım kurallarına harfiyen uyarsın.',
  'Yanıtın SADECE şu üç parçadan oluşur: "DOSYA:" satırı, tek bir java kod bloğu ve "GEREKÇE:" satırı.',
  'Kod bloğu, dosyanın kaydedilmeye hazır TAM içeriğidir (package, import ve sınıf gövdesi dahil).',
  'Üretim kodunu değiştirme, açıklama paragrafı veya markdown başlığı yazma.'
].join(' ');

/** `[24,25,26,31,32,40]` -> `"24-26, 31-32, 40"` (saf fonksiyon). */
export function formatLineRanges(lines: readonly number[], maxRanges = 25): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return '';
  }
  const ranges: Array<[number, number]> = [];
  let start = sorted[0] as number;
  let prev = start;
  for (const nr of sorted.slice(1)) {
    if (nr === prev + 1) {
      prev = nr;
      continue;
    }
    ranges.push([start, prev]);
    start = nr;
    prev = nr;
  }
  ranges.push([start, prev]);

  const shown = ranges.slice(0, maxRanges).map(([a, b]) => (a === b ? String(a) : `${a}-${b}`));
  const hidden = ranges.length - shown.length;
  return shown.join(', ') + (hidden > 0 ? ` … (+${hidden} aralık)` : '');
}

function describeMethods(methods: readonly MethodGap[]): string {
  return methods
    .map((m) => {
      const where = m.line !== undefined ? ` (satır ${m.line})` : '';
      const branch =
        m.branchCoverage < 100 ? `, dal kapsamı %${Math.round(m.branchCoverage)}` : '';
      return `- ${m.signature}${where}${branch}`;
    })
    .join('\n');
}

/**
 * Kaynağı bütçeye sığdırır: dosya başı (package/import/sınıf bildirimi/alanlar) ve
 * hedef satırların çevresi korunur, aradaki bölümler `// ...` ile kısaltılır.
 */
export function truncateJavaSource(
  text: string,
  targetLines: readonly number[],
  budget: number,
  headerLines = 45,
  before = 6,
  after = 30
): { text: string; truncated: boolean } {
  if (text.length <= budget) {
    return { text, truncated: false };
  }
  const lines = text.split('\n');
  const keep = new Set<number>();
  for (let i = 1; i <= Math.min(headerLines, lines.length); i++) {
    keep.add(i);
  }
  for (const target of targetLines) {
    for (let i = Math.max(1, target - before); i <= Math.min(lines.length, target + after); i++) {
      keep.add(i);
    }
  }
  // Hiç hedef satır yoksa baştan itibaren bütçe kadarını al.
  if (targetLines.length === 0) {
    return { text: text.slice(0, budget) + '\n// ... (kırpıldı) ...\n', truncated: true };
  }

  const out: string[] = [];
  let elided = false;
  let used = 0;
  for (let i = 1; i <= lines.length; i++) {
    if (!keep.has(i)) {
      if (!elided) {
        out.push('// ... (kırpıldı) ...');
        elided = true;
      }
      continue;
    }
    const line = lines[i - 1] ?? '';
    if (used + line.length > budget) {
      out.push('// ... (kırpıldı) ...');
      break;
    }
    out.push(line);
    used += line.length + 1;
    elided = false;
  }
  return { text: out.join('\n'), truncated: true };
}

/**
 * Test üretimi istemini kurar (saf fonksiyon).
 *
 * Kural setinin Markdown gövdesi AYNEN aktarılır; kapsam raporundan gelen kapsanmayan
 * metot ve satır numaraları isteme birebir yazılır, böylece model neyi test edeceğini
 * tahmin etmek zorunda kalmaz.
 */
export function buildTestPrompt(
  gap: CoverageGap,
  ruleSet: TestRuleSet,
  sources: TestGenSources,
  maxContextChars = 60000
): TestGenContext {
  const pct = (value: number): string => `%${Math.round(value)}`;
  const isRepair = Boolean(sources.compilerErrors && sources.previousAttempt);

  const head: string[] = [
    isRepair
      ? 'Aşağıdaki test dosyası DERLENMEDİ. Hataları giderip dosyanın düzeltilmiş tam halini ver.'
      : 'Aşağıdaki sınıf için eksik birim testlerini yaz.',
    '',
    `Sınıf:          ${gap.qualifiedName}`,
    `Modül:          ${gap.moduleName}`,
    `Kaynak dosya:   ${gap.sourcePath}`,
    `Test dosyası:   ${gap.testPath}` +
      (gap.testExists ? '  (VAR — korunacak ve genişletilecek)' : '  (YOK — sıfırdan yazılacak)'),
    ''
  ];

  if (gap.reportMissing) {
    head.push(
      'Kapsam raporunda bu sınıf hiç görünmüyor: sınıfın hiçbir satırı test tarafından çalıştırılmamış.',
      'Tüm public davranışı sıfırdan test et.',
      ''
    );
  } else {
    head.push(
      'Mevcut kapsam (eşik):',
      `- satır:  ${pct(gap.lineCoverage)} (en az ${pct(gap.thresholds.line)})`,
      `- dal:    ${pct(gap.branchCoverage)} (en az ${pct(gap.thresholds.branch)})`,
      `- metot:  ${pct(gap.methodCoverage)} (en az ${pct(gap.thresholds.method)})`,
      ''
    );
  }

  if (gap.uncoveredMethods.length > 0) {
    head.push('HİÇ TEST EDİLMEMİŞ METOTLAR (birincil hedef):', describeMethods(gap.uncoveredMethods), '');
  }
  if (gap.partialMethods.length > 0) {
    head.push('KISMEN KAPSANAN METOTLAR (eksik dalları tamamla):', describeMethods(gap.partialMethods), '');
  }
  const uncovered = formatLineRanges(gap.uncoveredLines);
  if (uncovered) {
    head.push(`Çalıştırılmamış satırlar: ${uncovered}`);
  }
  const partial = formatLineRanges(gap.partiallyCoveredLines);
  if (partial) {
    head.push(`Kısmen kapsanan satırlar: ${partial}`);
  }
  head.push('');

  const rulesBlock = [
    `=== EKİBİN TEST YAZIM KURALLARI (kural seti: ${ruleSet.name}) ===`,
    'Bu kurallara uymak ZORUNLUDUR:',
    '',
    ruleSet.guidelines,
    ''
  ].join('\n');

  const contract = [
    '=== ÇIKTI BİÇİMİ (birebir uy) ===',
    `DOSYA: ${gap.testPath}`,
    '```java',
    '<test dosyasının tam içeriği>',
    '```',
    'GEREKÇE: hangi metotlar/senaryolar için hangi testleri eklediğini 1-3 cümlede yaz.',
    '',
    `Sınıf adı ${testClassName(gap.testPath)}, paket ${gap.packageName || '(varsayılan paket)'} olmalıdır.`
  ].join('\n');

  const existingBlock = sources.existingTestText
    ? [
        `=== MEVCUT TEST DOSYASI: ${gap.testPath} ===`,
        'Bu dosyadaki testleri SİLME ve DEĞİŞTİRME; yalnızca eksik senaryolar için yeni metotlar ekle.',
        '```java',
        sources.existingTestText,
        '```',
        ''
      ].join('\n')
    : '';

  const repairBlock = isRepair
    ? [
        '=== ÖNCEKİ DENEMENİN HATALARI ===',
        '```',
        sources.compilerErrors ?? '',
        '```',
        '',
        '=== DÜZELTİLECEK DOSYA ===',
        '```java',
        sources.previousAttempt ?? '',
        '```',
        ''
      ].join('\n')
    : '';

  const header = head.join('\n');
  const fixed = [header, rulesBlock, existingBlock, repairBlock, contract].join('\n');
  const sourceOverhead = `=== TEST EDİLECEK KAYNAK: ${gap.sourcePath} ===\n\`\`\`java\n\n\`\`\`\n\n`.length;
  const remaining = maxContextChars - fixed.length - sourceOverhead;

  if (remaining < 500) {
    throw new TestGenContextTooLargeError(fixed.length + sourceOverhead + sources.sourceText.length, maxContextChars);
  }

  const targetLines = [
    ...gap.uncoveredMethods.map((m) => m.line).filter((l): l is number => l !== undefined),
    ...gap.partialMethods.map((m) => m.line).filter((l): l is number => l !== undefined),
    ...gap.uncoveredLines
  ];
  const { text: sourceText, truncated } = truncateJavaSource(sources.sourceText, targetLines, remaining);

  const prompt = [
    header,
    rulesBlock,
    `=== TEST EDİLECEK KAYNAK: ${gap.sourcePath} ===`,
    ...(truncated ? ['(Uzunluk nedeniyle ilgisiz bölümler `// ... (kırpıldı) ...` ile kısaltıldı.)'] : []),
    '```java',
    sourceText,
    '```',
    '',
    existingBlock,
    repairBlock,
    contract
  ].join('\n');

  return { system: TEST_SYSTEM_PROMPT, prompt, testPath: gap.testPath, sourceTruncated: truncated };
}

/** `.../OrderServiceTest.java` -> `OrderServiceTest` */
export function testClassName(testPath: string): string {
  const file = testPath.split('/').pop() ?? testPath;
  return file.replace(/\.java$/i, '');
}

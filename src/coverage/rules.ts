/**
 * Birim test kural seti formatı: Markdown + frontmatter.
 *
 * Dosya `<workspace>/<codeHealth.rulesDir>/*.md` altında bulunur. `---` ile sınırlanan
 * frontmatter makine tarafından okunur; `---`'dan sonraki serbest Markdown gövdesi
 * (guidelines) LLM istemine AYNEN girer.
 *
 * Bilinçli olarak tam YAML DEĞİLDİR: sıfır bağımlılık ilkesi gereği yalnızca küçük,
 * kesin ve test edilmiş bir alt küme desteklenir. Alt küme dışı sözdizimi sessizce
 * yutulmaz; satır numaralı hata olarak kullanıcıya gösterilir.
 */

export type FrontmatterScalar = string | number | boolean;
export type FrontmatterNode = FrontmatterScalar | FrontmatterScalar[] | Record<string, FrontmatterScalar>;

/** Kural dosyasındaki bir sorun; `line` 1-tabanlıdır (0 = dosya geneli). */
export interface RuleIssue {
  line: number;
  message: string;
}

export interface CoverageRules {
  tool: 'jacoco';
  /** Rapor dosyasının glob deseni; varsayılan olarak Maven'in jacoco.xml yolunu tarar. */
  reportPath: string;
  /** Kapsam raporunu üreten derleme komutu, ör. `mvn clean install`. */
  buildCommand: string;
  buildTimeoutSec: number;
  minLineCoverage: number;
  minBranchCoverage: number;
  minMethodCoverage: number;
}

export interface TestRules {
  framework: string;
  sourceRoot: string;
  testRoot: string;
  /** Test sınıfı adı eki: `OrderService` -> `OrderServiceTest`. */
  suffix: string;
  mocking: string;
  assertions: string;
}

export interface TestRuleSet {
  id: string;
  name: string;
  language: 'java';
  enabled: boolean;
  /** Büyük olan önce uygulanır. */
  priority: number;
  include: string[];
  exclude: string[];
  coverage: CoverageRules;
  test: TestRules;
  /** Frontmatter'dan sonraki serbest Markdown; LLM istemine aynen girer. */
  guidelines: string;
  /** Kural dosyasının workspace'e göreli yolu. */
  sourceFile: string;
}

export interface ParsedRuleSet {
  ruleSet?: TestRuleSet;
  errors: RuleIssue[];
  warnings: RuleIssue[];
}

const TOP_LEVEL_KEYS = [
  'id',
  'name',
  'language',
  'enabled',
  'priority',
  'include',
  'exclude',
  'coverage',
  'test'
];
const COVERAGE_KEYS = [
  'tool',
  'reportPath',
  'buildCommand',
  'buildTimeoutSec',
  'minLineCoverage',
  'minBranchCoverage',
  'minMethodCoverage'
];
const TEST_KEYS = ['framework', 'sourceRoot', 'testRoot', 'suffix', 'mocking', 'assertions'];

interface Frontmatter {
  values: Map<string, FrontmatterNode>;
  /** Anahtar -> tanımlandığı satır (1-tabanlı), hata mesajları için. */
  lines: Map<string, number>;
  errors: RuleIssue[];
  /** Gövdenin başladığı satır indeksi (0-tabanlı). */
  bodyStart: number;
}

/** `---` bloğunu, desteklenen alt kümeye göre ayrıştırır. */
function parseFrontmatter(lines: string[]): Frontmatter {
  const values = new Map<string, FrontmatterNode>();
  const keyLines = new Map<string, number>();
  const errors: RuleIssue[] = [];

  let start = 0;
  while (start < lines.length && lines[start]?.trim() === '') {
    start += 1;
  }
  if (lines[start]?.trim() !== '---') {
    errors.push({
      line: start + 1,
      message: 'Dosya `---` satırıyla başlamalı (frontmatter bloğu bulunamadı).'
    });
    return { values, lines: keyLines, errors, bodyStart: start };
  }

  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    errors.push({ line: start + 1, message: 'Frontmatter bloğu kapatılmamış (ikinci `---` satırı yok).' });
    return { values, lines: keyLines, errors, bodyStart: lines.length };
  }

  let pendingKey: string | undefined;
  let pendingList: FrontmatterScalar[] | undefined;
  let pendingMap: Record<string, FrontmatterScalar> | undefined;

  const flush = (): void => {
    if (pendingKey === undefined) {
      return;
    }
    if (pendingList) {
      values.set(pendingKey, pendingList);
    } else if (pendingMap) {
      values.set(pendingKey, pendingMap);
    } else {
      errors.push({
        line: keyLines.get(pendingKey) ?? 0,
        message: `"${pendingKey}:" altında girintili bir liste (\`- deger\`) veya alan (\`anahtar: deger\`) bekleniyordu.`
      });
    }
    pendingKey = undefined;
    pendingList = undefined;
    pendingMap = undefined;
  };

  for (let i = start + 1; i < end; i++) {
    const raw = lines[i] ?? '';
    const lineNo = i + 1;
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      continue;
    }
    if (/^\t/.test(raw) || /^ *\t/.test(raw)) {
      errors.push({ line: lineNo, message: 'Girinti için sekme (TAB) kullanılamaz; boşluk kullanın.' });
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();

    if (indent === 0) {
      flush();
      const match = /^([\p{L}_][\p{L}\p{N}_-]*)\s*:\s*(.*)$/u.exec(body);
      if (!match) {
        errors.push({
          line: lineNo,
          message: `Anlaşılamayan satır: "${body}". Beklenen biçim: \`anahtar: deger\`.`
        });
        continue;
      }
      const key = match[1] as string;
      const value = (match[2] ?? '').trim();
      if (values.has(key)) {
        errors.push({ line: lineNo, message: `"${key}" birden fazla kez tanımlanmış.` });
      }
      keyLines.set(key, lineNo);
      if (value === '') {
        pendingKey = key;
      } else {
        values.set(key, parseScalar(value));
      }
      continue;
    }

    if (pendingKey === undefined) {
      errors.push({
        line: lineNo,
        message: `Beklenmeyen girinti: "${body}". Girintili satırlar yalnızca bir üst anahtarın altında olabilir.`
      });
      continue;
    }

    if (body.startsWith('-')) {
      if (pendingMap) {
        errors.push({
          line: lineNo,
          message: `"${pendingKey}" altında liste ve alan karışık kullanılamaz.`
        });
        continue;
      }
      const item = body.replace(/^-\s*/, '');
      if (item === '') {
        errors.push({ line: lineNo, message: 'Liste öğesi boş olamaz.' });
        continue;
      }
      pendingList = pendingList ?? [];
      pendingList.push(parseScalar(item));
      continue;
    }

    const nested = /^([\p{L}_][\p{L}\p{N}_-]*)\s*:\s*(.*)$/u.exec(body);
    if (!nested) {
      errors.push({
        line: lineNo,
        message: `Anlaşılamayan satır: "${body}". Beklenen biçim: \`- deger\` veya \`anahtar: deger\`.`
      });
      continue;
    }
    if (pendingList) {
      errors.push({
        line: lineNo,
        message: `"${pendingKey}" altında liste ve alan karışık kullanılamaz.`
      });
      continue;
    }
    const nestedValue = (nested[2] ?? '').trim();
    if (nestedValue === '') {
      errors.push({
        line: lineNo,
        message: `"${nested[1]}" için değer verilmedi. İki seviyeden derin iç içe yapı desteklenmiyor.`
      });
      continue;
    }
    pendingMap = pendingMap ?? {};
    pendingMap[nested[1] as string] = parseScalar(nestedValue);
    keyLines.set(`${pendingKey}.${nested[1]}`, lineNo);
  }
  flush();

  return { values, lines: keyLines, errors, bodyStart: end + 1 };
}

/** Tırnakları çözer, `true`/`false` ve sayıları tipler. */
export function parseScalar(raw: string): FrontmatterScalar {
  const value = raw.trim();
  const quoted = /^"([\s\S]*)"$/.exec(value) ?? /^'([\s\S]*)'$/.exec(value);
  if (quoted) {
    return quoted[1] as string;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

interface Ctx {
  fm: Frontmatter;
  errors: RuleIssue[];
  warnings: RuleIssue[];
}

function lineOf(ctx: Ctx, key: string): number {
  return ctx.fm.lines.get(key) ?? 0;
}

function readString(ctx: Ctx, key: string, fallback: string, required = false): string {
  const value = ctx.fm.values.get(key);
  if (value === undefined) {
    if (required) {
      ctx.errors.push({ line: 0, message: `Zorunlu alan eksik: "${key}".` });
    }
    return fallback;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    ctx.errors.push({ line: lineOf(ctx, key), message: `"${key}" metin olmalı ve boş bırakılamaz.` });
    return fallback;
  }
  return value.trim();
}

function readList(ctx: Ctx, key: string, fallback: string[], required = false): string[] {
  const value = ctx.fm.values.get(key);
  if (value === undefined) {
    if (required) {
      ctx.errors.push({
        line: 0,
        message: `Zorunlu alan eksik: "${key}". En az bir glob deseni verin (ör. \`- "src/main/java/**/*.java"\`).`
      });
    }
    return fallback;
  }
  if (!Array.isArray(value)) {
    ctx.errors.push({
      line: lineOf(ctx, key),
      message: `"${key}" bir liste olmalı (her satırda \`- deger\`).`
    });
    return fallback;
  }
  const items = value.map((v) => String(v).trim()).filter((v) => v !== '');
  if (required && items.length === 0) {
    ctx.errors.push({ line: lineOf(ctx, key), message: `"${key}" listesi boş olamaz.` });
  }
  return items;
}

function readNested(ctx: Ctx, key: string): Record<string, FrontmatterScalar> {
  const value = ctx.fm.values.get(key);
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    ctx.errors.push({
      line: lineOf(ctx, key),
      message: `"${key}" girintili alanlardan oluşan bir blok olmalı.`
    });
    return {};
  }
  return value;
}

function nestedString(
  ctx: Ctx,
  parent: string,
  node: Record<string, FrontmatterScalar>,
  key: string,
  fallback: string,
  required = false
): string {
  const value = node[key];
  if (value === undefined) {
    if (required) {
      ctx.errors.push({
        line: lineOf(ctx, parent),
        message: `Zorunlu alan eksik: "${parent}.${key}".`
      });
    }
    return fallback;
  }
  const text = String(value).trim();
  if (text === '') {
    ctx.errors.push({ line: lineOf(ctx, `${parent}.${key}`), message: `"${parent}.${key}" boş olamaz.` });
    return fallback;
  }
  return text;
}

function nestedNumber(
  ctx: Ctx,
  parent: string,
  node: Record<string, FrontmatterScalar>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = node[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    ctx.errors.push({
      line: lineOf(ctx, `${parent}.${key}`),
      message: `"${parent}.${key}" sayı olmalı.`
    });
    return fallback;
  }
  if (value < min || value > max) {
    ctx.errors.push({
      line: lineOf(ctx, `${parent}.${key}`),
      message: `"${parent}.${key}" ${min}-${max} aralığında olmalı (verilen: ${value}).`
    });
    return fallback;
  }
  return value;
}

function warnUnknown(ctx: Ctx, known: string[], keys: Iterable<string>, prefix: string): void {
  for (const key of keys) {
    if (!known.includes(key)) {
      ctx.warnings.push({
        line: lineOf(ctx, prefix ? `${prefix}.${key}` : key),
        message: `Bilinmeyen alan yok sayıldı: "${prefix ? prefix + '.' : ''}${key}".`
      });
    }
  }
}

/** Bir kural dosyasının tam metnini ayrıştırır ve doğrular (saf fonksiyon). */
export function parseRuleSet(text: string, sourceFile: string): ParsedRuleSet {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const fm = parseFrontmatter(lines);
  const ctx: Ctx = { fm, errors: [...fm.errors], warnings: [] };

  if (fm.values.size === 0) {
    return { errors: ctx.errors, warnings: ctx.warnings };
  }

  warnUnknown(ctx, TOP_LEVEL_KEYS, fm.values.keys(), '');

  const id = readString(ctx, 'id', '', true);
  const name = readString(ctx, 'name', id || sourceFile);

  const languageRaw = readString(ctx, 'language', 'java');
  if (languageRaw !== 'java') {
    ctx.errors.push({
      line: lineOf(ctx, 'language'),
      message: `Bu sürümde yalnızca "java" destekleniyor (verilen: "${languageRaw}").`
    });
  }

  const enabledRaw = fm.values.get('enabled');
  let enabled = true;
  if (enabledRaw !== undefined) {
    if (typeof enabledRaw !== 'boolean') {
      ctx.errors.push({ line: lineOf(ctx, 'enabled'), message: '"enabled" true veya false olmalı.' });
    } else {
      enabled = enabledRaw;
    }
  }

  const priorityRaw = fm.values.get('priority');
  let priority = 100;
  if (priorityRaw !== undefined) {
    if (typeof priorityRaw !== 'number') {
      ctx.errors.push({ line: lineOf(ctx, 'priority'), message: '"priority" sayı olmalı.' });
    } else {
      priority = priorityRaw;
    }
  }

  const include = readList(ctx, 'include', [], true);
  const exclude = readList(ctx, 'exclude', []);

  const coverageNode = readNested(ctx, 'coverage');
  warnUnknown(ctx, COVERAGE_KEYS, Object.keys(coverageNode), 'coverage');
  const tool = nestedString(ctx, 'coverage', coverageNode, 'tool', 'jacoco');
  if (tool !== 'jacoco') {
    ctx.errors.push({
      line: lineOf(ctx, 'coverage.tool'),
      message: `Bu sürümde yalnızca "jacoco" destekleniyor (verilen: "${tool}").`
    });
  }
  const coverage: CoverageRules = {
    tool: 'jacoco',
    reportPath: nestedString(
      ctx,
      'coverage',
      coverageNode,
      'reportPath',
      '**/target/site/jacoco/jacoco.xml'
    ),
    buildCommand: nestedString(ctx, 'coverage', coverageNode, 'buildCommand', '', true),
    buildTimeoutSec: nestedNumber(ctx, 'coverage', coverageNode, 'buildTimeoutSec', 900, 10, 7200),
    minLineCoverage: nestedNumber(ctx, 'coverage', coverageNode, 'minLineCoverage', 80, 0, 100),
    minBranchCoverage: nestedNumber(ctx, 'coverage', coverageNode, 'minBranchCoverage', 70, 0, 100),
    minMethodCoverage: nestedNumber(ctx, 'coverage', coverageNode, 'minMethodCoverage', 80, 0, 100)
  };

  const testNode = readNested(ctx, 'test');
  warnUnknown(ctx, TEST_KEYS, Object.keys(testNode), 'test');
  const test: TestRules = {
    framework: nestedString(ctx, 'test', testNode, 'framework', 'junit5'),
    sourceRoot: nestedString(ctx, 'test', testNode, 'sourceRoot', 'src/main/java'),
    testRoot: nestedString(ctx, 'test', testNode, 'testRoot', 'src/test/java'),
    suffix: nestedString(ctx, 'test', testNode, 'suffix', 'Test'),
    mocking: nestedString(ctx, 'test', testNode, 'mocking', 'mockito'),
    assertions: nestedString(ctx, 'test', testNode, 'assertions', 'assertj')
  };

  const guidelines = lines.slice(fm.bodyStart).join('\n').trim();
  if (guidelines === '') {
    ctx.warnings.push({
      line: fm.bodyStart + 1,
      message:
        'Kural gövdesi boş. `---` satırından sonra yazdığınız kurallar modele aynen iletilir; ' +
        'buraya ekibinizin test yazım kurallarını ekleyin.'
    });
  }

  if (ctx.errors.length > 0) {
    return { errors: ctx.errors, warnings: ctx.warnings };
  }

  return {
    ruleSet: {
      id,
      name,
      language: 'java',
      enabled,
      priority,
      include,
      exclude,
      coverage,
      test,
      guidelines,
      sourceFile
    },
    errors: [],
    warnings: ctx.warnings
  };
}

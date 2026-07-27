/**
 * Bağımlılıksız JaCoCo XML okuyucu (`target/site/jacoco/jacoco.xml`).
 *
 * Tam bir XML ayrıştırıcı DEĞİLDİR: yalnızca JaCoCo'nun ürettiği düğümleri
 * (report / package / class / method / sourcefile / line / counter) okur;
 * XML bildirimi, DOCTYPE (harici DTD'ye başvurur), yorum ve CDATA blokları atlanır.
 */

export interface Counter {
  missed: number;
  covered: number;
}

export type CounterType = 'INSTRUCTION' | 'BRANCH' | 'LINE' | 'COMPLEXITY' | 'METHOD' | 'CLASS';

export interface Counters {
  instruction: Counter;
  branch: Counter;
  line: Counter;
  complexity: Counter;
  method: Counter;
}

export interface MethodCoverage {
  /** JVM metot adı; kurucu için `<init>`. */
  name: string;
  /** JVM tip imzası, ör. `(Ljava/lang/String;)V`. */
  desc: string;
  /** İnsan okur imza, ör. `create(OrderRequest): Order`. */
  signature: string;
  /** Metodun başladığı satır (rapor veriyorsa). */
  line?: number;
  counters: Counters;
  /** METHOD sayacına göre metot hiç çalıştırılmış mı? */
  executed: boolean;
}

export interface ClassCoverage {
  /** Bölü ile ayrık iç ad, ör. `com/kurum/OrderService`. */
  internalName: string;
  /** Nokta ile ayrık tam ad, ör. `com.kurum.OrderService`. */
  qualifiedName: string;
  /** Sınıf adı, ör. `OrderService` (iç sınıflarda `OrderService$Inner`). */
  simpleName: string;
  /** Nokta ile ayrık paket, ör. `com.kurum`. */
  packageName: string;
  /** Paketin bölü ile ayrık hali, ör. `com/kurum`. */
  packagePath: string;
  sourceFileName: string;
  methods: MethodCoverage[];
  counters: Counters;
}

export interface LineCoverage {
  nr: number;
  missedInstructions: number;
  coveredInstructions: number;
  missedBranches: number;
  coveredBranches: number;
}

export interface SourceFileCoverage {
  packageName: string;
  packagePath: string;
  /** Dosya adı, ör. `OrderService.java`. */
  name: string;
  /** Paket dahil göreli yol, ör. `com/kurum/OrderService.java`. */
  relativePath: string;
  lines: LineCoverage[];
  /** Hiç çalıştırılmamış satırlar. */
  uncoveredLines: number[];
  /** Kısmen kapsanan (dalı/komutu eksik) satırlar. */
  partiallyCoveredLines: number[];
  counters: Counters;
}

export interface CoverageReport {
  name: string;
  classes: ClassCoverage[];
  sourceFiles: SourceFileCoverage[];
  totals: Counters;
}

export class JacocoParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JacocoParseError';
  }
}

export function emptyCounter(): Counter {
  return { missed: 0, covered: 0 };
}

export function emptyCounters(): Counters {
  return {
    instruction: emptyCounter(),
    branch: emptyCounter(),
    line: emptyCounter(),
    complexity: emptyCounter(),
    method: emptyCounter()
  };
}

/** Sayacın yüzde kapsamı. Kapsanacak bir şey yoksa 100 döner (eksik sayılmaz). */
export function ratio(counter: Counter): number {
  const total = counter.missed + counter.covered;
  if (total === 0) {
    return 100;
  }
  return (counter.covered / total) * 100;
}

/** İki sayacı toplar (modüller arası özet için). */
export function addCounter(a: Counter, b: Counter): Counter {
  return { missed: a.missed + b.missed, covered: a.covered + b.covered };
}

export function addCounters(a: Counters, b: Counters): Counters {
  return {
    instruction: addCounter(a.instruction, b.instruction),
    branch: addCounter(a.branch, b.branch),
    line: addCounter(a.line, b.line),
    complexity: addCounter(a.complexity, b.complexity),
    method: addCounter(a.method, b.method)
  };
}

// ---------------------------------------------------------------- tag tarayıcı

interface Tag {
  name: string;
  attrs: Record<string, string>;
  kind: 'open' | 'close' | 'self';
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return ENTITIES[body] ?? match;
  });
}

const ATTR_RE = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(source)) !== null) {
    const key = m[1] as string;
    attrs[key] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** XML metnini etiket dizisine çevirir; bildirim/DOCTYPE/yorum/CDATA atlanır. */
function* scanTags(xml: string): Generator<Tag> {
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      return;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      i = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? xml.length : end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      // DOCTYPE; iç alt küme ("[ ... ]") içinde '>' bulunabilir.
      let j = lt + 2;
      let depth = 0;
      while (j < xml.length) {
        const ch = xml[j];
        if (ch === '[') {
          depth += 1;
        } else if (ch === ']') {
          depth -= 1;
        } else if (ch === '>' && depth <= 0) {
          break;
        }
        j += 1;
      }
      i = j + 1;
      continue;
    }

    const gt = xml.indexOf('>', lt + 1);
    if (gt === -1) {
      throw new JacocoParseError('JaCoCo raporu bozuk görünüyor: kapatılmamış etiket.');
    }
    const inner = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (inner.startsWith('/')) {
      yield { name: inner.slice(1).trim().toLowerCase(), attrs: {}, kind: 'close' };
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const source = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(source.trimStart());
    if (!nameMatch) {
      continue;
    }
    yield {
      name: (nameMatch[1] as string).toLowerCase(),
      attrs: parseAttrs(source.slice((nameMatch[1] as string).length)),
      kind: selfClosing ? 'self' : 'open'
    };
  }
}

// ------------------------------------------------------------ imza çözümleyici

/** JVM tip tanımlayıcısını okunur bir tip adına çevirir; tüketilen karakter sayısını da döndürür. */
function readType(desc: string, start: number): { type: string; next: number } {
  let i = start;
  let arraySuffix = '';
  while (desc[i] === '[') {
    arraySuffix += '[]';
    i += 1;
  }
  const ch = desc[i];
  const primitives: Record<string, string> = {
    B: 'byte',
    C: 'char',
    D: 'double',
    F: 'float',
    I: 'int',
    J: 'long',
    S: 'short',
    Z: 'boolean',
    V: 'void'
  };
  if (ch === 'L') {
    const semi = desc.indexOf(';', i);
    const raw = semi === -1 ? desc.slice(i + 1) : desc.slice(i + 1, semi);
    const simple = raw.split('/').pop() ?? raw;
    const inner = simple.split('$').pop() ?? simple;
    return { type: inner + arraySuffix, next: semi === -1 ? desc.length : semi + 1 };
  }
  const primitive = ch === undefined ? undefined : primitives[ch];
  if (primitive) {
    return { type: primitive + arraySuffix, next: i + 1 };
  }
  return { type: '?' + arraySuffix, next: i + 1 };
}

/**
 * `create` + `(Lcom/x/OrderRequest;I)Lcom/x/Order;` -> `create(OrderRequest, int): Order`.
 * İsteme okunur imza koymak, modelin doğru metodu hedeflemesini kolaylaştırır.
 */
export function describeSignature(name: string, desc: string, simpleClassName = ''): string {
  if (name === '<clinit>') {
    return 'static {}';
  }
  const open = desc.indexOf('(');
  const close = desc.indexOf(')');
  const displayName = name === '<init>' ? simpleClassName.split('$').pop() || 'constructor' : name;
  if (open === -1 || close === -1 || close < open) {
    return displayName;
  }
  const params: string[] = [];
  let i = open + 1;
  while (i < close) {
    const { type, next } = readType(desc, i);
    params.push(type);
    if (next <= i) {
      break;
    }
    i = next;
  }
  const returnType = readType(desc, close + 1).type;
  const suffix = name === '<init>' || returnType === 'void' ? '' : `: ${returnType}`;
  return `${displayName}(${params.join(', ')})${suffix}`;
}

// -------------------------------------------------------------------- ayrıştır

function num(value: string | undefined, fallback = 0): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function applyCounter(counters: Counters, attrs: Record<string, string>): void {
  const type = (attrs['type'] ?? '').toUpperCase() as CounterType;
  const counter: Counter = { missed: num(attrs['missed']), covered: num(attrs['covered']) };
  switch (type) {
    case 'INSTRUCTION':
      counters.instruction = counter;
      break;
    case 'BRANCH':
      counters.branch = counter;
      break;
    case 'LINE':
      counters.line = counter;
      break;
    case 'COMPLEXITY':
      counters.complexity = counter;
      break;
    case 'METHOD':
      counters.method = counter;
      break;
    default:
      // CLASS ve bilinmeyen sayaçlar boşluk analizinde kullanılmıyor.
      break;
  }
}

/** JaCoCo XML raporunu tipli modele çevirir. */
export function parseJacocoXml(xml: string): CoverageReport {
  const report: CoverageReport = { name: '', classes: [], sourceFiles: [], totals: emptyCounters() };
  const stack: string[] = [];
  let packagePath = '';
  let currentClass: ClassCoverage | undefined;
  let currentMethod: MethodCoverage | undefined;
  let currentSource: SourceFileCoverage | undefined;
  let sawReport = false;

  const openTag = (tag: Tag): void => {
    switch (tag.name) {
      case 'report':
        sawReport = true;
        report.name = tag.attrs['name'] ?? '';
        break;
      case 'package':
        packagePath = (tag.attrs['name'] ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        break;
      case 'class': {
        const internalName = (tag.attrs['name'] ?? '').replace(/\\/g, '/');
        const simpleName = internalName.split('/').pop() ?? internalName;
        const topLevel = simpleName.split('$')[0] ?? simpleName;
        currentClass = {
          internalName,
          qualifiedName: internalName.replace(/\//g, '.'),
          simpleName,
          packageName: packagePath.replace(/\//g, '.'),
          packagePath,
          sourceFileName: tag.attrs['sourcefilename'] ?? `${topLevel}.java`,
          methods: [],
          counters: emptyCounters()
        };
        report.classes.push(currentClass);
        break;
      }
      case 'method': {
        if (!currentClass) {
          break;
        }
        const name = tag.attrs['name'] ?? '';
        const desc = tag.attrs['desc'] ?? '';
        const lineAttr = tag.attrs['line'];
        currentMethod = {
          name,
          desc,
          signature: describeSignature(name, desc, currentClass.simpleName),
          ...(lineAttr !== undefined ? { line: num(lineAttr) } : {}),
          counters: emptyCounters(),
          executed: false
        };
        currentClass.methods.push(currentMethod);
        break;
      }
      case 'sourcefile': {
        const name = tag.attrs['name'] ?? '';
        currentSource = {
          packageName: packagePath.replace(/\//g, '.'),
          packagePath,
          name,
          relativePath: packagePath ? `${packagePath}/${name}` : name,
          lines: [],
          uncoveredLines: [],
          partiallyCoveredLines: [],
          counters: emptyCounters()
        };
        report.sourceFiles.push(currentSource);
        break;
      }
      case 'line': {
        if (!currentSource) {
          break;
        }
        const line: LineCoverage = {
          nr: num(tag.attrs['nr']),
          missedInstructions: num(tag.attrs['mi']),
          coveredInstructions: num(tag.attrs['ci']),
          missedBranches: num(tag.attrs['mb']),
          coveredBranches: num(tag.attrs['cb'])
        };
        currentSource.lines.push(line);
        if (line.coveredInstructions === 0 && line.missedInstructions > 0) {
          currentSource.uncoveredLines.push(line.nr);
        } else if (line.coveredInstructions > 0 && (line.missedInstructions > 0 || line.missedBranches > 0)) {
          currentSource.partiallyCoveredLines.push(line.nr);
        }
        break;
      }
      case 'counter': {
        const parent = stack[stack.length - 1];
        if (parent === 'method' && currentMethod) {
          applyCounter(currentMethod.counters, tag.attrs);
        } else if (parent === 'class' && currentClass) {
          applyCounter(currentClass.counters, tag.attrs);
        } else if (parent === 'sourcefile' && currentSource) {
          applyCounter(currentSource.counters, tag.attrs);
        } else if (parent === 'report') {
          applyCounter(report.totals, tag.attrs);
        }
        break;
      }
      default:
        break;
    }
  };

  const closeTag = (name: string): void => {
    switch (name) {
      case 'method':
        if (currentMethod) {
          currentMethod.executed = currentMethod.counters.method.covered > 0;
        }
        currentMethod = undefined;
        break;
      case 'class':
        currentClass = undefined;
        break;
      case 'sourcefile':
        currentSource = undefined;
        break;
      case 'package':
        packagePath = '';
        break;
      default:
        break;
    }
  };

  for (const tag of scanTags(xml)) {
    if (tag.kind === 'close') {
      closeTag(tag.name);
      if (stack[stack.length - 1] === tag.name) {
        stack.pop();
      }
      continue;
    }
    openTag(tag);
    if (tag.kind === 'self') {
      closeTag(tag.name);
    } else {
      stack.push(tag.name);
    }
  }

  if (!sawReport) {
    throw new JacocoParseError(
      'Dosya bir JaCoCo raporu gibi görünmüyor (<report> düğümü bulunamadı). ' +
        'Kural setindeki coverage.reportPath değerini kontrol edin.'
    );
  }
  return report;
}

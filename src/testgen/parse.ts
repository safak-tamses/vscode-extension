import { normalizePath } from '../coverage/glob';
import { testClassName } from './prompt';

export interface ParsedTest {
  /** Doğrulanmış, workspace'e göreli test dosyası yolu. */
  filePath: string;
  /** Dosyanın tam içeriği. */
  content: string;
  rationale: string;
}

export class TestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestParseError';
  }
}

export interface TestParseOptions {
  /** Kural setine göre beklenen test yolu. */
  expectedPath: string;
  /** Modül dahil test kökü, ör. `modules/order/src/test/java`. Yol bunun altında olmalıdır. */
  testRoot: string;
  /** Beklenen paket, ör. `com.kurum.order`; varsayılan paket için boş. */
  expectedPackage: string;
}

const FILE_MARKER = /^[ \t>*-]*(?:DOSYA|FILE)\s*:\s*([^\s`"']+)/im;
const RATIONALE_MARKER = /(?:GEREK[ÇC]E|RATIONALE)\s*:\s*([\s\S]*)/i;
const FENCE = /```[ \t]*([a-zA-Z0-9+#-]*)[ \t]*\r?\n([\s\S]*?)```/g;

interface Block {
  lang: string;
  code: string;
  end: number;
}

function fencedBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(raw)) !== null) {
    blocks.push({
      lang: (match[1] ?? '').toLowerCase(),
      code: (match[2] ?? '').replace(/\s+$/, ''),
      end: match.index + match[0].length
    });
  }
  return blocks;
}

/**
 * Model yanıtından test dosyasını çıkarır ve GÜVENLİK doğrulaması yapar.
 *
 * Yol her zaman `testRoot` altında kalmak zorundadır: mutlak yollar, `..` ile üst dizine
 * çıkışlar ve test kökü dışındaki hedefler reddedilir. Böylece bir istem enjeksiyonu
 * workspace'in başka bir yerine dosya yazdıramaz.
 */
export function parseTestResponse(raw: string, opts: TestParseOptions): ParsedTest {
  const blocks = fencedBlocks(raw);
  if (blocks.length === 0) {
    throw new TestParseError(
      'Model bir kod bloğu döndürmedi (``` ... ```). Yanıt beklenen biçimde değil; tekrar deneyin.'
    );
  }

  const declaredPath = FILE_MARKER.exec(raw)?.[1];
  const filePath = resolvePath(declaredPath, opts);
  const requiredClass = testClassName(filePath);

  const block =
    blocks.find((b) => new RegExp(`\\b(?:class|record|interface|enum)\\s+${escapeRe(requiredClass)}\\b`).test(b.code)) ??
    blocks.find((b) => b.lang === 'java') ??
    (blocks[0] as Block);

  const content = block.code.trim();
  if (content === '') {
    throw new TestParseError('Model boş bir kod bloğu döndürdü.');
  }
  if (!new RegExp(`\\b(?:class|record|interface|enum)\\s+${escapeRe(requiredClass)}\\b`).test(content)) {
    throw new TestParseError(
      `Üretilen dosyada beklenen tip bildirimi bulunamadı: "${requiredClass}". ` +
        `Java'da dosya adı ile üst düzey tip adı aynı olmalıdır (${filePath}).`
    );
  }
  assertPackage(content, opts.expectedPackage, filePath);

  return { filePath, content: content + '\n', rationale: extractRationale(raw, block.end) };
}

function resolvePath(declared: string | undefined, opts: TestParseOptions): string {
  const testRoot = normalizePath(opts.testRoot).replace(/\/+$/, '');
  const expected = normalizePath(opts.expectedPath);
  if (declared === undefined) {
    return expected;
  }

  const raw = declared.trim().replace(/^[`"']|[`"']$/g, '');
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
    throw new TestParseError(`Güvenlik: mutlak dosya yolu kabul edilmiyor ("${raw}").`);
  }
  const candidate = normalizePath(raw);
  if (candidate.split('/').includes('..')) {
    throw new TestParseError(`Güvenlik: üst dizine çıkan yol kabul edilmiyor ("${raw}").`);
  }
  if (!candidate.toLowerCase().endsWith('.java')) {
    throw new TestParseError(`Test dosyası ".java" ile bitmeli ("${raw}").`);
  }
  if (testRoot !== '' && candidate !== expected && !candidate.startsWith(testRoot + '/')) {
    throw new TestParseError(
      `Güvenlik: test dosyası yalnızca "${testRoot}" altına yazılabilir; model "${candidate}" verdi.`
    );
  }
  return candidate;
}

function assertPackage(content: string, expectedPackage: string, filePath: string): void {
  const declared = /^[ \t]*package\s+([A-Za-z_$][\w$.]*)\s*;/m.exec(content)?.[1];
  if (expectedPackage === '') {
    if (declared) {
      throw new TestParseError(
        `Üretilen dosya "${declared}" paketini bildiriyor ama ${filePath} varsayılan pakette olmalı.`
      );
    }
    return;
  }
  if (!declared) {
    throw new TestParseError(`Üretilen dosyada paket bildirimi yok; "package ${expectedPackage};" olmalı.`);
  }
  if (declared !== expectedPackage) {
    throw new TestParseError(
      `Paket uyuşmuyor: dosya "${declared}" bildiriyor, beklenen "${expectedPackage}" (${filePath}).`
    );
  }
}

function extractRationale(raw: string, blockEnd: number): string {
  const after = raw.slice(blockEnd);
  const marked = RATIONALE_MARKER.exec(after) ?? RATIONALE_MARKER.exec(raw);
  if (marked?.[1]) {
    return marked[1].trim();
  }
  const trailing = after.trim();
  return trailing || 'Model gerekçe belirtmedi.';
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

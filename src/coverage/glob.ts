/**
 * Bağımlılıksız, küçük glob eşleştirici. Kural setlerindeki `include`/`exclude` ve
 * JaCoCo rapor yolu desenleri için kullanılır.
 *
 * Desteklenen sözdizimi (yollar `/` ile ayrılır):
 * - `**` : sıfır veya daha fazla dizin seviyesi   (`a/** /b` -> `a/b`, `a/x/y/b`)
 * - `*`  : bir segment içinde herhangi bir dizi   (`*.java`)
 * - `?`  : bir segment içinde tek karakter
 * Diğer tüm karakterler birebir eşleşir.
 */

const REGEXP_SPECIALS = /[.+^${}()|[\]\\]/g;

function escapeLiteral(ch: string): string {
  return ch.replace(REGEXP_SPECIALS, '\\$&');
}

/** Yolları karşılaştırılabilir biçime getirir: ters bölü -> bölü, baştaki `./` ve `/` atılır. */
export function normalizePath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

/** Glob desenini eşdeğer bir RegExp'e çevirir (baştan sona bağlı). */
export function globToRegExp(glob: string): RegExp {
  const pattern = normalizePath(glob);
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === '*') {
      const isDouble = pattern[i + 1] === '*';
      if (isDouble) {
        const atSegmentStart = i === 0 || pattern[i - 1] === '/';
        if (atSegmentStart && pattern[i + 2] === '/') {
          // "**/" -> sıfır veya daha fazla tam segment
          out += '(?:[^/]*/)*';
          i += 3;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += escapeLiteral(ch);
    i += 1;
  }
  return new RegExp('^' + out + '$');
}

const cache = new Map<string, RegExp>();

function compiled(glob: string): RegExp {
  let re = cache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    cache.set(glob, re);
  }
  return re;
}

/** Tek bir desenin yola uyup uymadığını söyler. */
export function matchGlob(glob: string, filePath: string): boolean {
  return compiled(glob).test(normalizePath(filePath));
}

/** Desenlerden herhangi biri uyuyor mu? (boş liste -> false) */
export function matchAny(globs: readonly string[], filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return globs.some((g) => compiled(g).test(normalized));
}

/**
 * Kural setinin kapsam kararı: `include` desenlerinden en az biri uymalı ve
 * `exclude` desenlerinden hiçbiri uymamalı.
 */
export function isIncluded(
  filePath: string,
  include: readonly string[],
  exclude: readonly string[]
): boolean {
  return matchAny(include, filePath) && !matchAny(exclude, filePath);
}

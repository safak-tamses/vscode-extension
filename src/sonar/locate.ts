/**
 * Dosya konumu çözümlemesinin saf (vscode'suz) mantığı.
 *
 * Sonar bulgusundaki yol, SonarQube proje kökünedir; bu kök VS Code'da açık klasörle aynı
 * olmak zorunda değildir (monorepo alt klasörü ya da tamamen dışarıdaki bir dizin olabilir).
 * Burada yalnızca yol hesabı yapılır; dosya sistemine erişim çağıran katmana aittir.
 */

/** Yolu mutlak mı? POSIX (`/…`), Windows sürücü (`C:\…`) ve UNC (`\\sunucu\pay`) biçimleri. */
export function isAbsolutePath(p: string): boolean {
  const value = p.trim();
  if (value === '') {
    return false;
  }
  return value.startsWith('/') || value.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * Göreli yolu segmentlere ayırır: `\` ayracını `/` yapar, boş ve `.` segmentlerini atar.
 * `..` segmenti korunur — çağıran katman gerekiyorsa reddeder.
 */
export function normalizeRelPath(p: string): string[] {
  return p
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

/** Yolun son segmenti (dosya adı); yol boşsa boş dize. */
export function baseName(p: string): string {
  const segments = normalizeRelPath(p);
  return segments[segments.length - 1] ?? '';
}

/**
 * Aday mutlak yollar arasından, aranan yolla sondan en çok segment paylaşanı seçer.
 * `src/main/java/com/Foo.java` için `/w/backend/src/main/java/com/Foo.java` adayı
 * `/w/other/com/Foo.java` adayını yener (4 segment vs 2).
 *
 * En iyi skoru birden fazla aday paylaşıyorsa seçim belirsizdir ve `undefined` döner —
 * yanlış dosyayı açmaktansa kullanıcıya proje kökünü sormak yeğdir.
 */
export function pickBestSuffixMatch(relPath: string, candidates: string[]): string | undefined {
  const wanted = normalizeRelPath(relPath);
  if (wanted.length === 0) {
    return undefined;
  }
  let best: string | undefined;
  let bestScore = 0;
  let tied = false;
  for (const candidate of candidates) {
    const score = commonSuffixLength(wanted, normalizeRelPath(candidate));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return bestScore > 0 && !tied ? best : undefined;
}

/**
 * Kullanıcının seçtiği klasörü ayara yazılacak biçime indirger: workspace kökünün altındaysa
 * göreli yol, değilse mutlak yol. Kökün kendisi seçilirse boş dize (= varsayılan davranış).
 */
export function relativeToRoot(rootFsPath: string, chosenFsPath: string): string {
  const root = normalizeRelPath(rootFsPath);
  const chosen = normalizeRelPath(chosenFsPath);
  if (!isAbsolutePath(rootFsPath) || !isAbsolutePath(chosenFsPath) || chosen.length < root.length) {
    return chosenFsPath;
  }
  for (let i = 0; i < root.length; i += 1) {
    if (root[i]?.toLowerCase() !== chosen[i]?.toLowerCase()) {
      return chosenFsPath;
    }
  }
  return chosen.slice(root.length).join('/');
}

/** İki segment dizisinin sondan kaç segmenti (büyük/küçük harf duyarsız) ortak? */
function commonSuffixLength(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length) {
    const left = a[a.length - 1 - n]?.toLowerCase();
    const right = b[b.length - 1 - n]?.toLowerCase();
    if (left !== right) {
      break;
    }
    n += 1;
  }
  return n;
}

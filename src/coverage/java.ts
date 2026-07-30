/**
 * JDK konumu çözümlemesinin saf (vscode'suz) mantığı.
 *
 * Maven'in `clean install` adımı derleme yapar; JDK bulunamazsa ya da yanlış sürüm
 * kullanılırsa derleme başarısız olur. Varsayılan davranış ortamın JAVA_HOME/PATH
 * değerlerini olduğu gibi kullanmaktır. `codeHealth.javaHome` ayarı verildiğinde derleme
 * süreci JAVA_HOME bu yola ayarlanmış ve `<home>/bin` PATH'in başına eklenmiş olarak başlatılır.
 */

import type { Platform } from './maven';

/** JDK kökü altında aranacak çalıştırılabilir dosyanın göreli yolu. */
export function javaExecutableRelPath(platform: Platform): string {
  return platform === 'win32' ? 'bin\\java.exe' : 'bin/java';
}

function separator(platform: Platform): string {
  return platform === 'win32' ? '\\' : '/';
}

function trimTrailingSeparators(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '');
  return trimmed === '' ? value : trimmed;
}

function splitSegments(value: string): string[] {
  return trimTrailingSeparators(value).split(/[\\/]/);
}

function parentOf(value: string, platform: Platform): string {
  const segments = splitSegments(value);
  segments.pop();
  const parent = segments.join(separator(platform));
  return parent === '' ? trimTrailingSeparators(value) : parent;
}

/**
 * Ayardaki yol için denenecek JDK kökü adayları, öncelik sırasıyla.
 * Kullanıcı JDK kökünü, `bin` dizinini, `java` dosyasını ya da macOS'ta `.jdk` paketini
 * vermiş olabilir. Çağıran katman `<aday>/bin/java` var olan ilk adayı seçer.
 */
export function javaHomeCandidates(configured: string, platform: Platform): string[] {
  const base = trimTrailingSeparators(configured.trim());
  if (base === '') {
    return [];
  }
  const sep = separator(platform);
  const candidates: string[] = [];
  const add = (value: string): void => {
    if (value !== '' && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  const name = (splitSegments(base).pop() ?? '').toLowerCase();
  if (name === 'java' || name === 'java.exe') {
    // `<home>/bin/java` verildiyse iki üst dizin JDK köküdür.
    add(parentOf(parentOf(base, platform), platform));
  }
  if (name === 'bin') {
    add(parentOf(base, platform));
  }
  add(base);
  // macOS'ta kullanıcı çoğunlukla `.jdk` paketini seçer; gerçek kök Contents/Home altındadır.
  if (platform === 'posix') {
    add(`${base}${sep}Contents${sep}Home`);
  }
  return candidates;
}

/**
 * Derleme süreci için ortam değişkenlerini hazırlar: JAVA_HOME ayarlanır ve `<home>/bin`
 * PATH'in BAŞINA eklenir (sistemdeki başka bir java sürümünün önüne geçmesi için).
 * Girdi nesnesi değiştirilmez.
 */
export function withJavaHome(
  env: Record<string, string | undefined>,
  javaHome: string,
  platform: Platform
): Record<string, string | undefined> {
  const sep = separator(platform);
  const listSep = platform === 'win32' ? ';' : ':';
  const binDir = `${trimTrailingSeparators(javaHome)}${sep}bin`;
  const next: Record<string, string | undefined> = { ...env, JAVA_HOME: javaHome };
  const pathKey = pathVariableName(env, platform);
  const current = env[pathKey];
  next[pathKey] = current ? `${binDir}${listSep}${current}` : binDir;
  return next;
}

/**
 * PATH değişkeninin adı. Windows'ta büyük/küçük harf duyarsızdır ve `Path` biçiminde
 * gelebilir; var olan anahtarı bulup onu kullanmak ikinci bir PATH girdisi oluşmasını önler.
 */
function pathVariableName(env: Record<string, string | undefined>, platform: Platform): string {
  if (platform !== 'win32') {
    return 'PATH';
  }
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
}

/**
 * Maven konumu çözümlemesinin saf (vscode'suz) mantığı.
 *
 * Varsayılan davranış: derleme komutu kural dosyasındaki haliyle (`mvn clean install`) kabuğa
 * verilir ve `mvn` PATH üzerinden bulunur. Bazı kurumsal makinelerde Maven PATH'te olmadığı
 * için `codeHealth.mavenPath` ayarıyla dizin ya da doğrudan çalıştırılabilir dosya verilebilir;
 * bu durumda komutun başındaki `mvn` belirteci tam yolla değiştirilir.
 */

export type Platform = 'win32' | 'posix';

/** Komutun başındaki Maven belirteci: `mvn`, `mvn.cmd`, `mvn.bat`, `mvn.exe`. */
const MVN_TOKEN = /^(\s*)(mvn(?:\.cmd|\.bat|\.exe)?)(?=\s|$)/i;

/** Aranacak çalıştırılabilir dosya adları (Windows'ta kabuk sarmalayıcıları önce gelir). */
function executableNames(platform: Platform): string[] {
  return platform === 'win32' ? ['mvn.cmd', 'mvn.bat', 'mvn.exe', 'mvn'] : ['mvn'];
}

function separator(platform: Platform): string {
  return platform === 'win32' ? '\\' : '/';
}

/** Sondaki ayraçları atar; `C:\maven\` -> `C:\maven`. Kök yol (`/`) korunur. */
function trimTrailingSeparators(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '');
  return trimmed === '' ? value : trimmed;
}

function lastSegment(value: string): string {
  const segments = trimTrailingSeparators(value).split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}

/** Verilen yolun kendisi bir Maven çalıştırılabiliri gibi mi görünüyor? */
function looksLikeExecutable(value: string, platform: Platform): boolean {
  const name = lastSegment(value).toLowerCase();
  return executableNames(platform).includes(name) || name === 'mvn';
}

/**
 * Ayardaki yol için denenecek çalıştırılabilir dosya adayları, öncelik sırasıyla.
 * Kullanıcı Maven kökünü (`C:\apache-maven-3.9.6`), `bin` dizinini ya da doğrudan dosyayı
 * vermiş olabilir; üçü de desteklenir. Çağıran katman ilk VAR OLAN adayı seçer.
 */
export function mavenExecutableCandidates(configured: string, platform: Platform): string[] {
  const base = trimTrailingSeparators(configured.trim());
  if (base === '') {
    return [];
  }
  const sep = separator(platform);
  const names = executableNames(platform);
  const candidates: string[] = [];
  const add = (value: string): void => {
    if (!candidates.includes(value)) {
      candidates.push(value);
    }
  };

  if (looksLikeExecutable(base, platform)) {
    add(base);
  }
  for (const name of names) {
    add(`${base}${sep}bin${sep}${name}`);
  }
  for (const name of names) {
    add(`${base}${sep}${name}`);
  }
  // Kullanıcı kendi adlandırdığı bir sarmalayıcı dosya vermiş olabilir.
  add(base);
  return candidates;
}

/** Boşluk içerebilen yolu kabuk için tırnaklar. */
export function quoteForShell(value: string, platform: Platform): string {
  if (platform === 'win32') {
    // cmd.exe tırnak içinde kaçış tanımaz; çift tırnak zaten yolda geçerli bir karakter değildir.
    return `"${value.replace(/"/g, '')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Komutun başındaki `mvn` belirtecini tam yolla değiştirir. Komut `mvn` ile başlamıyorsa
 * (ör. `./mvnw clean install` ya da Gradle) olduğu gibi bırakılır — ayar Maven'e özgüdür.
 */
export function applyMavenPath(command: string, executable: string, platform: Platform): string {
  if (executable.trim() === '') {
    return command;
  }
  return command.replace(MVN_TOKEN, (_match, lead: string) => lead + quoteForShell(executable, platform));
}

/** Komut, Maven yolu ayarından etkilenir mi? (kullanıcıya bilgi vermek için) */
export function usesMaven(command: string): boolean {
  return MVN_TOKEN.test(command);
}

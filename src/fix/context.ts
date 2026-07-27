import { componentToPath } from '../sonar/types';
import type { SonarIssue } from '../sonar/types';

export interface FixContext {
  /** Bağlam olarak verilen kod parçası. */
  snippet: string;
  /** snippet'in dosyadaki ilk satırı (1-tabanlı). */
  startLine: number;
  /** snippet'in dosyadaki son satırı (1-tabanlı). */
  endLine: number;
  /** Modelin rolünü ve çıktı biçimini sabitleyen sistem mesajı. */
  system: string;
  /** LLM'e gönderilecek tam istem. */
  prompt: string;
}

/**
 * Sistem mesajı: küçük local modellerin çıktı sözleşmesinden sapmasını engeller.
 */
export const FIX_SYSTEM_PROMPT = [
  'Sen kıdemli bir yazılım geliştiricisisin ve statik analiz bulgularını düzeltiyorsun.',
  'Yanıtın SADECE şu iki parçadan oluşur: (1) tek bir kod bloğu, (2) ardından "GEREKÇE:" satırı.',
  'Giriş cümlesi, selamlama, madde listesi veya ek açıklama yazma.'
].join(' ');

/**
 * Bulgu çevresinde `padding` satır içeren bir snippet ve LLM istemi üretir (saf fonksiyon).
 * Model, snippet satır aralığının düzeltilmiş tam halini tek bir kod bloğu olarak döndürmeli.
 */
export function buildFixContext(
  issue: SonarIssue,
  ruleDescription: string,
  fileText: string,
  padding: number
): FixContext {
  const lines = fileText.split('\n');
  const issueStart = issue.textRange?.startLine ?? issue.line ?? 1;
  const issueEnd = issue.textRange?.endLine ?? issueStart;
  const startLine = Math.max(1, issueStart - padding);
  const endLine = Math.min(lines.length, issueEnd + padding);
  const snippet = lines.slice(startLine - 1, endLine).join('\n');
  const filePath = componentToPath(issue.component);

  const prompt = [
    'Sen kıdemli bir geliştiricisin. Aşağıdaki SonarQube bulgusunu düzelt.',
    '',
    `Dosya: ${filePath}`,
    `Kural: ${issue.rule}`,
    `Önem: ${issue.severity}`,
    `Mesaj: ${issue.message}`,
    '',
    'Kural açıklaması:',
    ruleDescription,
    '',
    `Aşağıda dosyanın ${startLine}-${endLine} satırları yer alıyor (sorun ${issueStart}. satırda):`,
    '```',
    snippet,
    '```',
    '',
    'KURALLAR:',
    `- Yalnızca ${startLine}-${endLine} satır aralığının DÜZELTİLMİŞ tam halini ver.`,
    '- İlgisiz satırları AYNEN koru; davranışı değiştirme.',
    '- Girintiyi ve dosyanın kod stilini koru.',
    '- Çıktıyı tek bir kod bloğu (``` ... ```) içinde döndür.',
    '- Kod bloğundan sonra "GEREKÇE:" ile ne değiştiğini, neden ve hangi kuralı kapattığını 1-3 cümlede açıkla.'
  ].join('\n');

  return { snippet, startLine, endLine, system: FIX_SYSTEM_PROMPT, prompt };
}

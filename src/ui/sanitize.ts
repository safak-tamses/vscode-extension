/**
 * Hafif, bağımlılıksız HTML sanitizasyonu. SonarQube rules/show çıktısını webview'a
 * göndermeden önce tehlikeli içeriği temizler. Webview tarafındaki sıkı CSP ile birlikte
 * (script-src yalnızca nonce) ikinci savunma katmanı oluşturur.
 */
export function sanitizeHtml(html: string): string {
  let out = html;
  // İçerikli tehlikeli bloklar (script/style/iframe/object/embed)
  out = out.replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '');
  // Tek başına / kapanışsız tehlikeli etiketler
  out = out.replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '');
  // Satır içi olay işleyicileri (onclick, onerror, ...)
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // javascript: şemalı href/src
  out = out.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
  return out;
}

/** HTML'i düz metne çevirir (LLM istemi için). Etiketleri ve script içeriğini kaldırır. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

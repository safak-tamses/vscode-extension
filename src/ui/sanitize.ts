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

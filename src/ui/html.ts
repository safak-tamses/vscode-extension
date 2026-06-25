const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Webview script'leri için tek kullanımlık nonce üretir. */
export function getNonce(): string {
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return text;
}

/** HTML enjeksiyonunu önlemek için anlamlı karakterleri kaçışlar. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface WebviewHtmlOptions {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  title: string;
  /** İçeriksiz başlatılırsa boş bir #root verilir; geri kalanı script doldurur. */
  bodyHtml?: string;
}

/**
 * Sıkı CSP'li webview HTML iskeleti. Yalnızca nonce'lu script ve cspSource'tan stil
 * çalışabilir; uzak script/inline script yasak.
 */
export function getWebviewHtml(opts: WebviewHtmlOptions): string {
  const { nonce, cspSource, scriptUri, styleUri, title, bodyHtml = '<div id="root"></div>' } = opts;
  const csp =
    `default-src 'none'; ` +
    `img-src ${cspSource} https: data:; ` +
    `style-src ${cspSource}; ` +
    `font-src ${cspSource}; ` +
    `script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  ${bodyHtml}
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Satır içi SVG ikon seti. Dış font/CDN yok: webview'ın sıkı CSP'siyle uyumlu ve
 * eklentiye runtime bağımlılığı eklemez. Yollar VS Code codicon dilinden esinlenir
 * ama bu dosyada elle çizilmiştir.
 */
export type IconName =
  | 'health'
  | 'plug'
  | 'sparkle'
  | 'beaker'
  | 'rules'
  | 'check'
  | 'warning'
  | 'error'
  | 'info'
  | 'copilot'
  | 'server'
  | 'file'
  | 'newFile'
  | 'refresh'
  | 'play'
  | 'target'
  | 'shield'
  | 'arrowRight'
  | 'link';

const PATHS: Record<IconName, string> = {
  health:
    'M8 14.5s-5.5-3.3-5.5-7A3.2 3.2 0 0 1 8 5.2a3.2 3.2 0 0 1 5.5 2.3c0 3.7-5.5 7-5.5 7Z M1.5 8.6h3l1.2-2 1.6 3.4L9 8.6h5.5',
  plug: 'M6 1.5v4 M10 1.5v4 M4 5.5h8v2a4 4 0 0 1-4 4 4 4 0 0 1-4-4v-2Z M8 11.5v3',
  sparkle: 'M8 1.5 9.5 6 14 7.5 9.5 9 8 13.5 6.5 9 2 7.5 6.5 6 8 1.5Z M12.5 11.5l.7 1.8 1.8.7-1.8.7-.7 1.8',
  beaker: 'M5.5 1.5h5 M6.5 1.5v4L3.2 12.2A1.6 1.6 0 0 0 4.6 14.5h6.8a1.6 1.6 0 0 0 1.4-2.3L9.5 5.5v-4 M4.4 10h7.2',
  rules: 'M3.5 1.5h9v13h-9z M5.5 4.5h5 M5.5 7.5h5 M5.5 10.5h3',
  check: 'M2.5 8.5 6 12l7.5-8',
  warning: 'M8 2 15 14H1L8 2Z M8 6.5v3.2 M8 11.8v.7',
  error: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Z M5.6 5.6l4.8 4.8 M10.4 5.6l-4.8 4.8',
  info: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Z M8 7.2v4 M8 4.8v.6',
  copilot:
    'M2 9.2c0-2.4 2.7-4.2 6-4.2s6 1.8 6 4.2c0 2-1.5 3.3-3 3.8-1 .3-2 .5-3 .5s-2-.2-3-.5c-1.5-.5-3-1.8-3-3.8Z M5.2 2.4c.8-.7 2-.9 2.8.4 .8-1.3 2-1.1 2.8-.4 M6 9v1.4 M10 9v1.4',
  server:
    'M2.5 2.5h11v4h-11z M2.5 9.5h11v4h-11z M4.6 4.5h.1 M4.6 11.5h.1 M7 4.5h4 M7 11.5h4',
  file: 'M4 1.5h5l3 3v11H4z M9 1.5v3h3',
  newFile: 'M3.5 1.5h5l3 3v5 M8.5 1.5v3h3 M3.5 1.5v13h4 M11.5 11v4 M9.5 13h4',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.9-4.2 M13.5 2v3.5H10',
  play: 'M4.5 2.5 13 8l-8.5 5.5z',
  target:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Z M8 4.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z M8 7.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z',
  shield: 'M8 1.5 13.5 3.5v4.2c0 3.4-2.4 5.8-5.5 6.8-3.1-1-5.5-3.4-5.5-6.8V3.5L8 1.5Z M5.8 8l1.7 1.7 3-3.2',
  arrowRight: 'M3 8h9.5 M9 4.5 12.5 8 9 11.5',
  link: 'M6.5 9.5 9.5 6.5 M6.8 4.6 8.4 3a3 3 0 0 1 4.2 4.2l-1.6 1.6 M9.2 11.4 7.6 13a3 3 0 0 1-4.2-4.2l1.6-1.6'
};

/** İkonu SVG düğümü olarak üretir (innerHTML kullanılmaz). */
export function icon(name: IconName, size: 'sm' | 'lg' | 'xl' = 'sm'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', size === 'sm' ? 'icon' : `icon ${size}`);
  for (const d of PATHS[name].split(' M').map((part, i) => (i === 0 ? part : 'M' + part))) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d.trim());
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

import { icon } from './icons';
import type { IconName } from './icons';

/** Etiket + öznitelik + çocuklarla düğüm üretir. textContent kullanılır; innerHTML asla. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

/** Sınıf + metin ile hızlı bir kutu. */
export function box(className: string, ...children: Array<Node | string>): HTMLDivElement {
  return el('div', { class: className }, children);
}

/** Sınıf + metin ile hızlı bir satır içi öğe. */
export function text(className: string, content: string): HTMLSpanElement {
  const node = el('span', { class: className });
  node.textContent = content;
  return node;
}

export function button(
  variant: 'primary' | 'secondary' | 'ghost' | 'link',
  label: string,
  onClick: () => void,
  options: { icon?: IconName; tiny?: boolean; title?: string } = {}
): HTMLButtonElement {
  const classes = [variant, ...(options.tiny ? ['tiny'] : [])].join(' ');
  const node = el('button', { class: classes, type: 'button' });
  if (options.title) {
    node.setAttribute('title', options.title);
  }
  if (options.icon) {
    node.append(icon(options.icon));
  }
  node.append(document.createTextNode(label));
  node.addEventListener('click', onClick);
  return node;
}

export interface FieldOptions {
  hint?: string;
  id?: string;
}

/** Etiket + kontrol + ipucu üçlüsü. */
export function field(labelText: string, control: HTMLElement, options: FieldOptions = {}): HTMLDivElement {
  const wrap = box('field');
  const label = el('label');
  label.textContent = labelText;
  if (options.id) {
    control.id = options.id;
    label.setAttribute('for', options.id);
  }
  wrap.append(label, control);
  if (options.hint) {
    const hint = el('span', { class: 'hint' });
    hint.textContent = options.hint;
    wrap.append(hint);
  }
  return wrap;
}

/** Sayfa başlığı: ikon + başlık + alt başlık + sağdaki ek içerik. */
export function pageHeader(
  glyph: IconName,
  title: string,
  subtitle: string,
  aside: Node[] = []
): HTMLElement {
  const header = box('page-header');
  header.append(box('glyph', icon(glyph, 'lg')));
  const grow = box('grow');
  const h1 = el('h1');
  h1.textContent = title;
  grow.append(h1, text('subtitle', subtitle));
  header.append(grow);
  if (aside.length > 0) {
    header.append(box('aside', ...aside));
  }
  return header;
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export function badge(tone: Tone, label: string, glyph?: IconName): HTMLSpanElement {
  const node = el('span', { class: `badge ${tone}` });
  if (glyph) {
    node.append(icon(glyph));
  }
  node.append(document.createTextNode(label));
  return node;
}

/** Yüzdeye göre renklenen ince kapsam çubuğu. */
export function meter(percent: number, threshold: number, label?: string): HTMLElement {
  const value = Math.max(0, Math.min(100, percent));
  const tone = value >= threshold ? '' : value >= threshold * 0.6 ? ' warn' : ' danger';
  const row = box('meter-row');
  const bar = box('meter' + tone);
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-valuenow', String(Math.round(value)));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-label', label ?? `kapsam %${Math.round(value)}`);
  bar.style.setProperty('--value', String(value));
  bar.append(el('span'));
  row.append(bar, text('value', `%${Math.round(value)}`));
  return row;
}

/** Yüzdelik halka göstergesi (SVG). */
export function ring(percent: number, threshold: number, label: string, size = 62): HTMLElement {
  const value = Math.max(0, Math.min(100, percent));
  const tone = value >= threshold ? '' : value >= threshold * 0.6 ? ' warn' : ' danger';
  const wrap = box('ring' + tone);
  const radius = size / 2 - 5;
  const circumference = 2 * Math.PI * radius;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');

  for (const cls of ['track', 'value']) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', String(size / 2));
    circle.setAttribute('cy', String(size / 2));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke-width', '6');
    if (cls === 'value') {
      circle.setAttribute('stroke-dasharray', String(circumference));
      circle.setAttribute('stroke-dashoffset', String(circumference * (1 - value / 100)));
    }
    svg.append(circle);
  }

  const info = box('ring-text');
  info.append(text('ring-pct', `%${Math.round(value)}`), text('ring-label', label));
  wrap.append(svg, info);
  return wrap;
}

export function stat(value: string, label: string): HTMLElement {
  const wrap = box('stat');
  wrap.append(text('stat-value', value), text('stat-label', label));
  return wrap;
}

const TONE_ICON: Record<Tone, IconName> = {
  ok: 'check',
  warn: 'warning',
  danger: 'error',
  info: 'info',
  neutral: 'info'
};

/** Gizli/gösterilir durum şeridi. */
export function statusBar(): {
  node: HTMLElement;
  set(tone: Tone, message: string): void;
  clear(): void;
} {
  const node = box('status');
  node.setAttribute('role', 'status');
  return {
    node,
    set(tone, message) {
      node.replaceChildren(icon(TONE_ICON[tone]), text('', message));
      node.className = `status show ${tone}`;
    },
    clear() {
      node.replaceChildren();
      node.className = 'status';
    }
  };
}

/** Üç noktalı çalışma göstergesi. */
export function spinner(label: string): { node: HTMLElement; set(busy: boolean, label?: string): void } {
  const node = box('spinner');
  const dots = box('', el('span', { class: 'dot' }), el('span', { class: 'dot' }), el('span', { class: 'dot' }));
  dots.style.display = 'flex';
  dots.style.gap = '4px';
  const caption = text('', label);
  node.append(dots, caption);
  return {
    node,
    set(busy, newLabel) {
      if (newLabel !== undefined) {
        caption.textContent = newLabel;
      }
      node.classList.toggle('show', busy);
    }
  };
}

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
}

export function emptyState(
  glyph: IconName,
  title: string,
  description: string,
  actions: EmptyStateAction[] = []
): HTMLElement {
  const wrap = box('empty');
  wrap.append(box('glyph', icon(glyph, 'xl')));
  const h2 = el('h2');
  h2.textContent = title;
  const p = el('p');
  p.textContent = description;
  wrap.append(h2, p);
  if (actions.length > 0) {
    const row = box('actions');
    for (const action of actions) {
      row.append(
        button(action.variant ?? 'primary', action.label, action.onClick, action.icon ? { icon: action.icon } : {})
      );
    }
    wrap.append(row);
  }
  return wrap;
}

export interface TabSpec {
  id: string;
  label: string;
  icon?: IconName;
  panel: HTMLElement;
  /** Sekme başlığında gösterilecek durum rozeti. */
  badge?: () => HTMLElement | undefined;
}

/** Erişilebilir sekme grubu (ok tuşlarıyla gezinilebilir). */
export function tabs(specs: TabSpec[], initial = 0): { node: HTMLElement; select(id: string): void } {
  const bar = box('tabs');
  bar.setAttribute('role', 'tablist');
  const wrap = box('');
  const buttons = new Map<string, HTMLButtonElement>();

  const select = (id: string): void => {
    for (const spec of specs) {
      const active = spec.id === id;
      buttons.get(spec.id)?.setAttribute('aria-selected', String(active));
      buttons.get(spec.id)?.setAttribute('tabindex', active ? '0' : '-1');
      spec.panel.toggleAttribute('hidden', !active);
    }
  };

  specs.forEach((spec) => {
    const tab = el('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      id: `tab-${spec.id}`,
      'aria-controls': `panel-${spec.id}`,
      'aria-selected': 'false',
      tabindex: '-1'
    });
    if (spec.icon) {
      tab.append(icon(spec.icon));
    }
    tab.append(document.createTextNode(spec.label));
    const mark = spec.badge?.();
    if (mark) {
      tab.append(mark);
    }
    tab.addEventListener('click', () => select(spec.id));
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      const index = specs.findIndex((s) => s.id === spec.id);
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0) {
        return;
      }
      event.preventDefault();
      const next = specs[(index + delta + specs.length) % specs.length];
      if (next) {
        select(next.id);
        buttons.get(next.id)?.focus();
      }
    });
    buttons.set(spec.id, tab);
    bar.append(tab);

    spec.panel.setAttribute('role', 'tabpanel');
    spec.panel.setAttribute('id', `panel-${spec.id}`);
    spec.panel.setAttribute('aria-labelledby', `tab-${spec.id}`);
    spec.panel.classList.add('tabpanel');
  });

  wrap.append(bar, ...specs.map((s) => s.panel));
  select(specs[initial]?.id ?? specs[0]?.id ?? '');
  return { node: wrap, select };
}

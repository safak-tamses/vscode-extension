import type { DetailFromWebview, DetailToWebview, FindingView } from '../messages';
import { badge, box, button, el, pageHeader, spinner, statusBar, text } from './dom';
import { icon } from './icons';

declare function acquireVsCodeApi(): {
  postMessage(msg: DetailFromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;

const busy = spinner('Çözüm üretiliyor…');
const status = statusBar();

/** Sanitize edilmiş HTML'i, script çalıştırmadan (DOMParser + DOM ekleme) gösterir. */
function renderDescription(container: HTMLElement, sanitizedHtml: string): void {
  const parsed = new DOMParser().parseFromString(sanitizedHtml, 'text/html');
  container.replaceChildren(...Array.from(parsed.body.childNodes));
}

function severityTone(severity: FindingView['severity']): 'danger' | 'warn' | 'info' {
  switch (severity) {
    case 'BLOCKER':
    case 'CRITICAL':
      return 'danger';
    case 'MAJOR':
      return 'warn';
    default:
      return 'info';
  }
}

function render(view: FindingView): void {
  root.replaceChildren();
  const container = box('container');

  const providerBadge = view.provider.available
    ? badge('ok', view.provider.label, view.provider.id === 'copilot' ? 'copilot' : 'server')
    : badge('warn', view.provider.label + ' · kapalı', 'warning');
  container.append(pageHeader('target', view.ruleName, view.ruleKey, [providerBadge]));

  const card = box('card');
  const badges = box('badges');
  badges.append(
    badge(severityTone(view.severity), view.severity),
    badge('neutral', view.issueType.replace('_', ' '))
  );
  card.append(badges);

  const location = el('button', { class: 'location', type: 'button' });
  location.append(icon('file'), document.createTextNode(view.filePath + (view.line ? ':' + view.line : '')));
  location.addEventListener('click', () => vscode.postMessage({ type: 'openLocation' }));
  card.append(location);

  const message = box('message');
  message.textContent = view.message;
  card.append(message);

  const description = box('description');
  renderDescription(description, view.descriptionHtml);
  card.append(description);
  container.append(card);

  const actions = box('actions');
  const fixBtn = button('primary', 'Bu Bulguyu Çöz', () => vscode.postMessage({ type: 'fix' }), { icon: 'sparkle' });
  fixBtn.disabled = !view.provider.available;
  const fixAllBtn = button('secondary', 'Tümünü Çöz', () => vscode.postMessage({ type: 'fixAll' }), { icon: 'play' });
  fixAllBtn.disabled = !view.provider.available;
  actions.append(fixBtn, fixAllBtn);
  container.append(actions);

  if (!view.provider.available) {
    const warn = statusBar();
    warn.set(
      'warn',
      `${view.provider.label} şu anda kullanılamıyor; bulguyu görüntüleyip manuel çözebilirsiniz. ${view.provider.hint ?? ''}`.trim()
    );
    container.append(warn.node);
  }

  busy.set(false, `${view.provider.label} ile çözüm üretiliyor…`);
  status.clear();
  container.append(busy.node, status.node);

  const footer = text('card-note', 'Önerilen değişiklik önce diff olarak gösterilir; onaylamadan hiçbir dosya yazılmaz.');
  footer.style.marginTop = '16px';
  container.append(footer);

  root.append(container);
}

window.addEventListener('message', (event: MessageEvent<DetailToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'showFinding':
      render(msg.view);
      break;
    case 'busy':
      busy.set(msg.busy);
      break;
    case 'fixOutcome':
      busy.set(false);
      if (msg.status === 'applied') {
        status.set('ok', 'Değişiklik uygulandı.' + (msg.detail ? ' ' + msg.detail : ''));
      } else if (msg.status === 'rejected') {
        status.set('info', 'Değişiklik reddedildi; dosyaya hiçbir şey yazılmadı.');
      } else {
        status.set('danger', msg.detail ?? 'Bilinmeyen hata.');
      }
      break;
  }
});

vscode.postMessage({ type: 'ready' });

import type { DetailFromWebview, DetailToWebview, FindingView } from '../messages';

declare function acquireVsCodeApi(): {
  postMessage(msg: DetailFromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  return node;
}

const root = document.getElementById('root') as HTMLElement;

/** Sanitize edilmiş HTML'i, script çalıştırmadan (DOMParser + DOM ekleme) gösterir. */
function renderDescription(container: HTMLElement, sanitizedHtml: string): void {
  const parsed = new DOMParser().parseFromString(sanitizedHtml, 'text/html');
  container.replaceChildren(...Array.from(parsed.body.childNodes));
}

let busyEl: HTMLElement | undefined;
let statusEl: HTMLElement | undefined;

function render(view: FindingView): void {
  root.replaceChildren();
  const container = el('div', { class: 'container' });

  // Header
  const header = el('div', { class: 'header' });
  const headBox = el('div');
  const title = el('h1');
  title.textContent = view.ruleName;
  const sub = el('div', { class: 'subtitle' });
  sub.textContent = view.ruleKey;
  headBox.append(title, sub);
  header.append(headBox);

  // Badges
  const badges = el('div', { class: 'badges' });
  const sevBadge = el('span', { class: 'badge sev-' + view.severity });
  sevBadge.textContent = view.severity;
  const typeBadge = el('span', { class: 'badge type' });
  typeBadge.textContent = view.issueType.replace('_', ' ');
  badges.append(sevBadge, typeBadge);

  // Card
  const card = el('div', { class: 'card' });

  const location = el('a', { class: 'location', role: 'button', tabindex: '0' });
  location.textContent = view.filePath + (view.line ? ':' + view.line : '');
  location.addEventListener('click', () => vscode.postMessage({ type: 'openLocation' }));

  const message = el('div', { class: 'message' });
  message.textContent = view.message;

  const description = el('div', { class: 'description' });
  renderDescription(description, view.descriptionHtml);

  card.append(badges, location, message, description);

  // Actions
  const actions = el('div', { class: 'actions' });
  const fixBtn = el('button', { class: 'primary' });
  fixBtn.textContent = `Çöz (${view.provider.label})`;
  fixBtn.addEventListener('click', () => vscode.postMessage({ type: 'fix' }));
  const fixAllBtn = el('button', { class: 'secondary' });
  fixAllBtn.textContent = 'Tümünü Çöz';
  fixAllBtn.addEventListener('click', () => vscode.postMessage({ type: 'fixAll' }));
  actions.append(fixBtn, fixAllBtn);

  if (!view.provider.available) {
    const note = el('div', { class: 'status show info' });
    note.textContent =
      `${view.provider.label} şu anda kullanılamıyor; bulguyu görüntüleyip manuel çözebilirsiniz. ` +
      (view.provider.hint ?? '');
    card.append(note);
  }

  const spinner = el('div', { class: 'spinner' });
  spinner.textContent = `${view.provider.label} ile çözüm üretiliyor…`;
  busyEl = spinner;

  const status = el('div', { class: 'status' });
  statusEl = status;

  container.append(header, card, actions, spinner, status);
  root.append(container);
}

function setBusy(busy: boolean): void {
  if (busyEl) {
    busyEl.classList.toggle('show', busy);
  }
}

function showOutcome(status: 'applied' | 'rejected' | 'error', detail?: string): void {
  if (!statusEl) {
    return;
  }
  const map = {
    applied: { kind: 'ok', text: 'Değişiklik uygulandı.' },
    rejected: { kind: 'info', text: 'Değişiklik reddedildi.' },
    error: { kind: 'error', text: 'Hata: ' + (detail ?? 'bilinmeyen') }
  } as const;
  const entry = map[status];
  statusEl.className = 'status show ' + entry.kind;
  statusEl.textContent = detail && status !== 'error' ? entry.text + ' ' + detail : entry.text;
}

window.addEventListener('message', (event: MessageEvent<DetailToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'showFinding':
      render(msg.view);
      break;
    case 'busy':
      setBusy(msg.busy);
      break;
    case 'fixOutcome':
      setBusy(false);
      showOutcome(msg.status, msg.detail);
      break;
  }
});

vscode.postMessage({ type: 'ready' });

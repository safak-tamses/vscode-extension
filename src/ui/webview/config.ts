import type { ConfigFormState, ConfigFromWebview, ConfigToWebview } from '../messages';

declare function acquireVsCodeApi(): {
  postMessage(msg: ConfigFromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  for (const c of children) {
    node.append(c);
  }
  return node;
}

function field(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = el('div', { class: 'field' });
  const label = el('label');
  label.textContent = labelText;
  wrap.append(label, control);
  if (hint) {
    const h = el('span', { class: 'hint' });
    h.textContent = hint;
    wrap.append(h);
  }
  return wrap;
}

const root = document.getElementById('root') as HTMLElement;

const sonarUrl = el('input', { type: 'text', id: 'sonarUrl', placeholder: 'https://sonar.kurum-ici.local' });
const projectKey = el('input', { type: 'text', id: 'projectKey', placeholder: 'org.kurum:proje-anahtari' });
const branch = el('input', { type: 'text', id: 'branch', placeholder: 'main (boş bırakılabilir)' });
const authScheme = el('select', { id: 'authScheme' });
authScheme.append(new Option('Bearer (SonarQube 10.x+)', 'bearer'), new Option('Basic (eski sürümler)', 'basic'));
const token = el('input', { type: 'password', id: 'token', placeholder: '••••••••  (gizli olarak saklanır)' });

const testBtn = el('button', { class: 'secondary', id: 'testBtn' });
testBtn.textContent = 'Bağlantıyı Test Et';
const saveBtn = el('button', { class: 'primary', id: 'saveBtn' });
saveBtn.textContent = 'Kaydet';

const status = el('div', { class: 'status', id: 'status' });

function header(): HTMLElement {
  const h = el('div', { class: 'header' });
  const box = el('div');
  const title = el('h1');
  title.textContent = 'SonarQube Bağlantısı';
  const sub = el('div', { class: 'subtitle' });
  sub.textContent = 'Bağlantı bilgilerini girip kaydedin. Token gizli olarak saklanır; tarama yalnızca kayıttan sonra çalışır.';
  box.append(title, sub);
  h.append(box);
  return h;
}

function render(): void {
  root.replaceChildren();
  const card = el('div', { class: 'card' });
  card.append(
    field('SonarQube Enterprise URL', sonarUrl, 'Sunucu adresi. Token bu alanda tutulmaz.'),
    field('Project Key (repo)', projectKey, 'SonarQube proje anahtarı. Proje URL’sinden ?id= değeri de yapıştırılabilir.'),
    field('Branch', branch, 'Taranacak dal; boşsa ana dal.'),
    field('Kimlik Doğrulama', authScheme),
    field('Token', token, 'VS Code SecretStorage’da saklanır; koda/loga yazılmaz.')
  );
  const actions = el('div', { class: 'actions' });
  actions.append(testBtn, saveBtn);
  card.append(actions, status);
  root.append(header(), card);
}

function readForm(): ConfigFormState {
  return {
    sonarUrl: sonarUrl.value.trim(),
    projectKey: parseProjectKey(projectKey.value.trim()),
    branch: branch.value.trim(),
    authScheme: (authScheme.value === 'basic' ? 'basic' : 'bearer')
  };
}

/** Kullanıcı tam proje URL’si yapıştırırsa ?id= veya ?project= değerini çıkar. */
function parseProjectKey(raw: string): string {
  const match = raw.match(/[?&](?:id|project)=([^&]+)/);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return raw;
}

function setStatus(kind: 'ok' | 'error' | 'info', text: string): void {
  status.className = 'status show ' + kind;
  status.textContent = text;
}

function setBusy(busy: boolean): void {
  testBtn.toggleAttribute('disabled', busy);
  saveBtn.toggleAttribute('disabled', busy);
  if (busy) {
    setStatus('info', 'İşleniyor…');
  }
}

testBtn.addEventListener('click', () => {
  const form = readForm();
  if (!form.sonarUrl || !form.projectKey) {
    setStatus('error', 'URL ve Project Key zorunludur.');
    return;
  }
  vscode.postMessage({ type: 'test', form, token: token.value });
});

saveBtn.addEventListener('click', () => {
  const form = readForm();
  if (!form.sonarUrl || !form.projectKey) {
    setStatus('error', 'URL ve Project Key zorunludur.');
    return;
  }
  vscode.postMessage({ type: 'save', form, token: token.value });
});

window.addEventListener('message', (event: MessageEvent<ConfigToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      sonarUrl.value = msg.form.sonarUrl;
      projectKey.value = msg.form.projectKey;
      branch.value = msg.form.branch;
      authScheme.value = msg.form.authScheme;
      if (msg.hasToken) {
        token.placeholder = '•••••••• (kayıtlı — değiştirmek için yeni token girin)';
      }
      break;
    case 'busy':
      setBusy(msg.busy);
      break;
    case 'testResult':
      if (msg.ok) {
        setStatus('ok', 'Bağlantı başarılı. SonarQube erişimi doğrulandı.');
      } else {
        setStatus('error', 'Bağlantı başarısız: ' + (msg.detail ?? 'bilinmeyen hata'));
      }
      break;
    case 'saved':
      setStatus('ok', 'Kaydedildi. Artık bulguları tarayabilirsiniz.');
      token.value = '';
      break;
  }
});

render();
vscode.postMessage({ type: 'ready' });

import type {
  ConfigFromWebview,
  ConfigToWebview,
  LlmFormState,
  RuleFileView,
  RulesView,
  SonarFormState,
  ToolPathView
} from '../messages';
import { badge, box, button, el, field, pageHeader, statusBar, tabs, text } from './dom';
import { icon } from './icons';

declare function acquireVsCodeApi(): {
  postMessage(msg: ConfigFromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;

// ------------------------------------------------------------------ SonarQube

const sonarUrl = el('input', { type: 'text', placeholder: 'https://sonar.kurum-ici.local' });
const projectKey = el('input', { type: 'text', placeholder: 'org.kurum:proje-anahtari' });
const branch = el('input', { type: 'text', placeholder: 'main (boş bırakılabilir)' });
const authScheme = el('select');
authScheme.append(new Option('Bearer (SonarQube 10.x+)', 'bearer'), new Option('Basic (eski sürümler)', 'basic'));
const sonarToken = el('input', { type: 'password', placeholder: '••••••••  (gizli olarak saklanır)' });
const projectRoot = el('input', { type: 'text', placeholder: 'boş = workspace kökü' });
const browseRootBtn = button('secondary', 'Klasör Seç…', () => vscode.postMessage({ type: 'browseProjectRoot' }), {
  icon: 'folder',
  tiny: true
});
const sonarStatus = statusBar();
const sonarTestBtn = button('secondary', 'Bağlantıyı Test Et', () => submitSonar('testSonar'), { icon: 'plug' });
const sonarSaveBtn = button('primary', 'Kaydet', () => submitSonar('saveSonar'), { icon: 'check' });

function sonarPanel(): HTMLElement {
  const panel = box('');
  const card = box('card');
  const head = box('card-head');
  const h2 = el('h2', {}, [icon('plug'), document.createTextNode('SonarQube Bağlantısı')]);
  head.append(box('grow', h2));
  card.append(
    head,
    text('card-note', 'Bulguları tarayabilmek için bu bilgiler kaydedilmelidir. Token yalnızca SecretStorage’da saklanır.'),
    field('SonarQube Enterprise URL', sonarUrl, { id: 'f-sonar-url', hint: 'Sunucu adresi. Token bu alanda tutulmaz.' }),
    field('Project Key (repo)', projectKey, {
      id: 'f-project-key',
      hint: 'SonarQube proje anahtarı. Proje URL’sini yapıştırırsanız ?id= değeri otomatik ayıklanır.'
    })
  );
  const row = box('field-row');
  row.append(
    field('Branch', branch, { id: 'f-branch', hint: 'Taranacak dal; boşsa ana dal.' }),
    field('Kimlik Doğrulama', authScheme, { id: 'f-auth' })
  );
  card.append(
    row,
    field('Token', sonarToken, { id: 'f-token', hint: 'VS Code SecretStorage’da saklanır; koda/loga/ayar dosyasına yazılmaz.' }),
    field('Proje Kök Dizini', projectRoot, {
      id: 'f-project-root',
      hint:
        'Bulgudaki yolların göreli olduğu kök. Monorepo alt klasörü için göreli (backend), ' +
        'workspace dışındaki bir proje için mutlak yol verin. Boşsa workspace klasörleri kullanılır.'
    }),
    box('actions tight', browseRootBtn),
    box('actions', sonarTestBtn, sonarSaveBtn),
    sonarStatus.node
  );
  panel.append(card);
  return panel;
}

function readSonar(): SonarFormState {
  return {
    sonarUrl: sonarUrl.value.trim(),
    projectKey: parseProjectKey(projectKey.value.trim()),
    branch: branch.value.trim(),
    authScheme: authScheme.value === 'basic' ? 'basic' : 'bearer',
    projectRoot: projectRoot.value.trim()
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

function submitSonar(type: 'testSonar' | 'saveSonar'): void {
  const form = readSonar();
  if (!form.sonarUrl || !form.projectKey) {
    sonarStatus.set('danger', 'URL ve Project Key zorunludur.');
    return;
  }
  vscode.postMessage({ type, form, token: sonarToken.value });
}

// -------------------------------------------------------------- model sağlayıcı

let provider: 'copilot' | 'local' = 'copilot';

const copilotVendor = el('input', { type: 'text', placeholder: 'copilot' });
const copilotFamily = el('input', { type: 'text', placeholder: 'boş = ilk uygun model' });
const localProtocol = el('select');
localProtocol.append(
  new Option('OpenAI uyumlu — vLLM, TGI, LM Studio, LiteLLM, ağ geçidi', 'openai'),
  new Option('Ollama — /api/chat', 'ollama')
);
const localBaseUrl = el('input', { type: 'text', placeholder: 'http://llm.kurum-ici.local:8000/v1' });
const localModel = el('input', { type: 'text', placeholder: 'qwen2.5-coder:32b' });
const localApiKey = el('input', { type: 'password', placeholder: 'gerekmiyorsa boş bırakın' });
const localTemperature = el('input', { type: 'number', step: '0.1', min: '0', max: '2' });
const localMaxTokens = el('input', { type: 'number', step: '256', min: '256' });
const localTimeout = el('input', { type: 'number', step: '10', min: '5' });

const llmStatus = statusBar();
const llmTestBtn = button('secondary', 'Modeli Test Et', () => submitLlm('testLlm'), { icon: 'plug' });
const llmSaveBtn = button('primary', 'Kaydet', () => submitLlm('saveLlm'), { icon: 'check' });
const clearKeyBtn = button('link', 'Kayıtlı anahtarı sil', () => vscode.postMessage({ type: 'clearLlmKey' }), {
  tiny: true
});

const copilotSegment = segment(
  'copilot',
  'copilot',
  'GitHub Copilot',
  'VS Code Language Model API üzerinden. Ek kurulum gerekmez.'
);
const localSegment = segment(
  'server',
  'local',
  'Şirket İçi Local LLM',
  'Kendi sunucunuz. Kod ve istem kurum ağının dışına çıkmaz.'
);
const copilotFields = box('');
const localFields = box('');
const keyRow = box('actions tight', clearKeyBtn);

function segment(
  glyph: 'copilot' | 'server',
  value: 'copilot' | 'local',
  title: string,
  description: string
): HTMLButtonElement {
  const node = el('button', { class: 'segment', type: 'button', 'aria-pressed': 'false' });
  node.append(box('glyph', icon(glyph, 'lg')));
  const info = box('');
  info.append(text('seg-title', title), text('seg-desc', description));
  node.append(info);
  node.addEventListener('click', () => setProvider(value));
  return node;
}

function setProvider(next: 'copilot' | 'local'): void {
  provider = next;
  copilotSegment.setAttribute('aria-pressed', String(next === 'copilot'));
  localSegment.setAttribute('aria-pressed', String(next === 'local'));
  copilotFields.toggleAttribute('hidden', next !== 'copilot');
  localFields.toggleAttribute('hidden', next !== 'local');
  llmStatus.clear();
}

function llmPanel(): HTMLElement {
  const panel = box('');

  const chooser = box('card');
  const head = box('card-head');
  head.append(box('grow', el('h2', {}, [icon('sparkle'), document.createTextNode('Model Sağlayıcı')])));
  chooser.append(
    head,
    text('card-note', 'Çözüm önerileri ve birim test üretimi bu sağlayıcı ile yapılır. İstediğiniz zaman değiştirebilirsiniz.'),
    box('segmented', copilotSegment, localSegment)
  );

  copilotFields.append(
    field('Sağlayıcı adı (vendor)', copilotVendor, {
      id: 'f-vendor',
      hint: 'vscode.lm sağlayıcı adı. Varsayılan: copilot.'
    }),
    field('Model ailesi', copilotFamily, {
      id: 'f-family',
      hint: 'Örn. gpt-4o. Boş bırakılırsa ilk uygun model kullanılır.'
    })
  );

  localFields.append(
    field('Protokol', localProtocol, {
      id: 'f-protocol',
      hint: 'Sunucunuz OpenAI uyumlu bir /chat/completions uç noktası mı sunuyor, yoksa Ollama mı?'
    }),
    field('Sunucu adresi', localBaseUrl, {
      id: 'f-base-url',
      hint: 'Yalnızca host verirseniz OpenAI protokolünde /v1 otomatik eklenir. Anahtar bu alana yazılmaz.'
    }),
    field('Model adı', localModel, { id: 'f-model', hint: 'Sunucuda yüklü model kimliği.' }),
    field('API anahtarı', localApiKey, {
      id: 'f-api-key',
      hint: 'Yalnızca SecretStorage’da saklanır; ayar dosyasına ve denetim kaydına yazılmaz.'
    }),
    keyRow
  );
  const tuning = box('field-row');
  tuning.append(
    field('Sıcaklık', localTemperature, { id: 'f-temp', hint: 'Kod için düşük tutun (0–0.2).' }),
    field('Azami yanıt token’ı', localMaxTokens, { id: 'f-max-tokens', hint: 'Test dosyaları uzun olabilir.' }),
    field('Zaman aşımı (sn)', localTimeout, { id: 'f-timeout' })
  );
  localFields.append(tuning);

  const settings = box('card');
  settings.append(copilotFields, localFields, box('actions', llmTestBtn, llmSaveBtn), llmStatus.node);

  panel.append(chooser, settings);
  return panel;
}

function readLlm(): LlmFormState {
  return {
    provider,
    copilotVendor: copilotVendor.value.trim() || 'copilot',
    copilotFamily: copilotFamily.value.trim(),
    localProtocol: localProtocol.value === 'ollama' ? 'ollama' : 'openai',
    localBaseUrl: localBaseUrl.value.trim(),
    localModel: localModel.value.trim(),
    localTemperature: numberOr(localTemperature.value, 0.1),
    localMaxOutputTokens: numberOr(localMaxTokens.value, 4096),
    localTimeoutSec: numberOr(localTimeout.value, 120)
  };
}

function numberOr(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function submitLlm(type: 'testLlm' | 'saveLlm'): void {
  const form = readLlm();
  if (form.provider === 'local' && (!form.localBaseUrl || !form.localModel)) {
    llmStatus.set('danger', 'Local LLM için sunucu adresi ve model adı zorunludur.');
    return;
  }
  vscode.postMessage({ type, form, apiKey: localApiKey.value });
}

// ------------------------------------------------------------------- kurallar

const rulesBody = box('');
let rulesBadge: HTMLElement | undefined;

const mavenPath = el('input', { type: 'text', placeholder: 'boş = mvn, PATH üzerinden' });
const javaHome = el('input', { type: 'text', placeholder: 'boş = ortamın JAVA_HOME değeri' });
const mavenStatus = statusBar();
const javaStatus = statusBar();
const toolsBody = box('');

function rulesPanel(): HTMLElement {
  const panel = box('');
  panel.append(toolsBody, rulesBody);
  return panel;
}

/**
 * Derleme araçları kartı. İkisi de isteğe bağlıdır: boş bırakılınca komut olduğu gibi çalışır,
 * `mvn` PATH'ten bulunur ve ortamın JAVA_HOME değeri kullanılır. Alanlar yalnızca araçların
 * PATH'te olmadığı makineler için gereklidir.
 */
function renderTools(maven: ToolPathView, java: ToolPathView): void {
  toolsBody.replaceChildren();
  mavenPath.value = maven.path;
  javaHome.value = java.path;

  const card = box('card');
  const head = box('card-head');
  head.append(box('grow', el('h2', {}, [icon('play'), document.createTextNode('Derleme Araçları')])));
  card.append(
    head,
    text(
      'card-note',
      'Her ikisi de isteğe bağlıdır. Boş bırakılırsa kural setindeki komut olduğu gibi çalışır: ' +
        'mvn PATH üzerinden bulunur ve ortamın JAVA_HOME değeri kullanılır. Araçlar PATH’te ' +
        'değilse konumlarını burada belirtin.'
    ),
    field('Maven kökü, bin dizini veya mvn dosyası', mavenPath, {
      id: 'f-maven-path',
      hint: 'Örn. C:\\apache-maven-3.9.6  ·  C:\\apache-maven-3.9.6\\bin\\mvn.cmd  ·  /opt/maven/bin/mvn'
    }),
    box(
      'actions',
      button('secondary', 'Maven Konumu Seç…', () => vscode.postMessage({ type: 'browseMavenPath' }), {
        icon: 'folder',
        tiny: true
      }),
      button(
        'primary',
        'Maven Yolunu Kaydet',
        () => vscode.postMessage({ type: 'saveMavenPath', value: mavenPath.value }),
        { icon: 'check', tiny: true }
      )
    ),
    mavenStatus.node,
    field('JDK kökü (JAVA_HOME), bin dizini veya java dosyası', javaHome, {
      id: 'f-java-home',
      hint:
        'mvn clean install derleme yapar; JDK gerekir (JRE yetmez). ' +
        'Örn. C:\\jdk-17  ·  /Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home'
    }),
    box(
      'actions',
      button('secondary', 'JDK Kökü Seç…', () => vscode.postMessage({ type: 'browseJavaHome' }), {
        icon: 'folder',
        tiny: true
      }),
      button(
        'primary',
        'JDK Yolunu Kaydet',
        () => vscode.postMessage({ type: 'saveJavaHome', value: javaHome.value }),
        { icon: 'check', tiny: true }
      )
    ),
    javaStatus.node
  );
  toolsBody.append(card);
  mavenStatus.set(maven.ok ? (maven.path ? 'ok' : 'info') : 'danger', maven.detail);
  javaStatus.set(java.ok ? (java.path ? 'ok' : 'info') : 'danger', java.detail);
}

function renderRules(rules: RulesView): void {
  renderTools(rules.maven, rules.java);
  rulesBody.replaceChildren();

  const card = box('card');
  const head = box('card-head');
  const h2 = el('h2', {}, [icon('rules'), document.createTextNode('Birim Test Kural Setleri')]);
  head.append(box('grow', h2));
  head.append(
    button('ghost', 'Yeniden Yükle', () => vscode.postMessage({ type: 'reloadRules' }), {
      icon: 'refresh',
      tiny: true
    })
  );
  card.append(head);

  const note = el('div', { class: 'card-note' });
  note.append(
    document.createTextNode('Kurallarınızı '),
    text('mono', rules.dir + '/*.md'),
    document.createTextNode(
      ' dizinine ekleyin. Frontmatter (--- arası) makine tarafından okunur; sonrasındaki Markdown gövdesi modele aynen iletilir.'
    )
  );
  card.append(note);

  if (rules.files.length === 0) {
    card.append(
      box(
        'empty',
        (() => {
          const inner = box('');
          inner.append(box('glyph', icon('rules', 'xl')));
          const title = el('h2');
          title.textContent = 'Henüz kural seti yok';
          const desc = el('p');
          desc.textContent =
            'Örnek kural seti Spring Boot 3 / Java 17 · Maven + JaCoCo · JUnit 5 + Mockito + AssertJ için hazırdır. Oluşturup projenize göre uyarlayın.';
          inner.append(title, desc);
          inner.append(
            box(
              'actions',
              button('primary', 'Örnek Kural Setini Oluştur', () => vscode.postMessage({ type: 'createSampleRules' }), {
                icon: 'newFile'
              })
            )
          );
          return inner;
        })()
      )
    );
  } else {
    for (const file of rules.files) {
      card.append(ruleFileCard(file));
    }
    card.append(
      box(
        'actions',
        button('secondary', 'Örnek Kural Seti Ekle', () => vscode.postMessage({ type: 'createSampleRules' }), {
          icon: 'newFile'
        })
      )
    );
  }

  rulesBody.append(card);
  updateRulesBadge(rules);
}

function ruleFileCard(file: RuleFileView): HTMLElement {
  const wrap = box('rule-file');
  const head = box('rule-head');
  const grow = box('grow');
  const title = el('button', { class: 'row-link', type: 'button' });
  title.append(text('row-title truncate', file.name ?? file.path));
  title.addEventListener('click', () => vscode.postMessage({ type: 'openRuleFile', path: file.path }));
  grow.append(title, text('row-sub mono truncate', file.path));
  head.append(grow);

  if (file.errors.length > 0) {
    head.append(badge('danger', `${file.errors.length} hata`, 'error'));
  } else if (file.disabled) {
    head.append(badge('neutral', 'kapalı'));
  } else {
    head.append(badge('ok', 'etkin', 'check'));
  }
  if (file.warnings.length > 0) {
    head.append(badge('warn', `${file.warnings.length} uyarı`, 'warning'));
  }
  wrap.append(head);

  if (file.summary) {
    wrap.append(text('row-sub', file.summary));
  }
  if (file.errors.length > 0 || file.warnings.length > 0) {
    const list = el('ul', { class: 'issue-list' });
    for (const issue of file.errors) {
      const li = el('li', { class: 'err' });
      li.textContent = (issue.line > 0 ? `satır ${issue.line}: ` : '') + issue.message;
      list.append(li);
    }
    for (const issue of file.warnings) {
      const li = el('li', { class: 'warn' });
      li.textContent = (issue.line > 0 ? `satır ${issue.line}: ` : '') + issue.message;
      list.append(li);
    }
    wrap.append(list);
  }
  return wrap;
}

function updateRulesBadge(rules: RulesView): void {
  if (!rulesBadge) {
    return;
  }
  const errors = rules.files.reduce((n, f) => n + f.errors.length, 0);
  const next =
    errors > 0
      ? badge('danger', String(errors))
      : rules.activeCount > 0
        ? badge('ok', String(rules.activeCount))
        : badge('neutral', '0');
  rulesBadge.replaceChildren(next);
}

// ------------------------------------------------------------------- kabuk

function render(): void {
  root.replaceChildren();
  const container = box('container');
  container.append(
    pageHeader(
      'health',
      'Kod Sağlığı Kurulumu',
      'Bağlantı, model sağlayıcı ve test kuralları. Kaydedilmeden tarama ve çözüm çalışmaz.'
    )
  );

  rulesBadge = box('');
  rulesBadge.style.marginLeft = '4px';

  const group = tabs([
    { id: 'sonar', label: 'Bağlantı', icon: 'plug', panel: sonarPanel() },
    { id: 'llm', label: 'Yapay Zekâ', icon: 'sparkle', panel: llmPanel() },
    { id: 'rules', label: 'Test Kuralları', icon: 'rules', panel: rulesPanel(), badge: () => rulesBadge }
  ]);
  container.append(group.node);
  root.append(container);
  setProvider(provider);
}

function setBusy(target: 'sonar' | 'llm' | 'rules', busy: boolean): void {
  if (target === 'sonar') {
    sonarTestBtn.disabled = busy;
    sonarSaveBtn.disabled = busy;
    if (busy) {
      sonarStatus.set('info', 'İşleniyor…');
    }
  } else if (target === 'llm') {
    llmTestBtn.disabled = busy;
    llmSaveBtn.disabled = busy;
    if (busy) {
      llmStatus.set('info', 'Model sunucusuna bağlanılıyor…');
    }
  }
}

window.addEventListener('message', (event: MessageEvent<ConfigToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init': {
      sonarUrl.value = msg.sonar.sonarUrl;
      projectKey.value = msg.sonar.projectKey;
      branch.value = msg.sonar.branch;
      authScheme.value = msg.sonar.authScheme;
      projectRoot.value = msg.sonar.projectRoot;
      if (msg.hasSonarToken) {
        sonarToken.placeholder = '•••••••• (kayıtlı — değiştirmek için yeni token girin)';
      }

      copilotVendor.value = msg.llm.copilotVendor;
      copilotFamily.value = msg.llm.copilotFamily;
      localProtocol.value = msg.llm.localProtocol;
      localBaseUrl.value = msg.llm.localBaseUrl;
      localModel.value = msg.llm.localModel;
      localTemperature.value = String(msg.llm.localTemperature);
      localMaxTokens.value = String(msg.llm.localMaxOutputTokens);
      localTimeout.value = String(msg.llm.localTimeoutSec);
      if (msg.hasLlmKey) {
        localApiKey.placeholder = '•••••••• (kayıtlı — değiştirmek için yeni anahtar girin)';
      }
      keyRow.toggleAttribute('hidden', !msg.hasLlmKey);
      setProvider(msg.llm.provider);
      renderRules(msg.rules);
      break;
    }
    case 'rules':
      renderRules(msg.rules);
      break;
    case 'projectRoot':
      projectRoot.value = msg.value;
      sonarStatus.set('info', 'Klasör seçildi. Kalıcı olması için Kaydet’e basın.');
      break;
    case 'toolPaths':
      renderTools(msg.maven, msg.java);
      break;
    case 'busy':
      setBusy(msg.target, msg.busy);
      break;
    case 'testResult': {
      const bar = msg.target === 'sonar' ? sonarStatus : llmStatus;
      bar.set(msg.ok ? 'ok' : 'danger', msg.detail ?? (msg.ok ? 'Bağlantı başarılı.' : 'Bağlantı başarısız.'));
      break;
    }
    case 'saved':
      if (msg.target === 'sonar') {
        sonarStatus.set('ok', 'Kaydedildi. Artık bulguları tarayabilirsiniz.');
        sonarToken.value = '';
        sonarToken.placeholder = '•••••••• (kayıtlı — değiştirmek için yeni token girin)';
      } else {
        llmStatus.set('ok', 'Kaydedildi. Çözüm ve test üretimi bu sağlayıcı ile yapılacak.');
        if (localApiKey.value) {
          localApiKey.value = '';
          localApiKey.placeholder = '•••••••• (kayıtlı — değiştirmek için yeni anahtar girin)';
          keyRow.removeAttribute('hidden');
        }
      }
      break;
  }
});

render();
vscode.postMessage({ type: 'ready' });

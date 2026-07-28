import type { CoverageFromWebview, CoverageToWebview, CoverageView, GapView } from '../messages';
import { badge, box, button, el, emptyState, meter, pageHeader, ring, spinner, stat, statusBar, text } from './dom';
import { icon } from './icons';

declare function acquireVsCodeApi(): {
  postMessage(msg: CoverageFromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;

const busy = spinner('Taranıyor…');
const status = statusBar();

let current: CoverageView | undefined;
let filter = '';
let onlyMissingTests = false;

function render(): void {
  root.replaceChildren();
  const container = box('container wide');
  const view = current;

  const scanBtn = button('primary', 'Derle ve Tara', () => vscode.postMessage({ type: 'scan', build: true }), {
    icon: 'play',
    title: 'Derleme komutunu çalıştırıp taze JaCoCo raporu üretir'
  });
  const readBtn = button('ghost', 'Raporu Oku', () => vscode.postMessage({ type: 'scan', build: false }), {
    icon: 'refresh',
    title: 'Var olan jacoco.xml dosyalarını yeniden okur'
  });

  container.append(
    pageHeader(
      'beaker',
      'Test Kapsamı',
      view ? `Son tarama ${view.scannedAt} · ${view.buildSummary}` : 'Henüz tarama yapılmadı.',
      [scanBtn, readBtn]
    )
  );

  if (!view) {
    container.append(
      emptyState(
        'beaker',
        'Kapsam taraması bekleniyor',
        'Kural setlerinize göre JaCoCo raporlarını okur, test edilmemiş sınıf ve metotları listeler.',
        [{ label: 'Derle ve Tara', onClick: () => vscode.postMessage({ type: 'scan', build: true }), icon: 'play' }]
      ),
      busy.node,
      status.node
    );
    root.append(container);
    return;
  }

  if (view.blocker) {
    container.append(
      emptyState('rules', 'Tarama yapılamadı', view.blocker, [
        {
          label: 'Örnek Kural Seti Oluştur',
          onClick: () => vscode.postMessage({ type: 'createSampleRules' }),
          icon: 'newFile'
        },
        {
          label: 'Kurulumu Aç',
          onClick: () => vscode.postMessage({ type: 'configure' }),
          variant: 'secondary',
          icon: 'plug'
        }
      ]),
      busy.node,
      status.node
    );
    root.append(container);
    return;
  }

  container.append(summaryCard(view));

  if (view.gaps.length === 0) {
    container.append(
      emptyState(
        'shield',
        'Eksik birim testi bulunamadı',
        'Kural setlerinizdeki eşiklere göre tüm sınıflar yeterli kapsama sahip. Kod değiştikçe yeniden tarayın.'
      )
    );
  } else {
    container.append(toolbar(view), gapList(view));
  }

  container.append(rulesCard(view), busy.node, status.node);
  if (view.problems.length > 0) {
    container.append(problemsCard(view));
  }
  root.append(container);
}

function summaryCard(view: CoverageView): HTMLElement {
  const card = box('card');
  const grid = box('summary');
  grid.append(
    ring(view.summary.lineCoverage, view.thresholds.line, `satır kapsamı (eşik %${view.thresholds.line})`),
    ring(view.summary.branchCoverage, view.thresholds.branch, `dal kapsamı (eşik %${view.thresholds.branch})`, 54),
    stat(String(view.summary.gapCount), 'eksik testli sınıf'),
    stat(String(view.summary.classCount), 'analiz edilen sınıf'),
    stat(String(view.summary.moduleCount), 'kapsam raporu')
  );
  card.append(grid);

  const providerNote = box('card-note');
  providerNote.append(
    view.provider.available
      ? badge('ok', view.provider.label, view.provider.id === 'copilot' ? 'copilot' : 'server')
      : badge('warn', view.provider.label + ' · kapalı', 'warning')
  );
  providerNote.append(
    document.createTextNode(
      view.provider.available
        ? '  Üretilen her test dosyası diff olarak onayınıza sunulur.'
        : `  Test üretimi için sağlayıcı gerekli. ${view.provider.hint ?? ''}`
    )
  );
  providerNote.style.marginTop = '14px';
  card.append(providerNote);
  return card;
}

function toolbar(view: CoverageView): HTMLElement {
  const bar = box('toolbar');
  const search = el('input', { type: 'text', placeholder: 'Sınıf veya paket ara…' });
  search.value = filter;
  search.addEventListener('input', () => {
    filter = search.value.trim().toLowerCase();
    refreshList(view);
  });
  const grow = box('grow');
  grow.append(search);

  const chip = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(onlyMissingTests) });
  chip.textContent = 'yalnızca test dosyası olmayanlar';
  chip.addEventListener('click', () => {
    onlyMissingTests = !onlyMissingTests;
    chip.setAttribute('aria-pressed', String(onlyMissingTests));
    refreshList(view);
  });

  bar.append(grow, chip, text('dim', `${view.gaps.length} sınıf`));
  return bar;
}

let listCard: HTMLElement | undefined;

function visibleGaps(view: CoverageView): GapView[] {
  return view.gaps.filter((gap) => {
    if (onlyMissingTests && gap.testExists) {
      return false;
    }
    if (!filter) {
      return true;
    }
    return (
      gap.qualifiedName.toLowerCase().includes(filter) ||
      gap.moduleName.toLowerCase().includes(filter) ||
      gap.reasons.some((r) => r.toLowerCase().includes(filter))
    );
  });
}

function gapList(view: CoverageView): HTMLElement {
  listCard = box('card flush');
  refreshList(view);
  return listCard;
}

function refreshList(view: CoverageView): void {
  if (!listCard) {
    return;
  }
  const gaps = visibleGaps(view);
  const rows = box('rows');
  if (gaps.length === 0) {
    rows.append(emptyState('target', 'Eşleşen sınıf yok', 'Arama veya filtreyi değiştirin.'));
  } else {
    for (const gap of gaps) {
      rows.append(gapRow(gap, view));
    }
  }
  listCard.replaceChildren(rows);
}

function gapRow(gap: GapView, view: CoverageView): HTMLElement {
  const row = box('row');
  row.id = `gap-${gap.id}`;

  const open = el('button', { class: 'row-link', type: 'button' });
  const title = box('row-title');
  title.append(icon('file'), text('truncate', gap.simpleName));
  if (!gap.testExists) {
    title.append(badge('danger', 'test yok'));
  }
  open.append(title);
  open.append(text('row-sub truncate', `${gap.moduleName} › ${gap.packageName || '(varsayılan paket)'}`));
  open.addEventListener('click', () => vscode.postMessage({ type: 'openSource', id: gap.id }));

  const main = box('row-main');
  main.append(open);

  const meta = box('row-meta');
  for (const reason of gap.reasons) {
    meta.append(badge(reason === 'test dosyası yok' ? 'danger' : 'neutral', reason));
  }
  if (gap.uncoveredMethodCount > 0) {
    meta.append(badge('warn', `${gap.uncoveredMethodCount}/${gap.totalMethods} metot test edilmemiş`));
  }
  main.append(meta);

  if (gap.uncoveredMethods.length > 0) {
    const list = el('ul', { class: 'method-list' });
    for (const signature of gap.uncoveredMethods) {
      const li = el('li');
      li.textContent = signature;
      list.append(li);
    }
    main.append(list);
  }

  const metrics = box('');
  metrics.append(meter(gap.lineCoverage, gap.thresholds.line, `${gap.simpleName} satır kapsamı`));
  if (!gap.reportMissing) {
    metrics.append(meter(gap.branchCoverage, gap.thresholds.branch, `${gap.simpleName} dal kapsamı`));
  }

  const actions = box('row-actions');
  const generate = button('primary', 'Test Üret', () => vscode.postMessage({ type: 'generate', id: gap.id }), {
    icon: 'sparkle',
    tiny: true
  });
  generate.disabled = !view.provider.available;
  actions.append(generate);
  if (gap.testExists) {
    actions.append(
      button('ghost', 'Testi Aç', () => vscode.postMessage({ type: 'openTest', id: gap.id }), {
        icon: 'beaker',
        tiny: true
      })
    );
  }

  row.append(main, metrics, actions);
  return row;
}

function rulesCard(view: CoverageView): HTMLElement {
  const card = box('card');
  const head = box('card-head');
  head.append(box('grow', el('h2', {}, [icon('rules'), document.createTextNode('Etkin Kural Setleri')])));
  head.append(
    button('ghost', 'Kurulumu Aç', () => vscode.postMessage({ type: 'configure' }), { icon: 'plug', tiny: true })
  );
  card.append(head);

  if (view.ruleSets.length === 0) {
    card.append(text('card-note', 'Etkin kural seti yok.'));
    return card;
  }
  const list = el('dl', { class: 'kv' });
  for (const rule of view.ruleSets) {
    const dt = el('dt');
    dt.textContent = rule.name;
    const dd = el('dd');
    dd.append(
      text(
        '',
        `eşikler: satır %${rule.thresholds.line} · dal %${rule.thresholds.branch} · metot %${rule.thresholds.method}`
      )
    );
    dd.append(el('br'));
    dd.append(text('mono dim', `${rule.buildCommand}   —   ${rule.sourceFile}`));
    list.append(dt, dd);
  }
  card.append(list);
  return card;
}

function problemsCard(view: CoverageView): HTMLElement {
  const card = box('card');
  card.append(box('card-head', box('grow', el('h2', {}, [icon('warning'), document.createTextNode('Okunamayan Raporlar')]))));
  const list = el('ul', { class: 'issue-list' });
  for (const problem of view.problems) {
    const li = el('li', { class: 'warn' });
    li.textContent = problem.message;
    list.append(li);
  }
  card.append(list);
  return card;
}

window.addEventListener('message', (event: MessageEvent<CoverageToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'showCoverage':
      current = msg.view;
      filter = '';
      render();
      break;
    case 'busy':
      busy.set(msg.busy, msg.message);
      break;
    case 'gapOutcome':
      busy.set(false);
      if (msg.status === 'applied') {
        status.set('ok', msg.detail ?? 'Test dosyası yazıldı.');
      } else if (msg.status === 'rejected') {
        status.set('info', 'Öneri reddedildi; dosyaya hiçbir şey yazılmadı.');
      } else {
        status.set('danger', msg.detail ?? 'Test üretilemedi.');
      }
      break;
  }
});

render();
vscode.postMessage({ type: 'ready' });

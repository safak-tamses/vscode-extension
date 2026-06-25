import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigStore } from './config';
import type { CodeHealthSettings, SettingsStore } from './config';
import { VscodeSecretVault } from './audit/secrets';
import { AuditLogger, FsFileAppender } from './audit/audit';
import type { OutputSink } from './audit/audit';
import { SonarClient } from './sonar/client';
import { FetchHttpClient } from './sonar/http';
import { componentToPath } from './sonar/types';
import type { SonarIssue, SonarRule } from './sonar/types';
import { groupFindings } from './ui/grouping';
import { FindingsTreeProvider } from './ui/tree';
import { ConfigPanel } from './ui/configPanel';
import { DetailPanel } from './ui/detailPanel';
import { buildFindingView } from './ui/findingView';
import { htmlToText } from './ui/sanitize';
import { buildFixContext } from './fix/context';
import type { FixContext } from './fix/context';
import { FixOrchestrator, CopilotUnavailableError } from './fix/orchestrator';
import { VscodeLmGateway } from './fix/lmGateway';
import { PreviewContentProvider, previewAndDecide } from './fix/diff';

/** VS Code workspace configuration tabanlı ayar deposu. */
class VscodeSettingsStore implements SettingsStore {
  read(): CodeHealthSettings {
    const c = vscode.workspace.getConfiguration('codeHealth');
    return {
      sonarUrl: c.get<string>('sonarUrl', ''),
      projectKey: c.get<string>('projectKey', ''),
      branch: c.get<string>('branch', ''),
      authScheme: c.get<'bearer' | 'basic'>('authScheme', 'bearer'),
      auditLogPath: c.get<string>('auditLogPath', ''),
      snippetPadding: c.get<number>('snippetPadding', 8),
      copilotVendor: c.get<string>('copilotVendor', 'copilot'),
      maxIssues: c.get<number>('maxIssues', 500)
    };
  }

  async write(partial: Partial<CodeHealthSettings>): Promise<void> {
    const c = vscode.workspace.getConfiguration('codeHealth');
    const target = vscode.workspace.workspaceFolders
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    for (const [key, value] of Object.entries(partial)) {
      await c.update(key, value, target);
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const store = new ConfigStore(new VscodeSettingsStore(), new VscodeSecretVault(context.secrets));
  const http = new FetchHttpClient();
  const tree = new FindingsTreeProvider();
  const previewProvider = new PreviewContentProvider();

  const settings = store.getSettings();
  const channel = vscode.window.createOutputChannel('Kod Sağlığı Audit');
  const outputSink: OutputSink = { line: (text) => channel.appendLine(text) };
  const audit = new AuditLogger(
    new FsFileAppender(resolveAuditPath(settings)),
    outputSink,
    safeActor()
  );
  const lm = new VscodeLmGateway(settings.copilotVendor);
  const orchestrator = new FixOrchestrator(lm, audit);

  let currentIssues: SonarIssue[] = [];

  const makeClient = (): SonarClient => new SonarClient(http, () => store.getToken(), store.getSonarConfig());

  context.subscriptions.push(
    channel,
    vscode.window.registerTreeDataProvider('codeHealthFindings', tree),
    vscode.workspace.registerTextDocumentContentProvider(PreviewContentProvider.scheme, previewProvider)
  );

  void store.isComplete().then((complete) => tree.setConfigured(complete));

  const openConfig = (): void => {
    ConfigPanel.show({
      store,
      extensionUri: context.extensionUri,
      onSaved: () => {
        void store.isComplete().then((complete) => {
          tree.setConfigured(complete);
          if (complete) {
            void refresh();
          }
        });
      }
    });
  };

  const refresh = async (): Promise<void> => {
    if (!(await store.isComplete())) {
      tree.setConfigured(false);
      const pick = await vscode.window.showWarningMessage(
        'Önce SonarQube bağlantısını yapılandırın (URL, Project Key, Token).',
        'Yapılandır'
      );
      if (pick === 'Yapılandır') {
        openConfig();
      }
      return;
    }
    try {
      const issues = await makeClient().searchAllIssues(store.getSettings().maxIssues, 500);
      currentIssues = issues;
      tree.setFindings(groupFindings(issues));
      void vscode.window.showInformationMessage(`Kod Sağlığı: ${issues.length} bulgu yüklendi.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage('Kod Sağlığı tarama hatası: ' + msg);
    }
  };

  const assembleContext = async (issue: SonarIssue): Promise<FixContext | undefined> => {
    const uri = await resolveFileUri(componentToPath(issue.component));
    if (!uri) {
      return undefined;
    }
    let ruleDescription = '';
    try {
      const rule = await makeClient().showRule(issue.rule);
      ruleDescription = htmlToText(rule.htmlDesc ?? rule.mdDesc ?? '');
    } catch {
      // Açıklama alınamazsa istem yine de oluşturulur.
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    return buildFixContext(issue, ruleDescription, doc.getText(), store.getSettings().snippetPadding);
  };

  const runFix = async (issue: SonarIssue): Promise<void> => {
    DetailPanel.postBusy(true);
    try {
      const ctx = await assembleContext(issue);
      if (!ctx) {
        DetailPanel.postBusy(false);
        DetailPanel.postOutcome('error', 'İlgili dosya workspace içinde bulunamadı.');
        return;
      }
      let proposal;
      try {
        proposal = await orchestrator.propose(issue, ctx);
      } catch (err) {
        if (err instanceof CopilotUnavailableError) {
          await audit.record({ type: 'error', ruleKey: issue.rule, issueKey: issue.key, detail: 'copilot-unavailable' });
          DetailPanel.postBusy(false);
          DetailPanel.postOutcome('error', 'Copilot kullanılamıyor. Bulguyu görüntüleyip manuel çözebilirsiniz.');
          return;
        }
        throw err;
      }
      DetailPanel.postBusy(false);
      const outcome = await previewAndDecide(proposal, {
        resolveUri: resolveFileUri,
        provider: previewProvider,
        onAccept: () =>
          audit.record({ type: 'accept', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath }),
        onReject: () =>
          audit.record({ type: 'reject', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath })
      });
      if (outcome === 'applied') {
        DetailPanel.postOutcome('applied');
      } else if (outcome === 'rejected') {
        DetailPanel.postOutcome('rejected');
      } else if (outcome === 'noop') {
        DetailPanel.postOutcome('error', 'Uygulanabilir bir öneri üretilmedi.');
      } else {
        DetailPanel.postOutcome('error', 'Değişiklik uygulanamadı.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await audit.record({ type: 'error', issueKey: issue.key, detail: msg });
      DetailPanel.postBusy(false);
      DetailPanel.postOutcome('error', msg);
    }
  };

  const runFixAll = async (): Promise<void> => {
    if (currentIssues.length === 0) {
      void vscode.window.showInformationMessage('Çözülecek bulgu yok. Önce tarayın.');
      return;
    }
    if (!(await lm.isAvailable())) {
      void vscode.window.showWarningMessage('Copilot kullanılamıyor; toplu çözüm yapılamaz. Bulgular görüntülenebilir.');
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `${currentIssues.length} bulgu tek tek diff onayına gelecek (sessiz toplu uygulama YOK). Devam edilsin mi?`,
      { modal: true },
      'Devam'
    );
    if (confirm !== 'Devam') {
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Kod Sağlığı: Tümünü Çöz', cancellable: true },
      async (progress, token) => {
        const issues = [...currentIssues];
        for (let i = 0; i < issues.length; i++) {
          const issue = issues[i];
          if (token.isCancellationRequested || !issue) {
            break;
          }
          progress.report({ message: `${i + 1}/${issues.length} — ${issue.rule}`, increment: 100 / issues.length });
          try {
            const ctx = await assembleContext(issue);
            if (!ctx) {
              continue;
            }
            const proposal = await orchestrator.propose(issue, ctx);
            await previewAndDecide(proposal, {
              resolveUri: resolveFileUri,
              provider: previewProvider,
              onAccept: () =>
                audit.record({ type: 'accept', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath }),
              onReject: () =>
                audit.record({ type: 'reject', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath })
            });
          } catch (err) {
            if (err instanceof CopilotUnavailableError) {
              void vscode.window.showWarningMessage('Copilot erişimi kesildi; toplu çözüm durduruldu.');
              break;
            }
            await audit.record({
              type: 'error',
              issueKey: issue.key,
              detail: err instanceof Error ? err.message : String(err)
            });
          }
        }
      }
    );
  };

  const showFinding = async (issue: SonarIssue): Promise<void> => {
    await revealIssueLocation(issue);
    let rule: SonarRule | undefined;
    try {
      rule = await makeClient().showRule(issue.rule);
    } catch {
      // Açıklama alınamazsa bulgu yine gösterilir.
    }
    const copilotAvailable = await lm.isAvailable();
    const view = buildFindingView(issue, rule, copilotAvailable);
    DetailPanel.show(
      {
        extensionUri: context.extensionUri,
        onFix: () => void runFix(issue),
        onFixAll: () => void runFixAll(),
        onOpenLocation: () => void revealIssueLocation(issue)
      },
      view
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('code-health.configure', openConfig),
    vscode.commands.registerCommand('code-health.refresh', () => void refresh()),
    vscode.commands.registerCommand('code-health.openFinding', (issue: SonarIssue) => {
      if (isSonarIssue(issue)) {
        void showFinding(issue);
      }
    }),
    vscode.commands.registerCommand('code-health.fix', (node: unknown) => {
      const issue = extractIssue(node);
      if (issue) {
        void (async () => {
          await showFinding(issue);
          await runFix(issue);
        })();
      }
    }),
    vscode.commands.registerCommand('code-health.clearToken', async () => {
      await store.clearToken();
      tree.setConfigured(await store.isComplete());
      void vscode.window.showInformationMessage('Kod Sağlığı: kayıtlı token silindi.');
    })
  );
}

export function deactivate(): void {
  // Temizlik context.subscriptions üzerinden yapılır.
}

function safeActor(): string {
  try {
    return os.userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveAuditPath(settings: CodeHealthSettings): string {
  if (settings.auditLogPath) {
    return settings.auditLogPath;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  const base = folder ? folder.uri.fsPath : os.tmpdir();
  return path.join(base, '.code-health', 'audit.log');
}

function isSonarIssue(value: unknown): value is SonarIssue {
  return Boolean(value && typeof value === 'object' && 'key' in value && 'rule' in value);
}

function extractIssue(node: unknown): SonarIssue | undefined {
  if (node && typeof node === 'object' && 'issue' in node) {
    const issue = (node as { issue: unknown }).issue;
    if (isSonarIssue(issue)) {
      return issue;
    }
  }
  return undefined;
}

async function resolveFileUri(relPath: string): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const uri = vscode.Uri.joinPath(folder.uri, relPath);
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      // bir sonraki klasörde dene
    }
  }
  return undefined;
}

async function revealIssueLocation(issue: SonarIssue): Promise<void> {
  const rel = componentToPath(issue.component);
  const uri = await resolveFileUri(rel);
  if (!uri) {
    void vscode.window.showWarningMessage(`Dosya workspace içinde bulunamadı: ${rel}`);
    return;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.One
    });
    const line = Math.max(0, (issue.textRange?.startLine ?? issue.line ?? 1) - 1);
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  } catch {
    void vscode.window.showWarningMessage(`Dosya açılamadı: ${rel}`);
  }
}

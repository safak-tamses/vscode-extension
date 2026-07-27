import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigStore } from './config';
import type { CodeHealthSettings, SettingsStore } from './config';
import { FetchHttpClient } from './http';
import { VscodeSecretVault } from './audit/secrets';
import { AuditLogger, FsFileAppender } from './audit/audit';
import type { OutputSink } from './audit/audit';
import { SonarClient } from './sonar/client';
import { componentToPath } from './sonar/types';
import type { SonarIssue, SonarRule } from './sonar/types';
import { CopilotGateway } from './llm/copilotGateway';
import { createLlmGateway } from './llm/factory';
import { LlmUnavailableError } from './llm/gateway';
import type { CancelSignal, LlmGateway } from './llm/gateway';
import { groupFindings } from './ui/grouping';
import { FindingsTreeProvider } from './ui/tree';
import { ConfigPanel } from './ui/configPanel';
import { DetailPanel } from './ui/detailPanel';
import { buildFindingView } from './ui/findingView';
import type { ProviderStatus } from './ui/messages';
import { htmlToText } from './ui/sanitize';
import { buildFixContext } from './fix/context';
import type { FixContext } from './fix/context';
import { FixOrchestrator } from './fix/orchestrator';
import { PreviewContentProvider, previewAndDecide } from './fix/diff';

/** Ayar alanı -> VS Code configuration anahtarı eşlemesi (derleyici eksiksizliği zorunlu kılar). */
const SETTING_KEYS: { [K in keyof CodeHealthSettings]: string } = {
  sonarUrl: 'sonarUrl',
  projectKey: 'projectKey',
  branch: 'branch',
  authScheme: 'authScheme',
  maxIssues: 'maxIssues',
  auditLogPath: 'auditLogPath',
  snippetPadding: 'snippetPadding',
  rulesDir: 'rulesDir',
  llmProvider: 'llm.provider',
  copilotVendor: 'llm.copilotVendor',
  copilotFamily: 'llm.copilotFamily',
  localProtocol: 'llm.local.protocol',
  localBaseUrl: 'llm.local.baseUrl',
  localModel: 'llm.local.model',
  localTemperature: 'llm.local.temperature',
  localMaxOutputTokens: 'llm.local.maxOutputTokens',
  localTimeoutSec: 'llm.local.timeoutSec',
  localExtraHeaders: 'llm.local.extraHeaders',
  testGenMaxRepairAttempts: 'testGen.maxRepairAttempts',
  testGenMaxContextChars: 'testGen.maxContextChars'
};

/** VS Code workspace configuration tabanlı ayar deposu. */
class VscodeSettingsStore implements SettingsStore {
  read(): CodeHealthSettings {
    const c = vscode.workspace.getConfiguration('codeHealth');
    // 0.1.x'te ayar "codeHealth.copilotVendor" idi; geriye dönük okunur.
    const legacyVendor = c.get<string>('copilotVendor', '');
    return {
      sonarUrl: c.get<string>(SETTING_KEYS.sonarUrl, ''),
      projectKey: c.get<string>(SETTING_KEYS.projectKey, ''),
      branch: c.get<string>(SETTING_KEYS.branch, ''),
      authScheme: c.get<'bearer' | 'basic'>(SETTING_KEYS.authScheme, 'bearer'),
      maxIssues: c.get<number>(SETTING_KEYS.maxIssues, 500),
      auditLogPath: c.get<string>(SETTING_KEYS.auditLogPath, ''),
      snippetPadding: c.get<number>(SETTING_KEYS.snippetPadding, 8),
      rulesDir: c.get<string>(SETTING_KEYS.rulesDir, '.code-health/rules'),
      llmProvider: c.get<'copilot' | 'local'>(SETTING_KEYS.llmProvider, 'copilot'),
      copilotVendor: c.get<string>(SETTING_KEYS.copilotVendor, '') || legacyVendor || 'copilot',
      copilotFamily: c.get<string>(SETTING_KEYS.copilotFamily, ''),
      localProtocol: c.get<'openai' | 'ollama'>(SETTING_KEYS.localProtocol, 'openai'),
      localBaseUrl: c.get<string>(SETTING_KEYS.localBaseUrl, ''),
      localModel: c.get<string>(SETTING_KEYS.localModel, ''),
      localTemperature: c.get<number>(SETTING_KEYS.localTemperature, 0.1),
      localMaxOutputTokens: c.get<number>(SETTING_KEYS.localMaxOutputTokens, 4096),
      localTimeoutSec: c.get<number>(SETTING_KEYS.localTimeoutSec, 120),
      localExtraHeaders: sanitizeHeaders(c.get<unknown>(SETTING_KEYS.localExtraHeaders, {})),
      testGenMaxRepairAttempts: c.get<number>(SETTING_KEYS.testGenMaxRepairAttempts, 1),
      testGenMaxContextChars: c.get<number>(SETTING_KEYS.testGenMaxContextChars, 60000)
    };
  }

  async write(partial: Partial<CodeHealthSettings>): Promise<void> {
    const c = vscode.workspace.getConfiguration('codeHealth');
    const target = vscode.workspace.workspaceFolders
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    for (const [field, value] of Object.entries(partial)) {
      const key = SETTING_KEYS[field as keyof CodeHealthSettings];
      if (key) {
        await c.update(key, value, target);
      }
    }
  }
}

/** Ayar dosyasından gelen serbest nesneyi string->string başlık haritasına indirger. */
function sanitizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') {
        out[key] = value;
      }
    }
  }
  return out;
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

  // Sağlayıcı ayarları değiştiğinde gateway yeniden kurulur; aksi halde önbellek korunur.
  let gatewayCache: { key: string; gateway: LlmGateway } | undefined;
  const llm = (): LlmGateway => {
    const llmSettings = store.getLlmSettings();
    const key = JSON.stringify(llmSettings);
    if (!gatewayCache || gatewayCache.key !== key) {
      gatewayCache = {
        key,
        gateway: createLlmGateway(llmSettings, {
          http,
          getApiKey: () => store.getLocalApiKey(),
          createCopilotGateway: (cfg) => new CopilotGateway(cfg)
        })
      };
    }
    return gatewayCache.gateway;
  };

  const providerStatus = async (): Promise<ProviderStatus> => {
    const gateway = llm();
    return {
      id: gateway.id,
      label: gateway.label,
      available: await gateway.isAvailable(),
      hint: gateway.unavailableHint()
    };
  };

  let currentIssues: SonarIssue[] = [];

  const makeClient = (): SonarClient => new SonarClient(http, () => store.getToken(), store.getSonarConfig());

  context.subscriptions.push(
    channel,
    vscode.window.registerTreeDataProvider('codeHealthFindings', tree),
    vscode.workspace.registerTextDocumentContentProvider(PreviewContentProvider.scheme, previewProvider)
  );

  void store.isSonarComplete().then((complete) => tree.setConfigured(complete));

  const openConfig = (): void => {
    ConfigPanel.show({
      store,
      extensionUri: context.extensionUri,
      onSaved: () => {
        void store.isSonarComplete().then((complete) => {
          tree.setConfigured(complete);
          if (complete) {
            void refresh();
          }
        });
      }
    });
  };

  const refresh = async (): Promise<void> => {
    if (!(await store.isSonarComplete())) {
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

  const rescanAfterFix = async (issue: SonarIssue): Promise<void> => {
    await audit.record({
      type: 'rescan',
      ruleKey: issue.rule,
      issueKey: issue.key,
      file: componentToPath(issue.component)
    });
    let stillOpen = true;
    try {
      const found = await makeClient().findIssue(issue.key);
      stillOpen = Boolean(found && found.status !== 'CLOSED' && found.status !== 'RESOLVED');
    } catch {
      // Doğrulama sorgusu başarısızsa iyimser davran; yerel değişiklik uygulandı.
    }
    currentIssues = currentIssues.filter((i) => i.key !== issue.key);
    tree.setFindings(groupFindings(currentIssues));
    void vscode.window.showInformationMessage(
      stillOpen
        ? 'Fix uygulandı ve listeden çıkarıldı. SonarQube tarafında kesin kapanış, sunucuda yeni analiz sonrası görünür.'
        : 'Fix uygulandı; SonarQube bulguyu kapanmış olarak raporladı.'
    );
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
      const orchestrator = new FixOrchestrator(llm(), audit);
      let proposal;
      try {
        proposal = await orchestrator.propose(issue, ctx);
      } catch (err) {
        if (err instanceof LlmUnavailableError) {
          await audit.record({
            type: 'error',
            ruleKey: issue.rule,
            issueKey: issue.key,
            provider: llm().id,
            detail: 'llm-unavailable'
          });
          DetailPanel.postBusy(false);
          DetailPanel.postOutcome('error', err.message);
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
        await rescanAfterFix(issue);
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
    const gateway = llm();
    if (!(await gateway.isAvailable())) {
      void vscode.window.showWarningMessage(
        `${gateway.label} kullanılamıyor; toplu çözüm yapılamaz. ${gateway.unavailableHint()}`
      );
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
        const orchestrator = new FixOrchestrator(gateway, audit);
        const signal = toCancelSignal(token);
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
            const proposal = await orchestrator.propose(issue, ctx, signal);
            const outcome = await previewAndDecide(proposal, {
              resolveUri: resolveFileUri,
              provider: previewProvider,
              onAccept: () =>
                audit.record({ type: 'accept', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath }),
              onReject: () =>
                audit.record({ type: 'reject', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath })
            });
            if (outcome === 'applied') {
              await rescanAfterFix(issue);
            }
          } catch (err) {
            if (err instanceof LlmUnavailableError) {
              void vscode.window.showWarningMessage(
                `${gateway.label} erişimi kesildi; toplu çözüm durduruldu.`
              );
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
    const view = buildFindingView(issue, rule, await providerStatus());
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
    vscode.commands.registerCommand('code-health.fixAll', () => void runFixAll()),
    vscode.commands.registerCommand('code-health.clearToken', async () => {
      await store.clearToken();
      tree.setConfigured(await store.isSonarComplete());
      void vscode.window.showInformationMessage('Kod Sağlığı: kayıtlı SonarQube token’ı silindi.');
    }),
    vscode.commands.registerCommand('code-health.clearLlmKey', async () => {
      await store.clearLocalApiKey();
      gatewayCache = undefined;
      void vscode.window.showInformationMessage('Kod Sağlığı: kayıtlı local LLM API anahtarı silindi.');
    })
  );
}

export function deactivate(): void {
  // Temizlik context.subscriptions üzerinden yapılır.
}

/** vscode iptal jetonunu llm katmanının vscode'dan bağımsız portuna uyarlar. */
function toCancelSignal(token: vscode.CancellationToken): CancelSignal {
  return {
    get isCancellationRequested(): boolean {
      return token.isCancellationRequested;
    },
    onCancellationRequested(listener: () => void): { dispose(): void } {
      return token.onCancellationRequested(() => listener());
    }
  };
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

import * as vscode from 'vscode';
import { ConfigStore } from './config';
import type { CodeHealthSettings, SettingsStore } from './config';
import { VscodeSecretVault } from './audit/secrets';
import { SonarClient } from './sonar/client';
import { FetchHttpClient } from './sonar/http';
import { componentToPath } from './sonar/types';
import type { SonarIssue, SonarRule } from './sonar/types';
import { groupFindings } from './ui/grouping';
import { FindingsTreeProvider } from './ui/tree';
import { ConfigPanel } from './ui/configPanel';
import { DetailPanel } from './ui/detailPanel';
import { buildFindingView } from './ui/findingView';

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

  let currentIssues: SonarIssue[] = [];

  const makeClient = (): SonarClient => new SonarClient(http, () => store.getToken(), store.getSonarConfig());

  context.subscriptions.push(vscode.window.registerTreeDataProvider('codeHealthFindings', tree));

  // Açılışta config-gating durumunu uygula.
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
      const settings = store.getSettings();
      const issues = await makeClient().searchAllIssues(settings.maxIssues, 500);
      currentIssues = issues;
      tree.setFindings(groupFindings(issues));
      void vscode.window.showInformationMessage(`Kod Sağlığı: ${issues.length} bulgu yüklendi.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage('Kod Sağlığı tarama hatası: ' + msg);
    }
  };

  const openFinding = async (issue: SonarIssue): Promise<void> => {
    await revealIssueLocation(issue);
    let rule: SonarRule | undefined;
    try {
      rule = await makeClient().showRule(issue.rule);
    } catch {
      // Açıklama alınamazsa bulgu yine gösterilir.
    }
    const view = buildFindingView(issue, rule, /* copilotAvailable */ false);
    DetailPanel.show(
      {
        extensionUri: context.extensionUri,
        onFix: () =>
          void vscode.window.showInformationMessage(
            'Çözüm motoru (Copilot) bir sonraki adımda (M3) etkinleşecek.'
          ),
        onFixAll: () =>
          void vscode.window.showInformationMessage('Toplu çözüm bir sonraki adımda (M3) etkinleşecek.'),
        onOpenLocation: () => void revealIssueLocation(issue)
      },
      view
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('code-health.configure', openConfig),
    vscode.commands.registerCommand('code-health.refresh', () => void refresh()),
    vscode.commands.registerCommand('code-health.openFinding', (issue: SonarIssue) => {
      if (issue && typeof issue === 'object' && 'key' in issue) {
        void openFinding(issue);
      }
    }),
    vscode.commands.registerCommand('code-health.fix', (node: unknown) => {
      const issue = extractIssue(node);
      if (issue) {
        void openFinding(issue);
      }
    }),
    vscode.commands.registerCommand('code-health.clearToken', async () => {
      await store.clearToken();
      tree.setConfigured(await store.isComplete());
      void vscode.window.showInformationMessage('Kod Sağlığı: kayıtlı token silindi.');
    })
  );

  // currentIssues, M3'te "Tümünü Çöz" akışında kullanılacak.
  void currentIssues;
}

export function deactivate(): void {
  // Tek elden temizlik context.subscriptions üzerinden yapılır.
}

function extractIssue(node: unknown): SonarIssue | undefined {
  if (node && typeof node === 'object' && 'issue' in node) {
    const issue = (node as { issue: unknown }).issue;
    if (issue && typeof issue === 'object' && 'key' in issue) {
      return issue as SonarIssue;
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

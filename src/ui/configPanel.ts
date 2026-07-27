import * as vscode from 'vscode';
import { getNonce, getWebviewHtml } from './html';
import type { ConfigStore } from '../config';
import type { ConfigFormState, ConfigFromWebview, ConfigToWebview } from './messages';
import { SonarClient } from '../sonar/client';
import { FetchHttpClient } from '../http';

export interface ConfigPanelDeps {
  store: ConfigStore;
  extensionUri: vscode.Uri;
  onSaved: () => void;
}

/** SonarQube bağlantı bilgilerini girip kaydetmek için webview ekranı (tekil). */
export class ConfigPanel {
  private static current: ConfigPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;

  static show(deps: ConfigPanelDeps): void {
    if (ConfigPanel.current) {
      ConfigPanel.current.deps = deps;
      ConfigPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'codeHealthConfig',
      'Kod Sağlığı: Bağlantı',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'dist', 'webview')]
      }
    );
    ConfigPanel.current = new ConfigPanel(panel, deps);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private deps: ConfigPanelDeps) {
    this.panel.webview.html = this.render();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: ConfigFromWebview) => void this.onMessage(msg),
      null,
      this.disposables
    );
  }

  private render(): string {
    const w = this.panel.webview;
    const nonce = getNonce();
    const scriptUri = w
      .asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview', 'config.js'))
      .toString();
    const styleUri = w
      .asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview', 'styles.css'))
      .toString();
    return getWebviewHtml({
      nonce,
      cspSource: w.cspSource,
      scriptUri,
      styleUri,
      title: 'Kod Sağlığı: Bağlantı'
    });
  }

  private post(msg: ConfigToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: ConfigFromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        await this.postInit();
        break;
      case 'test': {
        this.post({ type: 'busy', busy: true });
        const result = await this.testConnection(msg.form, msg.token);
        this.post({ type: 'busy', busy: false });
        this.post({ type: 'testResult', ok: result.ok, detail: result.detail });
        break;
      }
      case 'save':
        await this.save(msg.form, msg.token);
        break;
    }
  }

  private async postInit(): Promise<void> {
    if (!this.ready) {
      return;
    }
    const s = this.deps.store.getSettings();
    const form: ConfigFormState = {
      sonarUrl: s.sonarUrl,
      projectKey: s.projectKey,
      branch: s.branch,
      authScheme: s.authScheme
    };
    const hasToken = Boolean(await this.deps.store.getToken());
    this.post({ type: 'init', form, hasToken });
  }

  private async testConnection(
    form: ConfigFormState,
    token: string
  ): Promise<{ ok: boolean; detail?: string }> {
    try {
      if (!form.sonarUrl || !form.projectKey) {
        return { ok: false, detail: 'URL ve Project Key zorunludur.' };
      }
      const effectiveToken = token || (await this.deps.store.getToken());
      if (!effectiveToken) {
        return { ok: false, detail: 'Token girilmedi.' };
      }
      const client = new SonarClient(new FetchHttpClient(), async () => effectiveToken, {
        baseUrl: form.sonarUrl,
        projectKey: form.projectKey,
        branch: form.branch || undefined,
        authScheme: form.authScheme
      });
      return await client.validateConnection();
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async save(form: ConfigFormState, token: string): Promise<void> {
    this.post({ type: 'busy', busy: true });
    await this.deps.store.saveSettings({
      sonarUrl: form.sonarUrl,
      projectKey: form.projectKey,
      branch: form.branch,
      authScheme: form.authScheme
    });
    if (token) {
      await this.deps.store.setToken(token);
    }
    this.post({ type: 'busy', busy: false });
    this.post({ type: 'saved' });
    this.deps.onSaved();
    void vscode.window.showInformationMessage('Kod Sağlığı: bağlantı bilgileri kaydedildi.');
  }

  private dispose(): void {
    ConfigPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

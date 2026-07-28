import * as vscode from 'vscode';
import { getNonce, getWebviewHtml } from './html';
import type { CoverageFromWebview, CoverageToWebview, CoverageView } from './messages';

export interface CoveragePanelDeps {
  extensionUri: vscode.Uri;
  onScan: (build: boolean) => void;
  onGenerate: (id: string) => void;
  onOpenSource: (id: string) => void;
  onOpenTest: (id: string) => void;
  onConfigure: () => void;
  onCreateSampleRules: () => void;
}

/** Test kapsamı özeti ve eksik test listesi (tekil webview). */
export class CoveragePanel {
  private static current: CoveragePanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private lastView: CoverageView | undefined;

  static show(deps: CoveragePanelDeps, view?: CoverageView): void {
    if (!CoveragePanel.current) {
      const panel = vscode.window.createWebviewPanel(
        'codeHealthCoverage',
        'Kod Sağlığı: Test Kapsamı',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'dist', 'webview')]
        }
      );
      CoveragePanel.current = new CoveragePanel(panel, deps);
    } else {
      CoveragePanel.current.deps = deps;
      CoveragePanel.current.panel.reveal(vscode.ViewColumn.Active);
    }
    if (view) {
      CoveragePanel.current.update(view);
    }
  }

  static get isOpen(): boolean {
    return CoveragePanel.current !== undefined;
  }

  static postView(view: CoverageView): void {
    CoveragePanel.current?.update(view);
  }

  static postBusy(busy: boolean, message?: string): void {
    CoveragePanel.current?.post({ type: 'busy', busy, ...(message ? { message } : {}) });
  }

  static postOutcome(id: string, status: 'applied' | 'rejected' | 'error', detail?: string): void {
    CoveragePanel.current?.post({ type: 'gapOutcome', id, status, ...(detail ? { detail } : {}) });
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private deps: CoveragePanelDeps
  ) {
    this.panel.webview.html = this.render();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: CoverageFromWebview) => this.onMessage(msg),
      null,
      this.disposables
    );
  }

  private update(view: CoverageView): void {
    this.lastView = view;
    if (this.ready) {
      this.post({ type: 'showCoverage', view });
    }
  }

  private onMessage(msg: CoverageFromWebview): void {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        if (this.lastView) {
          this.post({ type: 'showCoverage', view: this.lastView });
        }
        break;
      case 'scan':
        this.deps.onScan(msg.build);
        break;
      case 'generate':
        this.deps.onGenerate(msg.id);
        break;
      case 'openSource':
        this.deps.onOpenSource(msg.id);
        break;
      case 'openTest':
        this.deps.onOpenTest(msg.id);
        break;
      case 'configure':
        this.deps.onConfigure();
        break;
      case 'createSampleRules':
        this.deps.onCreateSampleRules();
        break;
    }
  }

  private render(): string {
    const w = this.panel.webview;
    const nonce = getNonce();
    return getWebviewHtml({
      nonce,
      cspSource: w.cspSource,
      scriptUri: w
        .asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview', 'coverage.js'))
        .toString(),
      styleUri: w
        .asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview', 'styles.css'))
        .toString(),
      title: 'Kod Sağlığı: Test Kapsamı'
    });
  }

  private post(msg: CoverageToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    CoveragePanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

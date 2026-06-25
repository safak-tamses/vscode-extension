import * as vscode from 'vscode';
import { getNonce, getWebviewHtml } from './html';
import type { DetailFromWebview, DetailToWebview, FindingView } from './messages';

export interface DetailPanelDeps {
  extensionUri: vscode.Uri;
  onFix: () => void;
  onFixAll: () => void;
  onOpenLocation: () => void;
}

/** Bulgu detay + açıklama webview'ı (tekil). M3 fix akışı busy/outcome ile beslenir. */
export class DetailPanel {
  private static current: DetailPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private lastView: FindingView | undefined;

  static show(deps: DetailPanelDeps, view: FindingView): void {
    if (!DetailPanel.current) {
      const panel = vscode.window.createWebviewPanel(
        'codeHealthDetail',
        'Kod Sağlığı: Bulgu',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'dist', 'webview')]
        }
      );
      DetailPanel.current = new DetailPanel(panel, deps);
    } else {
      DetailPanel.current.deps = deps;
      DetailPanel.current.panel.reveal(vscode.ViewColumn.Beside, false);
    }
    DetailPanel.current.update(view);
  }

  static postBusy(busy: boolean): void {
    DetailPanel.current?.post({ type: 'busy', busy });
  }

  static postOutcome(status: 'applied' | 'rejected' | 'error', detail?: string): void {
    DetailPanel.current?.post({ type: 'fixOutcome', status, detail });
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private deps: DetailPanelDeps) {
    this.panel.webview.html = this.render();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: DetailFromWebview) => this.onMessage(msg),
      null,
      this.disposables
    );
  }

  private update(view: FindingView): void {
    this.lastView = view;
    if (this.ready) {
      this.post({ type: 'showFinding', view });
    }
  }

  private onMessage(msg: DetailFromWebview): void {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        if (this.lastView) {
          this.post({ type: 'showFinding', view: this.lastView });
        }
        break;
      case 'fix':
        this.deps.onFix();
        break;
      case 'fixAll':
        this.deps.onFixAll();
        break;
      case 'openLocation':
        this.deps.onOpenLocation();
        break;
    }
  }

  private render(): string {
    const w = this.panel.webview;
    const nonce = getNonce();
    const scriptUri = w
      .asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview', 'detail.js'))
      .toString();
    const styleUri = w
      .asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview', 'styles.css'))
      .toString();
    return getWebviewHtml({
      nonce,
      cspSource: w.cspSource,
      scriptUri,
      styleUri,
      title: 'Kod Sağlığı: Bulgu'
    });
  }

  private post(msg: DetailToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    DetailPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

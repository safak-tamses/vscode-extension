import * as vscode from 'vscode';
import { spliceLines } from './apply';
import type { FixProposal } from './orchestrator';

/** Önerilen (henüz uygulanmamış) dosya içeriğini diff editörüne sunan salt-okunur sağlayıcı. */
export class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'code-health-preview';
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private counter = 0;

  set(filePath: string, content: string): vscode.Uri {
    this.counter += 1;
    const uri = vscode.Uri.from({
      scheme: PreviewContentProvider.scheme,
      path: '/' + filePath,
      query: `v=${this.counter}`
    });
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
}

export type FixOutcome = 'applied' | 'rejected' | 'noop' | 'error';

export interface PreviewDeps {
  resolveUri: (filePath: string) => Promise<vscode.Uri | undefined>;
  provider: PreviewContentProvider;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
}

/**
 * Öneriyi diff olarak gösterir ve kullanıcı kararını bekler. OTOMATIK UYGULAMA YOK:
 * yalnızca "Uygula" seçilirse WorkspaceEdit ile yazılır. Her iki karar da audit'e işlenir.
 */
export async function previewAndDecide(proposal: FixProposal, deps: PreviewDeps): Promise<FixOutcome> {
  if (!proposal.newCode.trim()) {
    void vscode.window.showInformationMessage(
      'Copilot uygulanabilir bir kod önerisi üretmedi; gerekçe detay panelinde gösteriliyor.'
    );
    return 'noop';
  }

  const uri = await deps.resolveUri(proposal.filePath);
  if (!uri) {
    void vscode.window.showWarningMessage(`Dosya workspace içinde bulunamadı: ${proposal.filePath}`);
    return 'error';
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const range = rangeFor(doc, proposal.startLine, proposal.endLine);
  const proposedFull = spliceLines(doc.getText(), proposal.startLine, proposal.endLine, proposal.newCode);
  const previewUri = deps.provider.set(proposal.filePath, proposedFull);

  await vscode.commands.executeCommand(
    'vscode.diff',
    uri,
    previewUri,
    `Kod Sağlığı: ${proposal.ruleKey}  (←mevcut | önerilen→)`,
    { preview: true } satisfies vscode.TextDocumentShowOptions
  );

  const choice = await vscode.window.showInformationMessage(
    'Önerilen değişikliği uygulamak istiyor musunuz?',
    { modal: true, detail: proposal.rationale },
    'Uygula',
    'Reddet'
  );

  if (choice === 'Uygula') {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, proposal.newCode);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      void vscode.window.showErrorMessage('Değişiklik uygulanamadı.');
      return 'error';
    }
    await deps.onAccept();
    return 'applied';
  }

  await deps.onReject();
  return 'rejected';
}

function rangeFor(doc: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  const start = new vscode.Position(Math.max(0, startLine - 1), 0);
  const endIndex = Math.min(Math.max(0, endLine - 1), doc.lineCount - 1);
  const end = doc.lineAt(endIndex).range.end;
  return new vscode.Range(start, end);
}

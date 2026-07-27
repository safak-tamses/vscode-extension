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

/** Tam dosya önerisi (üretilen birim test dosyası). */
export interface FileProposal {
  /** Workspace'e göreli hedef yol. */
  filePath: string;
  /** Dosyanın önerilen tam içeriği. */
  content: string;
  rationale: string;
  /** Diff editörünün başlığı. */
  title: string;
}

export interface FilePreviewDeps {
  /** Dosya varsa Uri'sini döndürür, yoksa undefined. */
  resolveUri: (relPath: string) => Promise<vscode.Uri | undefined>;
  /** Dosya yokken yazılacak hedef Uri'yi üretir. */
  targetUri: (relPath: string) => vscode.Uri | undefined;
  provider: PreviewContentProvider;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
}

/**
 * Tam bir dosyayı (yeni veya mevcut) diff olarak gösterir ve kullanıcı kararını bekler.
 * OTOMATIK YAZMA YOK: yalnızca "Uygula" seçilirse WorkspaceEdit ile yazılır.
 * Yeni dosya, boş bir sanal dokümana karşı diff'lenir; mevcut dosya tam içerikle karşılaştırılır.
 */
export async function previewFileAndDecide(
  proposal: FileProposal,
  deps: FilePreviewDeps
): Promise<FixOutcome> {
  if (!proposal.content.trim()) {
    void vscode.window.showInformationMessage('Model uygulanabilir bir dosya içeriği üretmedi.');
    return 'noop';
  }

  const existing = await deps.resolveUri(proposal.filePath);
  const left = existing ?? deps.provider.set(`${proposal.filePath} (henüz yok)`, '');
  const right = deps.provider.set(proposal.filePath, proposal.content);

  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    proposal.title,
    { preview: true } satisfies vscode.TextDocumentShowOptions
  );

  const choice = await vscode.window.showInformationMessage(
    existing
      ? 'Mevcut test dosyası bu şekilde güncellenecek. Uygulanacak mı?'
      : 'Bu test dosyası oluşturulacak. Uygulanacak mı?',
    { modal: true, detail: proposal.rationale },
    'Uygula',
    'Reddet'
  );

  if (choice !== 'Uygula') {
    await deps.onReject();
    return 'rejected';
  }

  const target = existing ?? deps.targetUri(proposal.filePath);
  if (!target) {
    void vscode.window.showErrorMessage(`Hedef yol çözümlenemedi: ${proposal.filePath}`);
    return 'error';
  }

  const edit = new vscode.WorkspaceEdit();
  if (existing) {
    const doc = await vscode.workspace.openTextDocument(existing);
    const full = new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end);
    edit.replace(existing, full, proposal.content);
  } else {
    edit.createFile(target, {
      overwrite: false,
      ignoreIfExists: false,
      contents: new TextEncoder().encode(proposal.content)
    });
  }

  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage('Test dosyası yazılamadı.');
    return 'error';
  }

  // Doğrulama derlemesi dosyayı diskten okuyacağı için değişiklik kaydedilir.
  const doc = await vscode.workspace.openTextDocument(target);
  if (doc.isDirty) {
    await doc.save();
  }
  await vscode.window.showTextDocument(doc, { preview: false });
  await deps.onAccept();
  return 'applied';
}

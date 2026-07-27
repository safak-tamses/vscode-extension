import * as vscode from 'vscode';
import type { RuleFileSystem } from './rulesLoader';

const SAMPLE_FILE = 'java-spring-unit-tests.md';

/** Kural dosyalarını workspace'ten okuyan gerçek implementasyon. */
export class WorkspaceRuleFileSystem implements RuleFileSystem {
  constructor(private readonly root: vscode.Uri) {}

  async listRuleFiles(dir: string): Promise<string[]> {
    const dirUri = toUri(this.root, dir);
    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      return entries
        .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.md'))
        .map(([name]) => joinRel(dir, name));
    } catch {
      // Kural dizini henüz oluşturulmamış olabilir; bu bir hata değildir.
      return [];
    }
  }

  async readFile(relPath: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(toUri(this.root, relPath));
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function toUri(root: vscode.Uri, relPath: string): vscode.Uri {
  return vscode.Uri.joinPath(root, ...relPath.split('/').filter((s) => s !== '' && s !== '.'));
}

function joinRel(dir: string, name: string): string {
  const base = dir.replace(/\/+$/, '');
  return base ? `${base}/${name}` : name;
}

/**
 * Eklentiyle gelen örnek kural setini workspace'e kopyalar.
 * Var olan bir dosyanın üzerine YAZMADAN ÖNCE onay ister ve sonucu editörde açar.
 */
export async function createSampleRuleSet(
  extensionUri: vscode.Uri,
  root: vscode.Uri,
  rulesDir: string
): Promise<vscode.Uri | undefined> {
  const target = toUri(root, joinRel(rulesDir, SAMPLE_FILE));

  let exists = false;
  try {
    await vscode.workspace.fs.stat(target);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) {
    const choice = await vscode.window.showWarningMessage(
      `${joinRel(rulesDir, SAMPLE_FILE)} zaten var. Üzerine yazılsın mı?`,
      { modal: true, detail: 'Dosyadaki kendi düzenlemeleriniz kaybolur.' },
      'Üzerine Yaz',
      'Mevcut Dosyayı Aç'
    );
    if (choice === 'Mevcut Dosyayı Aç') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
      return target;
    }
    if (choice !== 'Üzerine Yaz') {
      return undefined;
    }
  }

  const source = vscode.Uri.joinPath(extensionUri, 'resources', 'rules', SAMPLE_FILE);
  const bytes = await vscode.workspace.fs.readFile(source);
  await vscode.workspace.fs.writeFile(target, bytes);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
  return target;
}

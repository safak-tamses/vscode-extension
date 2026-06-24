import * as vscode from 'vscode';

// Katmanların gerçek vscode adaptörlerine bağlanması sonraki milestone'larda yapılır.
export function activate(_context: vscode.ExtensionContext): void {
  // M2+ : ConfigStore, SonarClient, TreeProvider, panel ve komut kayıtları burada bağlanır.
}

export function deactivate(): void {
  // dispose işlemleri context.subscriptions ile yönetilir.
}

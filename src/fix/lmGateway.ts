import * as vscode from 'vscode';
import type { LanguageModelGateway } from './orchestrator';

/**
 * GitHub Copilot'u Language Model API (`vscode.lm`) üzerinden kullanan gerçek gateway.
 * Copilot kurulu/erişilebilir değilse isAvailable() false döner (graceful degradation).
 */
export class VscodeLmGateway implements LanguageModelGateway {
  constructor(private readonly vendor: string) {}

  async isAvailable(): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: this.vendor });
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async sendFix(prompt: string): Promise<{ raw: string }> {
    const models = await vscode.lm.selectChatModels({ vendor: this.vendor });
    const model = models[0];
    if (!model) {
      throw new Error('Uygun Copilot modeli bulunamadı. GitHub Copilot kurulu ve oturum açık mı?');
    }
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const response = await model.sendRequest(messages, {}, tokenSource.token);
      let raw = '';
      for await (const chunk of response.text) {
        raw += chunk;
      }
      return { raw };
    } finally {
      tokenSource.dispose();
    }
  }
}

import * as vscode from 'vscode';
import { LlmUnavailableError } from './gateway';
import type { CancelSignal, ChatRequest, ChatResponse, LlmGateway, LlmProbeResult } from './gateway';

export interface CopilotConfig {
  /** vscode.lm sağlayıcı adı (vars. "copilot"). */
  vendor: string;
  /** Model ailesi filtresi (ör. "gpt-4o"); boşsa ilk uygun model kullanılır. */
  family: string;
}

const COPILOT_HINT =
  'GitHub Copilot ve Copilot Chat eklentileri kurulu, oturum açık ve etkin mi? ' +
  'Kurulum ekranından "Local LLM" sağlayıcısına da geçebilirsiniz.';

/**
 * GitHub Copilot'u Language Model API (`vscode.lm`) üzerinden kullanan gateway.
 * Copilot kurulu/erişilebilir değilse isAvailable() false döner (graceful degradation).
 */
export class CopilotGateway implements LlmGateway {
  readonly id = 'copilot' as const;
  readonly label = 'GitHub Copilot';

  constructor(private readonly cfg: CopilotConfig) {}

  unavailableHint(): string {
    return COPILOT_HINT;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await this.selectModels()).length > 0;
    } catch {
      return false;
    }
  }

  async complete(req: ChatRequest, cancel?: CancelSignal): Promise<ChatResponse> {
    const models = await this.selectModels();
    const model = models[0];
    if (!model) {
      throw new LlmUnavailableError(this.label, COPILOT_HINT);
    }
    const messages = [
      ...(req.system ? [vscode.LanguageModelChatMessage.User(req.system)] : []),
      vscode.LanguageModelChatMessage.User(req.prompt)
    ];
    const source = new vscode.CancellationTokenSource();
    const sub = cancel?.onCancellationRequested(() => source.cancel());
    try {
      const response = await model.sendRequest(messages, {}, source.token);
      let raw = '';
      for await (const chunk of response.text) {
        raw += chunk;
      }
      return { raw };
    } catch (err) {
      throw new Error(describeCopilotError(err));
    } finally {
      sub?.dispose();
      source.dispose();
    }
  }

  async probe(): Promise<LlmProbeResult> {
    let models: readonly vscode.LanguageModelChat[];
    try {
      models = await this.selectModels();
    } catch (err) {
      return { ok: false, detail: describeCopilotError(err) };
    }
    const model = models[0];
    if (!model) {
      return {
        ok: false,
        detail:
          `"${this.cfg.vendor}" sağlayıcısı için uygun model bulunamadı` +
          (this.cfg.family ? ` (aile filtresi: "${this.cfg.family}")` : '') +
          `. ${COPILOT_HINT}`
      };
    }
    try {
      const res = await this.complete({ prompt: 'Sadece "hazir" yaz.', maxOutputTokens: 16 });
      const preview = res.raw.trim().slice(0, 40).replace(/\s+/g, ' ');
      return {
        ok: true,
        detail: `Bağlantı başarılı · ${model.vendor}/${model.family} · yanıt: "${preview}"`
      };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private selectModels(): Thenable<readonly vscode.LanguageModelChat[]> {
    const selector: vscode.LanguageModelChatSelector = { vendor: this.cfg.vendor };
    if (this.cfg.family.trim()) {
      selector.family = this.cfg.family.trim();
    }
    return vscode.lm.selectChatModels(selector);
  }
}

/** Copilot/Language Model API hatalarını eyleme dönük Türkçe mesaja çevirir. */
export function describeCopilotError(err: unknown): string {
  if (err instanceof vscode.LanguageModelError) {
    switch (err.code) {
      case 'NoPermissions':
        return `Copilot için izin verilmedi. VS Code'un eklentiye Language Model erişimi isteğini onaylayın. Detay: ${err.message}`;
      case 'Blocked':
        return `İstek Copilot içerik filtresi tarafından engellendi. Bulguyu manuel çözebilir veya Local LLM sağlayıcısına geçebilirsiniz. Detay: ${err.message}`;
      case 'NotFound':
        return `Copilot modeli bulunamadı. ${COPILOT_HINT}`;
      default:
        return `Copilot hatası (${err.code}): ${err.message}`;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/quota|rate limit|429/i.test(message)) {
    return `Copilot kotası/hız sınırı aşıldı. Kısa süre sonra tekrar deneyin. Detay: ${message}`;
  }
  return `Copilot isteği başarısız: ${message}`;
}

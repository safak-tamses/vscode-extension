/** Desteklenen model sağlayıcıları. */
export type LlmProviderId = 'copilot' | 'local';

/** Local LLM sunucusunun konuştuğu protokol. */
export type LocalProtocol = 'openai' | 'ollama';

export interface ChatRequest {
  /** Modelin rolünü belirleyen sistem mesajı (opsiyonel). */
  system?: string;
  /** Kullanıcı istemi. */
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  /** Modelin ham metin yanıtı; ayrıştırma çağıran katmana aittir. */
  raw: string;
}

/**
 * İptal sinyali portu. `vscode.CancellationToken` extension.ts'te bu şekle uyarlanır;
 * böylece llm katmanı vscode'a bağımlı olmadan iptal edilebilir kalır.
 */
export interface CancelSignal {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/** "Bağlantıyı test et" sonucu — kullanıcıya gösterilecek okunur bir açıklama içerir. */
export interface LlmProbeResult {
  ok: boolean;
  detail: string;
}

/** Model sağlayıcı portu. Copilot ve local LLM aynı sözleşmeyi uygular. */
export interface LlmGateway {
  readonly id: LlmProviderId;
  /** Kullanıcıya gösterilen ad, ör. "GitHub Copilot" veya "Local LLM · qwen2.5-coder". */
  readonly label: string;
  /** Hızlı erişilebilirlik kontrolü; hata fırlatmaz. */
  isAvailable(): Promise<boolean>;
  /** Tam bir tamamlama isteği; hata durumunda anlamlı bir Error fırlatır. */
  complete(req: ChatRequest, cancel?: CancelSignal): Promise<ChatResponse>;
  /** Ayrıntılı bağlantı testi (config ekranındaki "Test Et" düğmesi). */
  probe(): Promise<LlmProbeResult>;
  /** Erişilemediğinde kullanıcıya gösterilecek, sağlayıcıya özel yönlendirme. */
  unavailableHint(): string;
}

/** Erişilemeyen bir sağlayıcı için standart hatayı üretir. */
export function unavailable(gateway: LlmGateway): LlmUnavailableError {
  return new LlmUnavailableError(gateway.label, gateway.unavailableHint());
}

/** Sağlayıcıya hiç erişilemediğinde fırlatılır; çağıran katman bunu graceful degradation'a çevirir. */
export class LlmUnavailableError extends Error {
  constructor(
    readonly providerLabel: string,
    readonly hint: string
  ) {
    super(`${providerLabel} kullanılamıyor. ${hint}`);
    this.name = 'LlmUnavailableError';
  }
}

/** Sağlayıcı yapılandırması eksik/geçersiz olduğunda fırlatılır. */
export class LlmConfigError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = []
  ) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

import { LlmConfigError } from './gateway';
import type {
  CancelSignal,
  ChatRequest,
  ChatResponse,
  LlmGateway,
  LlmProbeResult,
  LocalProtocol
} from './gateway';
import type { PostClient } from './http';

export interface LocalLlmConfig {
  protocol: LocalProtocol;
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutSec: number;
  /** Kurumsal ağ geçitleri için ek başlıklar. Gizli değer KOYULMAMALIDIR (ayar dosyasına yazılır). */
  extraHeaders: Record<string, string>;
}

export type ApiKeyProvider = () => Promise<string | undefined>;

/** Local LLM çağrısının kullanıcıya gösterilebilir hatası. */
export class LocalLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalLlmError';
  }
}

/** Eksik zorunlu alanların insan okur adlarını döndürür (boşsa yapılandırma tamdır). */
export function validateLocalConfig(cfg: LocalLlmConfig): string[] {
  const missing: string[] = [];
  if (!cfg.baseUrl.trim()) {
    missing.push('Sunucu adresi (baseUrl)');
  } else if (!/^https?:\/\/[^/\s]+/i.test(cfg.baseUrl.trim())) {
    missing.push('Sunucu adresi http:// veya https:// ile başlamalı');
  }
  if (!cfg.model.trim()) {
    missing.push('Model adı');
  }
  return missing;
}

/**
 * Kullanıcının girdiği adresi kanonik tabana çevirir.
 * - Sondaki `/` ve yapıştırılmış endpoint ekleri (`/chat/completions`, `/api/chat`) temizlenir.
 * - OpenAI uyumlu protokolde yalnızca host verilmişse `/v1` eklenir.
 */
export function normalizeBaseUrl(raw: string, protocol: LocalProtocol): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (protocol === 'openai') {
    url = url.replace(/\/(?:chat\/completions|completions)$/i, '').replace(/\/+$/, '');
    const parts = /^(https?:\/\/[^/]+)(\/.*)?$/i.exec(url);
    if (parts && parts[1] && !parts[2]) {
      url = parts[1] + '/v1';
    }
  } else {
    url = url.replace(/\/api\/(?:chat|generate)$/i, '').replace(/\/+$/, '');
  }
  return url;
}

/** Protokole göre tamamlama ve model listeleme uç noktalarını üretir. */
export function endpointsFor(baseUrl: string, protocol: LocalProtocol): { chat: string; models: string } {
  const base = normalizeBaseUrl(baseUrl, protocol);
  return protocol === 'openai'
    ? { chat: `${base}/chat/completions`, models: `${base}/models` }
    : { chat: `${base}/api/chat`, models: `${base}/api/tags` };
}

/** İstek gövdesini protokole göre kurar (saf fonksiyon). */
export function buildRequestBody(cfg: LocalLlmConfig, req: ChatRequest): string {
  const messages = [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    { role: 'user', content: req.prompt }
  ];
  const temperature = req.temperature ?? cfg.temperature;
  const maxTokens = req.maxOutputTokens ?? cfg.maxOutputTokens;

  if (cfg.protocol === 'openai') {
    return JSON.stringify({
      model: cfg.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    });
  }
  return JSON.stringify({
    model: cfg.model,
    messages,
    stream: false,
    options: { temperature, num_predict: maxTokens }
  });
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string }; text?: string; finish_reason?: string }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  response?: string;
  done_reason?: string;
}

/** Yanıt gövdesinden üretilen metni çıkarır; şema beklenmedikse anlamlı hata verir (saf fonksiyon). */
export function extractContent(protocol: LocalProtocol, body: string): string {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new LocalLlmError(
      'Model sunucusunun yanıtı JSON olarak çözümlenemedi. Adres bir LLM API uç noktasına işaret ediyor mu?'
    );
  }
  if (protocol === 'openai') {
    const parsed = json as OpenAiChatResponse;
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content ?? choice?.text;
    if (typeof content !== 'string') {
      throw new LocalLlmError(
        'Model sunucusu beklenen alanı döndürmedi (choices[0].message.content). ' +
          'Protokol ayarı (OpenAI uyumlu / Ollama) doğru mu?'
      );
    }
    return content;
  }
  const parsed = json as OllamaChatResponse;
  const content = parsed.message?.content ?? parsed.response;
  if (typeof content !== 'string') {
    throw new LocalLlmError(
      'Model sunucusu beklenen alanı döndürmedi (message.content). ' +
        'Protokol ayarı (OpenAI uyumlu / Ollama) doğru mu?'
    );
  }
  return content;
}

/** Sunucunun hata gövdesinden okunur bir mesaj çıkarmayı dener. */
function serverMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: unknown; message?: unknown };
    const err = json.error;
    if (typeof err === 'string') {
      return err;
    }
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    if (typeof json.message === 'string') {
      return json.message;
    }
  } catch {
    /* JSON değilse ham gövdeye düş */
  }
  const trimmed = body.trim();
  return trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed;
}

/** HTTP durum kodunu eyleme dönük bir mesaja çevirir. */
export function describeHttpError(status: number, body: string, model: string): string {
  const detail = serverMessage(body);
  const suffix = detail ? ` Sunucu mesajı: ${detail}` : '';
  switch (true) {
    case status === 401 || status === 403:
      return `Model sunucusu isteği reddetti (HTTP ${status}). API anahtarı gerekli veya geçersiz olabilir; kurulum ekranından anahtarı kontrol edin.${suffix}`;
    case status === 404:
      return `Uç nokta bulunamadı (HTTP 404). Sunucu adresini ve protokol seçimini (OpenAI uyumlu / Ollama) kontrol edin; "${model}" modeli sunucuda yüklü olmayabilir.${suffix}`;
    case status === 400 || status === 422:
      return `Model sunucusu isteği kabul etmedi (HTTP ${status}). Genellikle model adı hatalıdır: "${model}".${suffix}`;
    case status === 413:
      return `İstem sunucu için çok uzun (HTTP 413). "codeHealth.testGen.maxContextChars" ayarını düşürün.${suffix}`;
    case status === 429:
      return `Model sunucusu hız sınırına takıldı (HTTP 429). Kısa süre sonra tekrar deneyin.${suffix}`;
    case status >= 500:
      return `Model sunucusunda hata (HTTP ${status}). Sunucu günlüklerini kontrol edin.${suffix}`;
    default:
      return `Model sunucusu beklenmeyen yanıt verdi (HTTP ${status}).${suffix}`;
  }
}

/** Ağ/taşıma katmanı hatasını eyleme dönük bir mesaja çevirir. */
export function describeTransportError(err: unknown, baseUrl: string, timeoutSec: number): string {
  const cause = (err as { cause?: { code?: string; message?: string } } | undefined)?.cause;
  const code = cause?.code ?? (err as { code?: string } | undefined)?.code ?? '';
  const name = (err as { name?: string } | undefined)?.name ?? '';

  if (name === 'AbortError' || code === 'ABORT_ERR') {
    return `Model sunucusu ${timeoutSec} saniye içinde yanıt vermedi. Zaman aşımı ayarını artırabilir veya daha küçük bir istem deneyebilirsiniz.`;
  }
  switch (code) {
    case 'ECONNREFUSED':
      return `Model sunucusuna bağlanılamadı (${baseUrl}). Sunucu ayakta mı, port doğru mu?`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Model sunucusunun adresi çözümlenemedi (${baseUrl}). Adresi ve DNS/VPN erişimini kontrol edin.`;
    case 'ECONNRESET':
    case 'EPIPE':
      return `Model sunucusuyla bağlantı koptu (${baseUrl}). Ağ geçidi veya proxy araya girmiş olabilir.`;
    case 'ETIMEDOUT':
      return `Model sunucusuna bağlanırken zaman aşımı (${baseUrl}).`;
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'CERT_HAS_EXPIRED':
      return `Model sunucusunun TLS sertifikası doğrulanamadı (${code}). Kurumsal kök sertifikayı NODE_EXTRA_CA_CERTS ile tanıtın.`;
    default: {
      const msg = err instanceof Error ? err.message : String(err);
      return `Model sunucusuna erişilemedi (${baseUrl}): ${msg}`;
    }
  }
}

const AVAILABILITY_TTL_MS = 30_000;

/**
 * Şirket içi (self-hosted) LLM sunucusunu kullanan gateway. `vscode` bağımlılığı YOKTUR;
 * HTTP portu ve API anahtarı sağlayıcısı dışarıdan enjekte edilir. Anahtar yalnızca
 * Authorization başlığında kullanılır; loga/audit'e/ayar dosyasına asla yazılmaz.
 */
export class LocalLlmGateway implements LlmGateway {
  readonly id = 'local' as const;
  private cachedAvailable: { value: boolean; at: number } | undefined;

  constructor(
    private readonly cfg: LocalLlmConfig,
    private readonly http: PostClient,
    private readonly getApiKey: ApiKeyProvider,
    private readonly now: () => number = Date.now
  ) {}

  get label(): string {
    return this.cfg.model ? `Local LLM · ${this.cfg.model}` : 'Local LLM';
  }

  unavailableHint(): string {
    const missing = validateLocalConfig(this.cfg);
    if (missing.length > 0) {
      return `Yapılandırma eksik: ${missing.join(', ')}. Kurulum ekranından tamamlayın.`;
    }
    return `Sunucuya ulaşılamıyor (${this.cfg.baseUrl}). Adres/port, VPN erişimi ve sunucunun ayakta olduğunu kontrol edin.`;
  }

  async isAvailable(): Promise<boolean> {
    if (validateLocalConfig(this.cfg).length > 0) {
      return false;
    }
    const cached = this.cachedAvailable;
    if (cached && this.now() - cached.at < AVAILABILITY_TTL_MS) {
      return cached.value;
    }
    let value = false;
    try {
      const res = await this.request('GET', endpointsFor(this.cfg.baseUrl, this.cfg.protocol).models);
      // 404 = liste uç noktası yok ama sunucu ayakta; 401/403/5xx = kullanılamaz.
      value = res.status < 400 || res.status === 404;
    } catch {
      value = false;
    }
    this.cachedAvailable = { value, at: this.now() };
    return value;
  }

  async complete(req: ChatRequest, cancel?: CancelSignal): Promise<ChatResponse> {
    const missing = validateLocalConfig(this.cfg);
    if (missing.length > 0) {
      throw new LlmConfigError(
        'Local LLM yapılandırması eksik: ' + missing.join(', ') + '.',
        missing
      );
    }
    const { chat } = endpointsFor(this.cfg.baseUrl, this.cfg.protocol);
    const res = await this.request('POST', chat, buildRequestBody(this.cfg, req), cancel);
    if (res.status < 200 || res.status >= 300) {
      this.cachedAvailable = undefined;
      throw new LocalLlmError(describeHttpError(res.status, res.body, this.cfg.model));
    }
    return { raw: extractContent(this.cfg.protocol, res.body) };
  }

  async probe(): Promise<LlmProbeResult> {
    const missing = validateLocalConfig(this.cfg);
    if (missing.length > 0) {
      return { ok: false, detail: 'Eksik alan: ' + missing.join(', ') + '.' };
    }
    const { models } = endpointsFor(this.cfg.baseUrl, this.cfg.protocol);
    const notes: string[] = [];

    try {
      const list = await this.request('GET', models);
      if (list.status === 401 || list.status === 403) {
        return { ok: false, detail: describeHttpError(list.status, list.body, this.cfg.model) };
      }
      if (list.status >= 200 && list.status < 300) {
        const names = parseModelNames(this.cfg.protocol, list.body);
        if (names.length > 0 && !names.includes(this.cfg.model)) {
          notes.push(
            `Uyarı: "${this.cfg.model}" sunucunun model listesinde görünmüyor. Mevcut: ${names.slice(0, 5).join(', ')}` +
              (names.length > 5 ? ` (+${names.length - 5})` : '')
          );
        }
      } else if (list.status === 404) {
        notes.push('Not: sunucu model listeleme uç noktasını desteklemiyor (bu bir sorun değil).');
      }
    } catch (err) {
      return { ok: false, detail: describeTransportError(err, this.cfg.baseUrl, this.cfg.timeoutSec) };
    }

    const startedAt = this.now();
    try {
      const res = await this.complete({
        system: 'Yalnızca istenen kelimeyi yaz.',
        prompt: 'Sadece "hazir" yaz.',
        maxOutputTokens: 16,
        temperature: 0
      });
      const ms = this.now() - startedAt;
      const preview = res.raw.trim().slice(0, 40).replace(/\s+/g, ' ');
      return {
        ok: true,
        detail: [`Bağlantı başarılı · ${this.label} · ${ms} ms · yanıt: "${preview}"`, ...notes].join(' ')
      };
    } catch (err) {
      const detail =
        err instanceof LocalLlmError || err instanceof LlmConfigError
          ? err.message
          : describeTransportError(err, this.cfg.baseUrl, this.cfg.timeoutSec);
      return { ok: false, detail };
    }
  }

  /** Zaman aşımı + iptal + hata çevirisini tek yerde toplar. */
  private async request(
    method: 'GET' | 'POST',
    url: string,
    body?: string,
    cancel?: CancelSignal
  ): Promise<{ status: number; body: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, this.cfg.timeoutSec) * 1000);
    const sub = cancel?.onCancellationRequested(() => controller.abort());
    try {
      const headers = await this.buildHeaders(method === 'POST');
      return method === 'POST'
        ? await this.http.post(url, headers, body ?? '', controller.signal)
        : await this.http.get(url, headers, controller.signal);
    } catch (err) {
      if (cancel?.isCancellationRequested) {
        throw new LocalLlmError('İşlem iptal edildi.');
      }
      throw new LocalLlmError(describeTransportError(err, this.cfg.baseUrl, this.cfg.timeoutSec));
    } finally {
      clearTimeout(timer);
      sub?.dispose();
    }
  }

  private async buildHeaders(json: boolean): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (json) {
      headers['Content-Type'] = 'application/json';
    }
    for (const [key, value] of Object.entries(this.cfg.extraHeaders)) {
      if (key.trim() && typeof value === 'string') {
        headers[key.trim()] = value;
      }
    }
    const apiKey = await this.getApiKey();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
  }
}

interface OpenAiModelList {
  data?: Array<{ id?: string }>;
}

interface OllamaTagList {
  models?: Array<{ name?: string; model?: string }>;
}

/** Model listesi yanıtından model adlarını çıkarır (saf fonksiyon). */
export function parseModelNames(protocol: LocalProtocol, body: string): string[] {
  try {
    const json: unknown = JSON.parse(body);
    if (protocol === 'openai') {
      return ((json as OpenAiModelList).data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string');
    }
    return ((json as OllamaTagList).models ?? [])
      .map((m) => m.name ?? m.model)
      .filter((name): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}

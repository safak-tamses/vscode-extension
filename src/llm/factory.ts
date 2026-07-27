import { LocalLlmGateway, validateLocalConfig } from './localGateway';
import type { ApiKeyProvider, LocalLlmConfig } from './localGateway';
import type { LlmGateway, LlmProviderId } from './gateway';
import type { CopilotConfig } from './copilotGateway';
import type { PostClient } from './http';

/** Tüm sağlayıcıların birleşik yapılandırması (ConfigStore'dan gelir). */
export interface LlmSettings {
  provider: LlmProviderId;
  copilot: CopilotConfig;
  local: LocalLlmConfig;
}

export interface LlmGatewayDeps {
  http: PostClient;
  getApiKey: ApiKeyProvider;
  /** Copilot gateway'i `vscode` bağımlılığı taşıdığı için dışarıdan verilir (test edilebilirlik). */
  createCopilotGateway: (cfg: CopilotConfig) => LlmGateway;
}

/** Seçili sağlayıcıya göre gateway üretir. */
export function createLlmGateway(settings: LlmSettings, deps: LlmGatewayDeps): LlmGateway {
  if (settings.provider === 'local') {
    return new LocalLlmGateway(settings.local, deps.http, deps.getApiKey);
  }
  return deps.createCopilotGateway(settings.copilot);
}

export interface LlmSetupStatus {
  /** Yapılandırma tamam mı? (çalışma anındaki erişilebilirlikten bağımsız) */
  ready: boolean;
  /** Eksik alanların insan okur adları. */
  missing: string[];
  /** Kullanıcıya gösterilecek sağlayıcı adı. */
  label: string;
}

/**
 * Sağlayıcı yapılandırmasının tam olup olmadığını raporlar (config-gating).
 * Copilot için ek alan gerekmez; erişim ayrıca `isAvailable()` ile kontrol edilir.
 */
export function describeLlmSetup(settings: LlmSettings): LlmSetupStatus {
  if (settings.provider === 'local') {
    const missing = validateLocalConfig(settings.local);
    return {
      ready: missing.length === 0,
      missing,
      label: settings.local.model ? `Local LLM · ${settings.local.model}` : 'Local LLM'
    };
  }
  return { ready: true, missing: [], label: 'GitHub Copilot' };
}

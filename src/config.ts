import type { SecretReader } from './audit/secrets';
import { LOCAL_LLM_KEY, SONAR_TOKEN_KEY } from './audit/secrets';
import type { SonarConfig } from './sonar/client';
import { describeLlmSetup } from './llm/factory';
import type { LlmSettings, LlmSetupStatus } from './llm/factory';
import type { LlmProviderId, LocalProtocol } from './llm/gateway';

export interface CodeHealthSettings {
  // --- SonarQube ---
  sonarUrl: string;
  projectKey: string;
  branch: string;
  authScheme: 'bearer' | 'basic';
  maxIssues: number;
  /**
   * Sonar/JaCoCo yollarının göreli olduğu proje kökü. Mutlak yol ya da workspace köküne
   * göreli yol olabilir; boşsa workspace klasörleri kullanılır.
   */
  projectRoot: string;

  // --- Genel ---
  auditLogPath: string;
  snippetPadding: number;
  /** Test kural setlerinin arandığı, workspace'e göreli dizin. */
  rulesDir: string;
  /**
   * Maven kurulumunun yeri: Maven kökü, `bin` dizini ya da doğrudan çalıştırılabilir dosya.
   * Boşsa derleme komutu olduğu gibi çalışır ve `mvn` PATH üzerinden bulunur.
   */
  mavenPath: string;
  /**
   * Derlemede kullanılacak JDK kökü. Boşsa ortamın JAVA_HOME/PATH değerleri olduğu gibi
   * kullanılır; doluysa derleme süreci JAVA_HOME bu yola ayarlanmış olarak başlatılır.
   */
  javaHome: string;

  // --- Model sağlayıcı ---
  llmProvider: LlmProviderId;
  copilotVendor: string;
  copilotFamily: string;
  localProtocol: LocalProtocol;
  localBaseUrl: string;
  localModel: string;
  localTemperature: number;
  localMaxOutputTokens: number;
  localTimeoutSec: number;
  /** Kurumsal ağ geçidi başlıkları. Gizli değer içermemelidir (ayar dosyasına yazılır). */
  localExtraHeaders: Record<string, string>;

  // --- Test üretimi ---
  testGenMaxRepairAttempts: number;
  testGenMaxContextChars: number;
}

/** Gizli olmayan ayar portu (VS Code workspace configuration ile bağlanır). */
export interface SettingsStore {
  read(): CodeHealthSettings;
  write(partial: Partial<CodeHealthSettings>): Promise<void>;
}

/**
 * Ayarları (settings) ve gizli değerleri (SecretStorage) birlikte yöneten cephe.
 * Token/API anahtarı settings'e ASLA yazılmaz; yalnızca setToken/setLocalApiKey gibi
 * yöntemlerle SecretStorage'a gider.
 */
export class ConfigStore {
  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretReader
  ) {}

  getSettings(): CodeHealthSettings {
    return this.settings.read();
  }

  async saveSettings(partial: Partial<CodeHealthSettings>): Promise<void> {
    await this.settings.write(partial);
  }

  // --- SonarQube token'ı ---

  getToken(): Promise<string | undefined> {
    return this.secrets.get(SONAR_TOKEN_KEY);
  }

  async setToken(token: string): Promise<void> {
    await this.secrets.store(SONAR_TOKEN_KEY, token);
  }

  async clearToken(): Promise<void> {
    await this.secrets.delete(SONAR_TOKEN_KEY);
  }

  // --- Local LLM API anahtarı ---

  getLocalApiKey(): Promise<string | undefined> {
    return this.secrets.get(LOCAL_LLM_KEY);
  }

  async setLocalApiKey(key: string): Promise<void> {
    await this.secrets.store(LOCAL_LLM_KEY, key);
  }

  async clearLocalApiKey(): Promise<void> {
    await this.secrets.delete(LOCAL_LLM_KEY);
  }

  /** Tarama işlemleri için SonarQube alanları dolu mu? (config-gating) */
  async isSonarComplete(): Promise<boolean> {
    const s = this.settings.read();
    const token = await this.getToken();
    return Boolean(s.sonarUrl && s.projectKey && token);
  }

  /** Fix/test üretimi için model sağlayıcı yapılandırması tam mı? (config-gating) */
  isLlmComplete(): boolean {
    return this.describeLlm().ready;
  }

  describeLlm(): LlmSetupStatus {
    return describeLlmSetup(this.getLlmSettings());
  }

  getSonarConfig(): SonarConfig {
    const s = this.settings.read();
    return {
      baseUrl: s.sonarUrl,
      projectKey: s.projectKey,
      branch: s.branch || undefined,
      authScheme: s.authScheme
    };
  }

  getLlmSettings(): LlmSettings {
    const s = this.settings.read();
    return {
      provider: s.llmProvider,
      copilot: { vendor: s.copilotVendor, family: s.copilotFamily },
      local: {
        protocol: s.localProtocol,
        baseUrl: s.localBaseUrl,
        model: s.localModel,
        temperature: s.localTemperature,
        maxOutputTokens: s.localMaxOutputTokens,
        timeoutSec: s.localTimeoutSec,
        extraHeaders: s.localExtraHeaders
      }
    };
  }
}

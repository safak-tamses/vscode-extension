import type { SecretReader } from './audit/secrets';
import { SONAR_TOKEN_KEY } from './audit/secrets';
import type { SonarConfig } from './sonar/client';

export interface CodeHealthSettings {
  sonarUrl: string;
  projectKey: string;
  branch: string;
  authScheme: 'bearer' | 'basic';
  auditLogPath: string;
  snippetPadding: number;
  copilotVendor: string;
  maxIssues: number;
}

/** Gizli olmayan ayar portu (VS Code workspace configuration ile bağlanır). */
export interface SettingsStore {
  read(): CodeHealthSettings;
  write(partial: Partial<CodeHealthSettings>): Promise<void>;
}

/**
 * Ayarları (settings) ve token'ı (SecretStorage) birlikte yöneten cephe.
 * Token settings'e ASLA yazılmaz; yalnızca setToken/getToken ile SecretStorage'a gider.
 */
export class ConfigStore {
  constructor(private readonly settings: SettingsStore, private readonly secrets: SecretReader) {}

  getSettings(): CodeHealthSettings {
    return this.settings.read();
  }

  async saveSettings(partial: Partial<CodeHealthSettings>): Promise<void> {
    await this.settings.write(partial);
  }

  getToken(): Promise<string | undefined> {
    return this.secrets.get(SONAR_TOKEN_KEY);
  }

  async setToken(token: string): Promise<void> {
    await this.secrets.store(SONAR_TOKEN_KEY, token);
  }

  async clearToken(): Promise<void> {
    await this.secrets.delete(SONAR_TOKEN_KEY);
  }

  /** Tarama/çözüm işlemleri için zorunlu alanlar dolu mu? (config-gating) */
  async isComplete(): Promise<boolean> {
    const s = this.settings.read();
    const token = await this.getToken();
    return Boolean(s.sonarUrl && s.projectKey && token);
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
}

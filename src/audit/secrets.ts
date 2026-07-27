import type * as vscode from 'vscode';

/** SecretStorage anahtarı — SonarQube token'ı YALNIZCA burada tutulur. */
export const SONAR_TOKEN_KEY = 'codeHealth.sonarToken';

/** SecretStorage anahtarı — local LLM API anahtarı YALNIZCA burada tutulur. */
export const LOCAL_LLM_KEY = 'codeHealth.localLlmApiKey';

/** Gizli değer portu (test edilebilirlik için enjekte edilir). */
export interface SecretReader {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** VS Code SecretStorage tabanlı gerçek implementasyon. */
export class VscodeSecretVault implements SecretReader {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(key));
  }

  async store(key: string, value: string): Promise<void> {
    await this.secrets.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.secrets.delete(key);
  }
}

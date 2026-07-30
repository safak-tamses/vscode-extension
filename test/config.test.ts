import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigStore } from '../src/config';
import type { CodeHealthSettings, SettingsStore } from '../src/config';
import type { SecretReader } from '../src/audit/secrets';
import { LOCAL_LLM_KEY, SONAR_TOKEN_KEY } from '../src/audit/secrets';

function defaults(): CodeHealthSettings {
  return {
    sonarUrl: '',
    projectKey: '',
    branch: '',
    authScheme: 'bearer',
    maxIssues: 500,
    projectRoot: '',
    auditLogPath: '',
    snippetPadding: 8,
    rulesDir: '.code-health/rules',
    mavenPath: '',
    javaHome: '',
    llmProvider: 'copilot',
    copilotVendor: 'copilot',
    copilotFamily: '',
    localProtocol: 'openai',
    localBaseUrl: '',
    localModel: '',
    localTemperature: 0.1,
    localMaxOutputTokens: 4096,
    localTimeoutSec: 120,
    localExtraHeaders: {},
    testGenMaxRepairAttempts: 1,
    testGenMaxContextChars: 60000
  };
}

class FakeSettings implements SettingsStore {
  constructor(public values: CodeHealthSettings = defaults()) {}
  read(): CodeHealthSettings {
    return { ...this.values };
  }
  async write(partial: Partial<CodeHealthSettings>): Promise<void> {
    this.values = { ...this.values, ...partial };
  }
}

class FakeSecrets implements SecretReader {
  public map = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

test('isSonarComplete is false when token missing even if url+key set', async () => {
  const settings = new FakeSettings({ ...defaults(), sonarUrl: 'https://s.local', projectKey: 'p' });
  const store = new ConfigStore(settings, new FakeSecrets());

  assert.equal(await store.isSonarComplete(), false);
});

test('isSonarComplete is false when url or projectKey empty', async () => {
  const secrets = new FakeSecrets();
  await secrets.store(SONAR_TOKEN_KEY, 'T');
  const store = new ConfigStore(new FakeSettings({ ...defaults(), sonarUrl: 'https://s.local' }), secrets);

  assert.equal(await store.isSonarComplete(), false); // projectKey empty
});

test('isSonarComplete is true when url + projectKey + token present', async () => {
  const secrets = new FakeSecrets();
  await secrets.store(SONAR_TOKEN_KEY, 'T');
  const settings = new FakeSettings({ ...defaults(), sonarUrl: 'https://s.local', projectKey: 'p' });
  const store = new ConfigStore(settings, secrets);

  assert.equal(await store.isSonarComplete(), true);
});

test('saveSettings persists non-secret settings and never touches secrets', async () => {
  const secrets = new FakeSecrets();
  const settings = new FakeSettings();
  const store = new ConfigStore(settings, secrets);

  await store.saveSettings({ sonarUrl: 'https://s.local', projectKey: 'p', branch: 'main' });

  assert.equal(settings.values.sonarUrl, 'https://s.local');
  assert.equal(settings.values.projectKey, 'p');
  assert.equal(settings.values.branch, 'main');
  assert.equal(secrets.map.size, 0); // token settings ile yazılmaz
});

test('setToken/getToken/clearToken go through SecretStorage only', async () => {
  const secrets = new FakeSecrets();
  const store = new ConfigStore(new FakeSettings(), secrets);

  await store.setToken('SECRET');
  assert.equal(secrets.map.get(SONAR_TOKEN_KEY), 'SECRET');
  assert.equal(await store.getToken(), 'SECRET');

  await store.clearToken();
  assert.equal(await store.getToken(), undefined);
});

test('local LLM api key is stored under its own SecretStorage key only', async () => {
  const secrets = new FakeSecrets();
  const settings = new FakeSettings();
  const store = new ConfigStore(settings, secrets);

  await store.setLocalApiKey('LLM-KEY');

  assert.equal(secrets.map.get(LOCAL_LLM_KEY), 'LLM-KEY');
  assert.equal(await store.getLocalApiKey(), 'LLM-KEY');
  assert.equal(await store.getToken(), undefined); // sonar token'ı ile karışmaz
  // anahtar hiçbir ayara sızmaz
  assert.ok(!JSON.stringify(settings.values).includes('LLM-KEY'));

  await store.clearLocalApiKey();
  assert.equal(await store.getLocalApiKey(), undefined);
});

test('getSonarConfig maps settings to typed SonarConfig', async () => {
  const settings = new FakeSettings({
    ...defaults(),
    sonarUrl: 'https://s.local',
    projectKey: 'p',
    branch: 'dev',
    authScheme: 'basic'
  });
  const store = new ConfigStore(settings, new FakeSecrets());

  const cfg = store.getSonarConfig();

  assert.deepEqual(cfg, {
    baseUrl: 'https://s.local',
    projectKey: 'p',
    branch: 'dev',
    authScheme: 'basic'
  });
});

test('getLlmSettings maps flat settings into the provider shape', () => {
  const settings = new FakeSettings({
    ...defaults(),
    llmProvider: 'local',
    copilotVendor: 'copilot',
    copilotFamily: 'gpt-4o',
    localProtocol: 'ollama',
    localBaseUrl: 'http://localhost:11434',
    localModel: 'qwen2.5-coder:32b',
    localExtraHeaders: { 'X-Gateway': 'kurum' }
  });
  const store = new ConfigStore(settings, new FakeSecrets());

  const llm = store.getLlmSettings();

  assert.equal(llm.provider, 'local');
  assert.deepEqual(llm.copilot, { vendor: 'copilot', family: 'gpt-4o' });
  assert.equal(llm.local.protocol, 'ollama');
  assert.equal(llm.local.baseUrl, 'http://localhost:11434');
  assert.equal(llm.local.model, 'qwen2.5-coder:32b');
  assert.deepEqual(llm.local.extraHeaders, { 'X-Gateway': 'kurum' });
});

test('isLlmComplete gates on local fields but not on copilot', () => {
  const copilot = new ConfigStore(new FakeSettings(), new FakeSecrets());
  assert.equal(copilot.isLlmComplete(), true);

  const half = new ConfigStore(
    new FakeSettings({ ...defaults(), llmProvider: 'local', localBaseUrl: 'http://llm.local/v1' }),
    new FakeSecrets()
  );
  assert.equal(half.isLlmComplete(), false);
  assert.deepEqual(half.describeLlm().missing, ['Model adı']);

  const full = new ConfigStore(
    new FakeSettings({
      ...defaults(),
      llmProvider: 'local',
      localBaseUrl: 'http://llm.local/v1',
      localModel: 'qwen'
    }),
    new FakeSecrets()
  );
  assert.equal(full.isLlmComplete(), true);
  assert.equal(full.describeLlm().label, 'Local LLM · qwen');
});

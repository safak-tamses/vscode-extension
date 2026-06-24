import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigStore } from '../src/config';
import type { CodeHealthSettings, SettingsStore } from '../src/config';
import type { SecretReader } from '../src/audit/secrets';
import { SONAR_TOKEN_KEY } from '../src/audit/secrets';

function defaults(): CodeHealthSettings {
  return {
    sonarUrl: '',
    projectKey: '',
    branch: '',
    authScheme: 'bearer',
    auditLogPath: '',
    snippetPadding: 8,
    copilotVendor: 'copilot',
    maxIssues: 500
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

test('isComplete is false when token missing even if url+key set', async () => {
  const settings = new FakeSettings({ ...defaults(), sonarUrl: 'https://s.local', projectKey: 'p' });
  const store = new ConfigStore(settings, new FakeSecrets());

  assert.equal(await store.isComplete(), false);
});

test('isComplete is false when url or projectKey empty', async () => {
  const secrets = new FakeSecrets();
  await secrets.store(SONAR_TOKEN_KEY, 'T');
  const store = new ConfigStore(new FakeSettings({ ...defaults(), sonarUrl: 'https://s.local' }), secrets);

  assert.equal(await store.isComplete(), false); // projectKey empty
});

test('isComplete is true when url + projectKey + token present', async () => {
  const secrets = new FakeSecrets();
  await secrets.store(SONAR_TOKEN_KEY, 'T');
  const settings = new FakeSettings({ ...defaults(), sonarUrl: 'https://s.local', projectKey: 'p' });
  const store = new ConfigStore(settings, secrets);

  assert.equal(await store.isComplete(), true);
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

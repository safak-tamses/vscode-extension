import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmGateway, describeLlmSetup } from '../../src/llm/factory';
import type { LlmSettings } from '../../src/llm/factory';
import type { ChatResponse, LlmGateway, LlmProbeResult } from '../../src/llm/gateway';
import type { HttpResponse, PostClient } from '../../src/llm/http';

class FakeHttp implements PostClient {
  async get(): Promise<HttpResponse> {
    return { status: 200, body: '{}' };
  }
  async post(): Promise<HttpResponse> {
    return { status: 200, body: '{"choices":[{"message":{"content":"x"}}]}' };
  }
}

class StubCopilot implements LlmGateway {
  readonly id = 'copilot' as const;
  readonly label = 'GitHub Copilot';
  constructor(readonly vendor: string) {}
  unavailableHint(): string {
    return 'hint';
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async complete(): Promise<ChatResponse> {
    return { raw: '' };
  }
  async probe(): Promise<LlmProbeResult> {
    return { ok: true, detail: '' };
  }
}

function settings(over: Partial<LlmSettings> = {}): LlmSettings {
  return {
    provider: 'copilot',
    copilot: { vendor: 'copilot', family: '' },
    local: {
      protocol: 'openai',
      baseUrl: '',
      model: '',
      temperature: 0.1,
      maxOutputTokens: 4096,
      timeoutSec: 120,
      extraHeaders: {}
    },
    ...over
  };
}

const deps = {
  http: new FakeHttp(),
  getApiKey: async (): Promise<string | undefined> => undefined,
  createCopilotGateway: (cfg: { vendor: string; family: string }): LlmGateway => new StubCopilot(cfg.vendor)
};

test('createLlmGateway returns the Copilot gateway with the configured vendor', () => {
  const gateway = createLlmGateway(settings({ copilot: { vendor: 'kurum-copilot', family: 'gpt-4o' } }), deps);

  assert.equal(gateway.id, 'copilot');
  assert.equal((gateway as StubCopilot).vendor, 'kurum-copilot');
});

test('createLlmGateway returns the local gateway when provider is local', () => {
  const gateway = createLlmGateway(
    settings({
      provider: 'local',
      local: {
        protocol: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'qwen2.5-coder:32b',
        temperature: 0,
        maxOutputTokens: 1024,
        timeoutSec: 60,
        extraHeaders: {}
      }
    }),
    deps
  );

  assert.equal(gateway.id, 'local');
  assert.equal(gateway.label, 'Local LLM · qwen2.5-coder:32b');
});

test('describeLlmSetup treats Copilot as always configured', () => {
  assert.deepEqual(describeLlmSetup(settings()), {
    ready: true,
    missing: [],
    label: 'GitHub Copilot'
  });
});

test('describeLlmSetup lists what the local provider still needs', () => {
  const status = describeLlmSetup(settings({ provider: 'local' }));

  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ['Sunucu adresi (baseUrl)', 'Model adı']);
  assert.equal(status.label, 'Local LLM');
});

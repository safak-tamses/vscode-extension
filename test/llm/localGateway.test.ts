import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalLlmGateway,
  buildRequestBody,
  describeHttpError,
  describeTransportError,
  endpointsFor,
  extractContent,
  normalizeBaseUrl,
  parseModelNames,
  validateLocalConfig
} from '../../src/llm/localGateway';
import type { LocalLlmConfig } from '../../src/llm/localGateway';
import type { HttpResponse, PostClient } from '../../src/llm/http';
import { LlmConfigError } from '../../src/llm/gateway';

function cfg(over: Partial<LocalLlmConfig> = {}): LocalLlmConfig {
  return {
    protocol: 'openai',
    baseUrl: 'http://llm.kurum-ici.local:8000/v1',
    model: 'qwen2.5-coder',
    temperature: 0.1,
    maxOutputTokens: 2048,
    timeoutSec: 30,
    extraHeaders: {},
    ...over
  };
}

interface Call {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

type Responder = (method: 'GET' | 'POST', url: string) => HttpResponse | Promise<HttpResponse>;

class FakeHttp implements PostClient {
  readonly calls: Call[] = [];
  constructor(private readonly responder: Responder) {}
  async get(url: string, headers: Record<string, string>): Promise<HttpResponse> {
    this.calls.push({ method: 'GET', url, headers });
    return this.responder('GET', url);
  }
  async post(url: string, headers: Record<string, string>, body: string): Promise<HttpResponse> {
    this.calls.push({ method: 'POST', url, headers, body });
    return this.responder('POST', url);
  }
}

class ThrowingHttp implements PostClient {
  constructor(private readonly err: unknown) {}
  async get(): Promise<HttpResponse> {
    throw this.err;
  }
  async post(): Promise<HttpResponse> {
    throw this.err;
  }
}

// ---- saf yardımcılar ----

test('normalizeBaseUrl appends /v1 only when the OpenAI address has no path', () => {
  assert.equal(normalizeBaseUrl('http://llm.local:8000', 'openai'), 'http://llm.local:8000/v1');
  assert.equal(normalizeBaseUrl('http://llm.local:8000/', 'openai'), 'http://llm.local:8000/v1');
  assert.equal(normalizeBaseUrl('http://llm.local:8000/v1', 'openai'), 'http://llm.local:8000/v1');
  assert.equal(normalizeBaseUrl('http://gw.local/llm/v1/', 'openai'), 'http://gw.local/llm/v1');
});

test('normalizeBaseUrl strips a pasted endpoint suffix', () => {
  assert.equal(
    normalizeBaseUrl('http://llm.local:8000/v1/chat/completions', 'openai'),
    'http://llm.local:8000/v1'
  );
  assert.equal(normalizeBaseUrl('http://localhost:11434/api/chat', 'ollama'), 'http://localhost:11434');
  assert.equal(normalizeBaseUrl('http://localhost:11434/', 'ollama'), 'http://localhost:11434');
});

test('endpointsFor builds protocol specific endpoints', () => {
  assert.deepEqual(endpointsFor('http://llm.local:8000', 'openai'), {
    chat: 'http://llm.local:8000/v1/chat/completions',
    models: 'http://llm.local:8000/v1/models'
  });
  assert.deepEqual(endpointsFor('http://localhost:11434', 'ollama'), {
    chat: 'http://localhost:11434/api/chat',
    models: 'http://localhost:11434/api/tags'
  });
});

test('validateLocalConfig reports each missing field by name', () => {
  assert.deepEqual(validateLocalConfig(cfg()), []);
  assert.deepEqual(validateLocalConfig(cfg({ model: '  ' })), ['Model adı']);
  assert.deepEqual(validateLocalConfig(cfg({ baseUrl: '', model: '' })), [
    'Sunucu adresi (baseUrl)',
    'Model adı'
  ]);
  assert.deepEqual(validateLocalConfig(cfg({ baseUrl: 'llm.local:8000' })), [
    'Sunucu adresi http:// veya https:// ile başlamalı'
  ]);
});

test('buildRequestBody shapes the OpenAI payload with system + user messages', () => {
  const body = JSON.parse(buildRequestBody(cfg(), { system: 'SYS', prompt: 'USER' })) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    max_tokens: number;
    stream: boolean;
  };

  assert.equal(body.model, 'qwen2.5-coder');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'USER' }
  ]);
  assert.equal(body.temperature, 0.1);
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.stream, false);
});

test('buildRequestBody shapes the Ollama payload and honours per-request overrides', () => {
  const body = JSON.parse(
    buildRequestBody(cfg({ protocol: 'ollama' }), {
      prompt: 'USER',
      temperature: 0,
      maxOutputTokens: 16
    })
  ) as {
    messages: Array<{ role: string }>;
    stream: boolean;
    options: { temperature: number; num_predict: number };
  };

  assert.deepEqual(body.messages, [{ role: 'user', content: 'USER' }]);
  assert.equal(body.stream, false);
  assert.deepEqual(body.options, { temperature: 0, num_predict: 16 });
});

test('extractContent reads the content field of both protocols', () => {
  assert.equal(
    extractContent('openai', '{"choices":[{"message":{"content":"MERHABA"}}]}'),
    'MERHABA'
  );
  assert.equal(extractContent('openai', '{"choices":[{"text":"ESKI"}]}'), 'ESKI');
  assert.equal(extractContent('ollama', '{"message":{"content":"SELAM"}}'), 'SELAM');
});

test('extractContent explains a protocol mismatch instead of returning empty text', () => {
  assert.throws(
    () => extractContent('openai', '{"message":{"content":"SELAM"}}'),
    /Protokol ayarı/
  );
  assert.throws(() => extractContent('ollama', 'not json'), /JSON olarak çözümlenemedi/);
});

test('describeHttpError maps status codes to actionable Turkish messages', () => {
  assert.match(describeHttpError(401, '{}', 'm'), /API anahtarı/);
  assert.match(describeHttpError(404, '{}', 'qwen'), /protokol seçimini/);
  assert.match(describeHttpError(400, '{"error":{"message":"unknown model"}}', 'qwen'), /unknown model/);
  assert.match(describeHttpError(413, '{}', 'm'), /maxContextChars/);
  assert.match(describeHttpError(503, '{}', 'm'), /Model sunucusunda hata/);
});

test('describeTransportError explains connection, DNS, TLS and timeout failures', () => {
  const withCode = (code: string): unknown => Object.assign(new TypeError('fetch failed'), { cause: { code } });
  assert.match(describeTransportError(withCode('ECONNREFUSED'), 'http://x', 30), /bağlanılamadı/);
  assert.match(describeTransportError(withCode('ENOTFOUND'), 'http://x', 30), /çözümlenemedi/);
  assert.match(
    describeTransportError(withCode('SELF_SIGNED_CERT_IN_CHAIN'), 'http://x', 30),
    /NODE_EXTRA_CA_CERTS/
  );
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.match(describeTransportError(abort, 'http://x', 45), /45 saniye/);
});

test('parseModelNames reads both listing shapes and tolerates junk', () => {
  assert.deepEqual(parseModelNames('openai', '{"data":[{"id":"a"},{"id":"b"}]}'), ['a', 'b']);
  assert.deepEqual(parseModelNames('ollama', '{"models":[{"name":"qwen:32b"}]}'), ['qwen:32b']);
  assert.deepEqual(parseModelNames('openai', 'oops'), []);
});

// ---- gateway davranışı ----

test('complete posts to the chat endpoint with the API key in the Authorization header', async () => {
  const http = new FakeHttp(() => ({ status: 200, body: '{"choices":[{"message":{"content":"KOD"}}]}' }));
  const gateway = new LocalLlmGateway(cfg({ extraHeaders: { 'X-Gw': 'kurum' } }), http, async () => 'SECRET-KEY');

  const res = await gateway.complete({ prompt: 'P' });

  assert.equal(res.raw, 'KOD');
  const call = http.calls[0];
  assert.equal(call?.method, 'POST');
  assert.equal(call?.url, 'http://llm.kurum-ici.local:8000/v1/chat/completions');
  assert.equal(call?.headers['Authorization'], 'Bearer SECRET-KEY');
  assert.equal(call?.headers['Content-Type'], 'application/json');
  assert.equal(call?.headers['X-Gw'], 'kurum');
});

test('complete refuses to run and names the missing fields when config is incomplete', async () => {
  const http = new FakeHttp(() => ({ status: 200, body: '{}' }));
  const gateway = new LocalLlmGateway(cfg({ model: '' }), http, async () => undefined);

  await assert.rejects(
    () => gateway.complete({ prompt: 'P' }),
    (err: unknown) => err instanceof LlmConfigError && err.missing.includes('Model adı')
  );
  assert.equal(http.calls.length, 0);
});

test('complete surfaces an HTTP failure without leaking the API key', async () => {
  const http = new FakeHttp(() => ({ status: 401, body: '{"error":{"message":"bad key"}}' }));
  const gateway = new LocalLlmGateway(cfg(), http, async () => 'SUPER-SECRET');

  await assert.rejects(
    () => gateway.complete({ prompt: 'P' }),
    (err: unknown) => {
      const message = (err as Error).message;
      assert.match(message, /API anahtarı/);
      assert.ok(!message.includes('SUPER-SECRET'));
      return true;
    }
  );
});

test('complete translates a transport failure into an actionable message', async () => {
  const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const gateway = new LocalLlmGateway(cfg(), new ThrowingHttp(err), async () => undefined);

  await assert.rejects(() => gateway.complete({ prompt: 'P' }), /bağlanılamadı/);
});

test('isAvailable treats a missing model listing endpoint as reachable and caches the result', async () => {
  let hits = 0;
  const http = new FakeHttp(() => {
    hits += 1;
    return { status: 404, body: 'not found' };
  });
  let now = 1000;
  const gateway = new LocalLlmGateway(cfg(), http, async () => undefined, () => now);

  assert.equal(await gateway.isAvailable(), true);
  assert.equal(await gateway.isAvailable(), true);
  assert.equal(hits, 1, 'ikinci çağrı önbellekten gelmeli');

  now += 60_000;
  assert.equal(await gateway.isAvailable(), true);
  assert.equal(hits, 2, 'TTL dolunca yeniden sorulmalı');
});

test('isAvailable is false when config is incomplete or the server rejects auth', async () => {
  const unconfigured = new LocalLlmGateway(cfg({ baseUrl: '' }), new FakeHttp(() => ({ status: 200, body: '{}' })), async () => undefined);
  assert.equal(await unconfigured.isAvailable(), false);

  const unauthorized = new LocalLlmGateway(cfg(), new FakeHttp(() => ({ status: 403, body: '{}' })), async () => undefined);
  assert.equal(await unauthorized.isAvailable(), false);
});

test('probe reports success and warns when the configured model is not listed', async () => {
  const http = new FakeHttp((method) =>
    method === 'GET'
      ? { status: 200, body: '{"data":[{"id":"llama3"},{"id":"mistral"}]}' }
      : { status: 200, body: '{"choices":[{"message":{"content":"hazir"}}]}' }
  );
  const gateway = new LocalLlmGateway(cfg(), http, async () => undefined);

  const result = await gateway.probe();

  assert.equal(result.ok, true);
  assert.match(result.detail, /Bağlantı başarılı/);
  assert.match(result.detail, /model listesinde görünmüyor/);
  assert.match(result.detail, /llama3/);
});

test('probe fails fast with the missing field names', async () => {
  const gateway = new LocalLlmGateway(
    cfg({ baseUrl: '', model: '' }),
    new FakeHttp(() => ({ status: 200, body: '{}' })),
    async () => undefined
  );

  const result = await gateway.probe();

  assert.equal(result.ok, false);
  assert.match(result.detail, /Sunucu adresi/);
  assert.match(result.detail, /Model adı/);
});

test('unavailableHint distinguishes missing config from an unreachable server', () => {
  const noConfig = new LocalLlmGateway(cfg({ model: '' }), new FakeHttp(() => ({ status: 200, body: '{}' })), async () => undefined);
  assert.match(noConfig.unavailableHint(), /Yapılandırma eksik/);

  const configured = new LocalLlmGateway(cfg(), new FakeHttp(() => ({ status: 200, body: '{}' })), async () => undefined);
  assert.match(configured.unavailableHint(), /Sunucuya ulaşılamıyor/);
});

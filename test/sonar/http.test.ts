import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FetchHttpClient } from '../../src/sonar/http';

test('FetchHttpClient forwards headers and returns status + body text', async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { status: 200, text: async () => '{"valid":true}' };
  }) as unknown as typeof fetch;

  const http = new FetchHttpClient(fakeFetch);
  const res = await http.get('https://sonar.local/api/authentication/validate', { Authorization: 'Bearer T' });

  assert.equal(res.status, 200);
  assert.equal(res.body, '{"valid":true}');
  assert.equal(calls[0]?.url, 'https://sonar.local/api/authentication/validate');
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers['Authorization'], 'Bearer T');
});

test('FetchHttpClient surfaces non-2xx status without throwing', async () => {
  const fakeFetch = (async () => ({ status: 401, text: async () => '{"errors":[]}' })) as unknown as typeof fetch;
  const http = new FetchHttpClient(fakeFetch);

  const res = await http.get('https://sonar.local/x', {});

  assert.equal(res.status, 401);
  assert.equal(res.body, '{"errors":[]}');
});

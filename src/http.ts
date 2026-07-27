import type { HttpClient } from './sonar/client';
import type { HttpResponse, PostClient } from './llm/http';

/**
 * Global `fetch` tabanlı tek gerçek HTTP adaptörü; hem SonarQube istemcisinin (`HttpClient`)
 * hem de local LLM gateway'inin (`PostClient`) portunu uygular. `fetch` enjekte edilebilir (test).
 *
 * Not: Kurumsal proxy / self-signed sertifika gerekiyorsa burada bir agent tanımlanabilir;
 * kurumsal kök sertifika için `NODE_EXTRA_CA_CERTS` ortam değişkeni de kullanılabilir.
 */
export class FetchHttpClient implements HttpClient, PostClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async get(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<HttpResponse> {
    const res = await this.fetchFn(url, { method: 'GET', headers, signal });
    return { status: res.status, body: await res.text() };
  }

  async post(
    url: string,
    headers: Record<string, string>,
    body: string,
    signal?: AbortSignal
  ): Promise<HttpResponse> {
    const res = await this.fetchFn(url, { method: 'POST', headers, body, signal });
    return { status: res.status, body: await res.text() };
  }
}

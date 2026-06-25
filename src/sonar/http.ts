import type { HttpClient } from './client';

/**
 * Global `fetch` tabanlı HttpClient. fetch enjekte edilebilir (test için).
 * Not: Kurumsal proxy/self-signed sertifika gerekiyorsa burada bir agent eklenebilir.
 */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async get(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    const res = await this.fetchFn(url, { method: 'GET', headers });
    const body = await res.text();
    return { status: res.status, body };
  }
}

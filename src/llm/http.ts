export interface HttpResponse {
  status: number;
  body: string;
}

/**
 * GET + POST yapabilen HTTP portu (local LLM çağrıları için).
 * `src/sonar/http.ts:FetchHttpClient` bu portu da uygular; testlerde sahte istemci enjekte edilir.
 */
export interface PostClient {
  get(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<HttpResponse>;
  post(
    url: string,
    headers: Record<string, string>,
    body: string,
    signal?: AbortSignal
  ): Promise<HttpResponse>;
}

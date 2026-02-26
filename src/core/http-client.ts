/**
 * HTTP client port interface.
 *
 * Abstracts over the HTTP transport so that core modules (executor,
 * credential-tester) do not depend directly on the global `fetch`.
 * This enables:
 *   - Testing without network access
 *   - Swapping the HTTP runtime (e.g., for future streaming/WebSocket support)
 *   - Centralized timeout, retry, and observability concerns
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Minimal HTTP client interface.
 *
 * Matches the shape of the global `fetch` function so that the default
 * implementation is trivial: `const client: HttpClient = fetch`.
 */
export type HttpClient = (url: string, init: RequestInit) => Promise<HttpResponse>;

/**
 * Create the default HTTP client backed by the global `fetch`.
 */
export function createDefaultHttpClient(): HttpClient {
  return (url, init) => fetch(url, init);
}

/**
 * Credential testing service.
 *
 * Validates credentials by making a test API call using the credential
 * type's test.request config. Extracted from commands/auth/test.ts so
 * the logic is reusable and the command stays thin.
 */

import type { ResolvedCredentials } from "./plugin-interface.js";
import type { CredentialTypeInfo } from "./credential-introspector.js";
import { resolveCredentialExpr } from "./credential-introspector.js";
import { buildCredentialObject, injectCredentials, validateUrlForCredentials } from "./credential-injector.js";
import type { HttpClient } from "./http-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialTestResult {
  status: "ok" | "error" | "skipped";
  statusCode?: number;
  message: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Test credentials by making a validation API call.
 *
 * Uses the credential type's `test.request` config to determine the
 * endpoint, method, and any extra headers. Credentials are injected
 * via the unified `injectCredentials` function.
 *
 * @param cred          Resolved credentials to test.
 * @param credTypeInfo  Credential type definition (must include test.request).
 * @param options       Optional settings (e.g. timeout).
 * @returns             A CredentialTestResult describing the outcome.
 */
export async function testCredentials(
  cred: ResolvedCredentials,
  credTypeInfo: CredentialTypeInfo,
  options?: { timeout?: number; allowHttp?: boolean; httpClient?: HttpClient },
): Promise<CredentialTestResult> {
  const timeout = options?.timeout ?? 15_000;

  // --- 1. Check for test endpoint ---

  if (!credTypeInfo.test?.request) {
    return {
      status: "skipped",
      message: "No test endpoint defined",
    };
  }

  const testReq = credTypeInfo.test.request;

  // --- 2. Build credential object for expression resolution ---
  //   Merge default values from the credential type definition so that
  //   expression templates (e.g. "={{$credentials?.server}}") resolve
  //   correctly even when only a token was provided via env vars.

  const credObj = buildCredentialObject(cred);
  for (const prop of credTypeInfo.properties) {
    if (!(prop.name in credObj) && prop.default !== undefined && prop.default !== "") {
      credObj[prop.name] = prop.default;
    }
  }

  // --- 3. Build URL ---

  const baseUrl = resolveCredentialExpr(testReq.baseURL ?? "", credObj);
  const urlPath = resolveCredentialExpr(testReq.url ?? "", credObj);
  const method: string = testReq.method ?? "GET";

  let fullUrl = baseUrl ? `${baseUrl}${urlPath}` : urlPath;

  if (!fullUrl) {
    return {
      status: "error",
      message: "Cannot determine test URL from credential type definition",
    };
  }

  // --- 4. Inject credentials ---

  const injection = injectCredentials([cred], credTypeInfo.authenticate);
  const headers: Record<string, string> = { ...injection.headers };

  // Apply query params from credential injection
  if (injection.queryParams) {
    for (const [key, value] of Object.entries(injection.queryParams)) {
      const sep = fullUrl.includes("?") ? "&" : "?";
      fullUrl = `${fullUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
  }

  // --- 5. Apply extra headers from test.request config ---

  if (testReq.headers) {
    for (const [key, template] of Object.entries(testReq.headers)) {
      headers[key] = resolveCredentialExpr(template, credObj);
    }
  }

  // --- 6. Apply query params from test.request config ---

  if (testReq.qs) {
    for (const [key, template] of Object.entries(testReq.qs)) {
      const resolved = resolveCredentialExpr(String(template), credObj);
      const sep = fullUrl.includes("?") ? "&" : "?";
      fullUrl = `${fullUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(resolved)}`;
    }
  }

  // --- 7. Validate URL safety ---

  if (!options?.allowHttp) {
    const urlError = validateUrlForCredentials(fullUrl);
    if (urlError) {
      return { status: "error", message: urlError };
    }
  }

  // --- 8. Make the test request ---

  try {
    const doFetch = options?.httpClient ?? fetch;
    const response = await doFetch(fullUrl, {
      method,
      headers,
      signal: AbortSignal.timeout(timeout),
    });

    if (response.ok) {
      return {
        status: "ok",
        statusCode: response.status,
        message: "Credentials are valid",
      };
    }

    const body = await response.text().catch(() => "");
    return {
      status: "error",
      statusCode: response.status,
      message: `Authentication failed: HTTP ${response.status}`,
      details: body.slice(0, 500),
    };
  } catch (err) {
    return {
      status: "error",
      message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

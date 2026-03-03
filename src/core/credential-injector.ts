/**
 * Unified credential injection.
 *
 * Single source of truth for injecting credentials into HTTP requests.
 * Replaces three independent implementations in executor.ts,
 * execution-shim.ts, and auth/test.ts.
 */

import { resolveCredentialExpr } from './credential-introspector.js';
import type { ResolvedCredentials, CredentialAuthConfig } from './plugin-interface.js';

// Re-export for backward compatibility
export type { CredentialAuthConfig } from './plugin-interface.js';

/**
 * The result of credential injection — headers and optional query params
 * that should be applied to an outgoing HTTP request.
 */
export interface InjectionResult {
  headers: Record<string, string>;
  queryParams?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Security: header sanitization and URL safety
// ---------------------------------------------------------------------------

/** Strip CR/LF to prevent HTTP header injection. */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
];

/**
 * Check whether a URL is safe to send credentials to.
 * Rejects private IP ranges (RFC 1918), link-local, localhost, and non-HTTPS
 * unless explicitly allowed via NATHAN_ALLOW_HTTP=1.
 *
 * Returns null if safe, or an error message string if unsafe.
 */
export function validateUrlForCredentials(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

    // Block private/internal IPs
    if (hostname === 'localhost' || hostname === '::1') {
      return `Refusing to send credentials to localhost (${url}). Set NATHAN_ALLOW_HTTP=1 to override.`;
    }
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return `Refusing to send credentials to private IP (${hostname}). Set NATHAN_ALLOW_HTTP=1 to override.`;
      }
    }

    // Block non-HTTPS
    if (parsed.protocol !== 'https:') {
      return `Refusing to send credentials over insecure transport (${parsed.protocol}). Set NATHAN_ALLOW_HTTP=1 to override.`;
    }

    return null; // safe
  } catch {
    return `Invalid URL: ${url}`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a flat credential object from ResolvedCredentials.
 *
 * Maps the primarySecret to common aliases (accessToken, token, apiKey)
 * when those fields are not already present. This ensures credential
 * expression templates like `{{$credentials?.accessToken}}` resolve
 * correctly even when the user only stored a single token value.
 */
export function buildCredentialObject(cred: ResolvedCredentials): Record<string, unknown> {
  const obj: Record<string, unknown> = { ...cred.fields };

  if (cred.primarySecret) {
    if (!obj.accessToken) obj.accessToken = cred.primarySecret;
    if (!obj.token) obj.token = cred.primarySecret;
    if (!obj.apiKey) obj.apiKey = cred.primarySecret;
  }

  return obj;
}

/**
 * Low-level credential injection from a flat credential object.
 *
 * Low-level injection from a pre-built credential object, intended for
 * anti-corruption layers that already have a flat `Record<string, unknown>`
 * credential object and optionally an authenticate config.
 *
 * Logic:
 * 1. If an authenticate config with type "generic" is provided, apply its
 *    headers, query string, and basic auth directives (resolving credential
 *    expressions in templates).
 * 2. Otherwise, fall back to common credential field patterns:
 *    - apiKey → custom header (or Authorization)
 *    - accessToken → Bearer
 *    - token → Bearer
 *    - user + password → Basic
 */
export function applyCredentialAuth(
  credentialValues: Record<string, unknown>,
  authConfig?: CredentialAuthConfig | null,
): InjectionResult {
  const headers: Record<string, string> = {};
  let queryParams: Record<string, string> | undefined;

  // --- 1. Try explicit auth config ---

  if (
    authConfig &&
    (authConfig.headers || authConfig.queryParams || authConfig.body || authConfig.basicAuth)
  ) {
    // Apply headers
    if (authConfig.headers) {
      for (const [key, template] of Object.entries(authConfig.headers)) {
        headers[sanitizeHeaderValue(key)] = sanitizeHeaderValue(
          resolveCredentialExpr(template, credentialValues),
        );
      }
    }

    // Apply query params
    if (authConfig.queryParams) {
      queryParams = {};
      for (const [key, template] of Object.entries(authConfig.queryParams)) {
        queryParams[key] = resolveCredentialExpr(String(template), credentialValues);
      }
    }

    // Apply basic auth from config
    if (authConfig.basicAuth) {
      const user = resolveCredentialExpr(authConfig.basicAuth.username, credentialValues);
      const pass = resolveCredentialExpr(authConfig.basicAuth.password, credentialValues);
      const encoded = btoa(`${user}:${pass}`);
      headers['Authorization'] = `Basic ${encoded}`;
    }

    return { headers, queryParams };
  }

  // --- 2. Fallback: common patterns ---

  // API key in header (validate header name against HTTP spec)
  if (credentialValues.apiKey && typeof credentialValues.apiKey === 'string') {
    const VALID_HEADER_NAME = /^[a-zA-Z0-9\-_]+$/;
    const rawName =
      typeof credentialValues.headerName === 'string'
        ? credentialValues.headerName
        : 'Authorization';
    const headerName = VALID_HEADER_NAME.test(rawName) ? rawName : 'Authorization';
    headers[headerName] = sanitizeHeaderValue(credentialValues.apiKey);
  }

  // Bearer token (accessToken)
  if (
    credentialValues.accessToken &&
    typeof credentialValues.accessToken === 'string' &&
    !headers['Authorization']
  ) {
    headers['Authorization'] = `Bearer ${credentialValues.accessToken}`;
  }

  // Bearer token (token)
  if (
    credentialValues.token &&
    typeof credentialValues.token === 'string' &&
    !headers['Authorization']
  ) {
    headers['Authorization'] = `Bearer ${credentialValues.token}`;
  }

  // Basic auth
  if (
    credentialValues.user &&
    credentialValues.password &&
    typeof credentialValues.user === 'string' &&
    typeof credentialValues.password === 'string' &&
    !headers['Authorization']
  ) {
    const encoded = btoa(`${credentialValues.user}:${credentialValues.password}`);
    headers['Authorization'] = `Basic ${encoded}`;
  }

  return { headers, queryParams };
}

/**
 * High-level credential injection from ResolvedCredentials[].
 *
 * Finds the first credential with data, builds a flat credential object,
 * then delegates to `applyCredentialAuth`. This is the function that
 * core/executor.ts and commands should call.
 */
export function injectCredentials(
  credentials: ResolvedCredentials[],
  authConfig?: CredentialAuthConfig | null,
): InjectionResult {
  if (credentials.length === 0) return { headers: {} };

  // Use the first credential type that has a secret or fields
  const cred = credentials.find((c) => c.primarySecret || Object.keys(c.fields).length > 0);
  if (!cred) return { headers: {} };

  const credObj = buildCredentialObject(cred);
  return applyCredentialAuth(credObj, authConfig);
}

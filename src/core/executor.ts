/**
 * Generic HTTP executor for declarative plugins.
 *
 * Takes an operation definition and parameters, constructs and sends the
 * HTTP request, and returns a normalized Result.
 *
 * Internal pipeline:
 *   1. buildHttpRequest  — pure request construction from operation + params
 *   2. applyCredentialInjection — merge credential headers/query into request
 *   3. executeOperation  — orchestrator: validates URL, calls fetch, parses response
 */

import type { Operation, Result, ResolvedCredentials } from "./plugin-interface.js";
import { injectCredentials, validateUrlForCredentials } from "./credential-injector.js";
import type { HttpClient } from "./http-client.js";

export interface ExecutorOptions {
  /** Base URL for the API. */
  baseUrl: string;
  /** Resolved credentials to inject. */
  credentials?: ResolvedCredentials[];
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Allow insecure HTTP when credentials are present. */
  allowHttp?: boolean;
  /** HTTP client for making requests. Defaults to global fetch. */
  httpClient?: HttpClient;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Intermediate representation of an HTTP request before execution. */
interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  queryParams: URLSearchParams;
}

// ---------------------------------------------------------------------------
// Step 1: Pure request construction
// ---------------------------------------------------------------------------

/**
 * Build the HTTP request from an operation definition and user-supplied params.
 *
 * Pure function — no side effects, no credential logic.
 *
 * Returns either a fully constructed HttpRequest or an error Result when a
 * required parameter is missing.
 */
function buildHttpRequest(
  operation: Operation,
  params: Record<string, unknown>,
  options: { baseUrl: string },
): HttpRequest | Result {
  let url = `${options.baseUrl}${operation.path}`;
  const queryParams = new URLSearchParams();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  for (const param of operation.parameters) {
    const value = params[param.name] ?? param.default;
    if (value === undefined) {
      if (param.required) {
        return {
          success: false,
          error: {
            code: "MISSING_PARAM",
            message: `Required parameter "${param.name}" is missing`,
          },
        };
      }
      continue;
    }

    switch (param.location) {
      case "path":
        url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)));
        break;
      case "query":
        queryParams.set(param.name, String(value));
        break;
      case "header":
        headers[param.name] = String(value);
        break;
      case "body":
        // Collected separately below
        break;
    }
  }

  // Build body from body-located parameters
  const bodyParams: Record<string, unknown> = {};
  for (const param of operation.parameters) {
    if (param.location === "body" && params[param.name] !== undefined) {
      bodyParams[param.name] = params[param.name];
    }
  }
  const body =
    Object.keys(bodyParams).length > 0 ? JSON.stringify(bodyParams) : undefined;

  return { url, headers, body, queryParams };
}

// ---------------------------------------------------------------------------
// Step 2: Credential injection (pure merge)
// ---------------------------------------------------------------------------

/**
 * Inject resolved credentials into an existing HttpRequest.
 *
 * Delegates to the shared `injectCredentials` utility and merges the resulting
 * headers and query parameters into the request. The original request object
 * is mutated in place for efficiency (it is an intermediate internal value).
 */
function applyCredentialInjection(
  request: HttpRequest,
  credentials: ResolvedCredentials[],
): void {
  const injection = injectCredentials(credentials);

  for (const [key, value] of Object.entries(injection.headers)) {
    if (!request.headers[key]) request.headers[key] = value;
  }

  if (injection.queryParams) {
    for (const [key, value] of Object.entries(injection.queryParams)) {
      request.queryParams.set(key, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard: distinguish an error Result from a valid HttpRequest. */
function isErrorResult(value: HttpRequest | Result): value is Result {
  return "success" in value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute an operation against an HTTP API.
 *
 * Orchestrates the pipeline:
 *   buildHttpRequest -> applyCredentialInjection -> URL validation -> fetch -> parse
 */
export async function executeOperation(
  operation: Operation,
  params: Record<string, unknown>,
  options: ExecutorOptions,
): Promise<Result> {
  const { baseUrl, credentials = [], timeout = 30_000, allowHttp = false, httpClient = fetch } = options;

  // --- 1. Build the request ---
  const requestOrError = buildHttpRequest(operation, params, { baseUrl });
  if (isErrorResult(requestOrError)) {
    return requestOrError;
  }
  const request = requestOrError;

  // --- 2. Inject credentials ---
  if (credentials.length > 0) {
    applyCredentialInjection(request, credentials);
  }

  // --- 3. Assemble final URL ---
  const queryString = request.queryParams.toString();
  const fullUrl = queryString ? `${request.url}?${queryString}` : request.url;

  // --- 4. Validate URL safety when credentials are present ---
  if (credentials.length > 0 && !allowHttp) {
    const urlError = validateUrlForCredentials(fullUrl);
    if (urlError) {
      return {
        success: false,
        error: { code: "INSECURE_TRANSPORT", message: urlError },
      };
    }
  }

  // --- 5. Execute fetch and parse response ---
  const startTime = Date.now();

  try {
    const response = await httpClient(fullUrl, {
      method: operation.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(timeout),
    });

    const duration = Date.now() - startTime;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    let data: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: `HTTP ${response.status} ${response.statusText}`,
          details: data,
        },
        metadata: {
          statusCode: response.status,
          headers: responseHeaders,
          duration,
        },
      };
    }

    return {
      success: true,
      data,
      metadata: {
        statusCode: response.status,
        headers: responseHeaders,
        duration,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      error: {
        code: "REQUEST_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      metadata: { duration },
    };
  }
}

/**
 * Generic HTTP executor for declarative plugins.
 *
 * Takes an operation definition and parameters, constructs and sends the
 * HTTP request, and returns a normalized Result.
 */

import type { Operation, Result } from "./plugin-interface.js";

export interface ExecutorOptions {
  /** Base URL for the API. */
  baseUrl: string;
  /** Credentials to inject (headers, query params, etc.). */
  credentials?: Record<string, string>;
  /** Request timeout in milliseconds. */
  timeout?: number;
}

/**
 * Execute an operation against an HTTP API.
 */
export async function executeOperation(
  operation: Operation,
  params: Record<string, unknown>,
  options: ExecutorOptions,
): Promise<Result> {
  const { baseUrl, credentials: _credentials, timeout = 30_000 } = options;

  // Build the URL with path parameter substitution
  let url = `${baseUrl}${operation.path}`;
  const queryParams = new URLSearchParams();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let body: string | undefined;

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
        // Collect body parameters into a single JSON body
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
  if (Object.keys(bodyParams).length > 0) {
    body = JSON.stringify(bodyParams);
  }

  const queryString = queryParams.toString();
  const fullUrl = queryString ? `${url}?${queryString}` : url;

  const startTime = Date.now();

  try {
    const response = await fetch(fullUrl, {
      method: operation.method,
      headers,
      body,
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

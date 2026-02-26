/**
 * Execution shim — provides an IExecuteFunctions-compatible object for
 * running n8n node code in the nathan CLI context.
 *
 * Since nathan executes nodes outside of the n8n server runtime, many
 * context methods (workflow metadata, instance URLs, etc.) are stubbed.
 * The important parts — parameter access, credential injection, and HTTP
 * helpers — are fully implemented.
 */

import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeMetadata,
  IWorkflowMetadata,
  IRequestOptions,
  IHttpRequestOptions,
  IBinaryData,
} from "./types.ts";
import { loadCredentialAuthenticate as loadCredAuth } from "./credential-type-loader.js";
import { applyCredentialAuth } from "../core/credential-injector.js";

// ---------------------------------------------------------------------------
// Shared fetch helpers
// ---------------------------------------------------------------------------

interface FetchSpec {
  url: string;
  init: RequestInit;
}

/**
 * Core fetch builder — shared by both IRequestOptions and IHttpRequestOptions paths.
 * Handles method, headers, body serialization, query strings, and timeout.
 */
function buildFetchSpec(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  json?: boolean;
  form?: Record<string, unknown>;
  formData?: Record<string, unknown>;
  auth?: { user: string; pass: string };
  qs?: Record<string, unknown>;
  qsArrayFormat?: string;
  followRedirect?: boolean;
  timeout?: number;
}): FetchSpec {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers ?? {});
  const init: RequestInit = {
    method,
    headers,
    redirect: options.followRedirect === false ? "manual" : "follow",
  };

  const canHaveBody = !["GET", "HEAD", "OPTIONS"].includes(method);

  // Body handling
  if (canHaveBody && options.body !== undefined && options.body !== null) {
    const isEmpty = typeof options.body === "object" && Object.keys(options.body as Record<string, unknown>).length === 0;
    if (!isEmpty) {
      if (options.json !== false && typeof options.body === "object") {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(options.body);
      } else if (typeof options.body === "string") {
        init.body = options.body;
      } else {
        init.body = JSON.stringify(options.body);
      }
    }
  }

  // Form handling
  if (canHaveBody && options.form) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.form)) {
      params.set(k, String(v));
    }
    init.body = params.toString();
  }

  if (canHaveBody && options.formData) {
    headers.delete("Content-Type");
    const fd = new FormData();
    for (const [k, v] of Object.entries(options.formData)) {
      if (v instanceof Blob) {
        fd.append(k, v);
      } else {
        fd.append(k, String(v));
      }
    }
    init.body = fd;
  }

  // Basic auth
  if (options.auth) {
    const encoded = btoa(`${options.auth.user}:${options.auth.pass}`);
    headers.set("Authorization", `Basic ${encoded}`);
  }

  // Query string
  let fullUrl = options.url;
  if (options.qs && Object.keys(options.qs).length > 0) {
    const sep = fullUrl.includes("?") ? "&" : "?";
    const qsParts: string[] = [];
    const arrayFormat = options.qsArrayFormat ?? "repeat";
    for (const [k, v] of Object.entries(options.qs)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          const key = arrayFormat === "brackets" ? `${k}[]` : k;
          qsParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
        }
      } else {
        qsParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    fullUrl = `${fullUrl}${sep}${qsParts.join("&")}`;
  }

  // Timeout
  if (options.timeout) {
    init.signal = AbortSignal.timeout(options.timeout);
  }

  return { url: fullUrl, init };
}

function requestOptionsToFetchSpec(opts: IRequestOptions): FetchSpec {
  return buildFetchSpec({
    url: opts.url ?? opts.uri ?? "",
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
    json: opts.json,
    form: opts.form,
    formData: opts.formData,
    auth: opts.auth,
    qs: opts.qs,
    followRedirect: opts.followRedirect,
    timeout: opts.timeout,
  });
}

function httpRequestOptionsToFetchSpec(opts: IHttpRequestOptions): FetchSpec {
  return buildFetchSpec({
    url: opts.url,
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
    json: opts.json,
    qs: opts.qs,
    qsArrayFormat: opts.arrayFormat,
    followRedirect: opts.followRedirect,
    timeout: opts.timeout,
  });
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function doFetch(
  url: string,
  init: RequestInit,
  returnFull: boolean,
  ignoreErrors: boolean,
): Promise<unknown> {
  const response = await fetch(url, init);

  if (!ignoreErrors && !response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }

  if (returnFull) {
    const body = await parseResponseBody(response);
    return {
      body,
      headers: Object.fromEntries(response.headers.entries()),
      statusCode: response.status,
      statusMessage: response.statusText,
    };
  }

  return parseResponseBody(response);
}

// ---------------------------------------------------------------------------
// Credential injection for HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Apply credential auth to a fetch spec and return the final URL.
 * Shared by requestWithAuthentication and httpRequestWithAuthentication.
 */
function applyAuthToFetchSpec(
  credentialType: string,
  credentials: Record<string, Record<string, unknown>>,
  spec: FetchSpec,
): FetchSpec {
  const creds = credentials[credentialType];
  if (!creds) {
    throw new Error(`No credentials of type "${credentialType}" provided.`);
  }

  const headers = spec.init.headers instanceof Headers ? spec.init.headers : new Headers();

  let authConfig = null;
  const auth = loadCredAuth(credentialType);
  if (auth) authConfig = auth;

  const injection = applyCredentialAuth(creds, authConfig);
  for (const [key, value] of Object.entries(injection.headers)) {
    headers.set(key, value);
  }

  let finalUrl = spec.url;
  if (injection.queryParams) {
    for (const [key, value] of Object.entries(injection.queryParams)) {
      const sep = finalUrl.includes("?") ? "&" : "?";
      finalUrl = `${finalUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
  }

  return { url: finalUrl, init: { ...spec.init, headers } };
}

// ---------------------------------------------------------------------------
// Factory: parameter access
// ---------------------------------------------------------------------------

function createParameterAccess(
  params: Record<string, unknown>,
  propDefaults: Map<string, unknown>,
) {
  return function getNodeParameter(
    parameterName: string,
    _itemIndex: number,
    fallbackValue?: unknown,
  ): unknown {
    if (parameterName in params) {
      return params[parameterName];
    }

    // Dot-path traversal: "options.limit" -> params.options.limit
    const parts = parameterName.split(".");
    let current: unknown = params;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") break;
      current = (current as Record<string, unknown>)[part];
    }
    if (current !== undefined && current !== params) {
      return current;
    }

    if (arguments.length >= 3) return fallbackValue;
    if (propDefaults.has(parameterName)) return propDefaults.get(parameterName);
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Factory: HTTP helpers
// ---------------------------------------------------------------------------

function createHttpHelpers(
  credentials: Record<string, Record<string, unknown>>,
): IExecuteFunctions["helpers"] {
  return {
    async request(opts: IRequestOptions): Promise<unknown> {
      const spec = requestOptionsToFetchSpec(opts);
      return doFetch(spec.url, spec.init, opts.resolveWithFullResponse ?? false, opts.simple === false);
    },

    async requestWithAuthentication(
      credentialType: string,
      opts: IRequestOptions,
      _additionalCredentialOptions?: Record<string, unknown>,
    ): Promise<unknown> {
      // Detect unimplemented operations
      const rawUrl = opts.url ?? opts.uri ?? "";
      try {
        const parsed = new URL(rawUrl);
        if (parsed.pathname === "" || parsed.pathname === "/") {
          throw new Error(
            `Operation not implemented: the n8n node did not set an API endpoint. ` +
            `URL resolved to base: ${rawUrl}`,
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Operation not implemented")) throw e;
      }

      const spec = requestOptionsToFetchSpec(opts);
      const authed = applyAuthToFetchSpec(credentialType, credentials, spec);
      return doFetch(authed.url, authed.init, opts.resolveWithFullResponse ?? false, opts.simple === false);
    },

    async httpRequest(opts: IHttpRequestOptions): Promise<unknown> {
      const spec = httpRequestOptionsToFetchSpec(opts);
      return doFetch(spec.url, spec.init, opts.returnFullResponse ?? false, opts.ignoreHttpStatusErrors ?? false);
    },

    async httpRequestWithAuthentication(
      credentialType: string,
      opts: IHttpRequestOptions,
      _additionalCredentialOptions?: Record<string, unknown>,
    ): Promise<unknown> {
      const spec = httpRequestOptionsToFetchSpec(opts);
      const authed = applyAuthToFetchSpec(credentialType, credentials, spec);
      return doFetch(authed.url, authed.init, opts.returnFullResponse ?? false, opts.ignoreHttpStatusErrors ?? false);
    },

    async prepareBinaryData(
      binaryData: Buffer | Uint8Array,
      fileName?: string,
      mimeType?: string,
    ): Promise<IBinaryData> {
      const buffer = binaryData instanceof Buffer ? binaryData : Buffer.from(binaryData);
      return {
        data: buffer.toString("base64"),
        mimeType: mimeType ?? "application/octet-stream",
        fileName: fileName ?? "file",
        fileSize: buffer.length,
      };
    },

    async getBinaryDataBuffer(
      itemIndex: number,
      propertyName: string,
    ): Promise<Buffer> {
      // inputData is captured via closure in createExecutionContext
      throw new Error(`getBinaryDataBuffer not available in this context (item ${itemIndex}, property "${propertyName}")`);
    },

    returnJsonArray(jsonData: unknown): INodeExecutionData[] {
      if (Array.isArray(jsonData)) {
        return jsonData.map((item) => ({
          json: typeof item === "object" && item !== null ? item : { data: item },
        }));
      }
      if (typeof jsonData === "object" && jsonData !== null) {
        return [{ json: jsonData as Record<string, unknown> }];
      }
      return [{ json: { data: jsonData } }];
    },

    constructExecutionMetaData(
      items: INodeExecutionData[],
      options: { itemData: { item: number; input?: number } },
    ): INodeExecutionData[] {
      return items.map((item) => ({ ...item, pairedItem: options.itemData }));
    },

    assertBinaryData(_itemIndex: number, _propertyName: string): IBinaryData {
      throw new Error(`assertBinaryData not available in this context`);
    },

    async binaryToBuffer(body: IBinaryData): Promise<Buffer> {
      return Buffer.from(body.data, "base64");
    },
  };
}

// ---------------------------------------------------------------------------
// Logger (only respects NATHAN_DEBUG, not generic DEBUG)
// ---------------------------------------------------------------------------

const shimLogger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NATHAN_DEBUG) {
      console.debug(`[n8n-shim] DEBUG: ${message}`, meta ?? "");
    }
  },
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(`[n8n-shim] INFO: ${message}`, meta ?? "");
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[n8n-shim] WARN: ${message}`, meta ?? "");
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[n8n-shim] ERROR: ${message}`, meta ?? "");
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface NodePropertyDef {
  name: string;
  type?: string;
  default?: unknown;
}

export interface ExecutionContextOptions {
  params: Record<string, unknown>;
  credentials: Record<string, Record<string, unknown>>;
  nodeProperties?: NodePropertyDef[];
  timezone?: string;
  continueOnFail?: boolean;
}

/**
 * Create an `IExecuteFunctions`-compatible context for running n8n node code.
 */
export function createExecutionContext(
  options: ExecutionContextOptions,
): IExecuteFunctions {
  const { params, credentials, nodeProperties, timezone = "UTC", continueOnFail: shouldContinueOnFail = false } = options;

  // Build property defaults lookup
  const propDefaults = new Map<string, unknown>();
  if (nodeProperties) {
    for (const prop of nodeProperties) {
      propDefaults.set(prop.name, prop.default);
    }
  }

  const inputData: INodeExecutionData[] = [{ json: { ...params } }];
  const helpers = createHttpHelpers(credentials);

  // Wire up binary helpers that need inputData closure
  helpers.getBinaryDataBuffer = async (itemIndex: number, propertyName: string): Promise<Buffer> => {
    const item = inputData[itemIndex];
    if (!item?.binary?.[propertyName]) {
      throw new Error(`No binary data found for property "${propertyName}" on item ${itemIndex}.`);
    }
    return Buffer.from(item.binary[propertyName].data, "base64");
  };

  helpers.assertBinaryData = (itemIndex: number, propertyName: string): IBinaryData => {
    const item = inputData[itemIndex];
    if (!item?.binary?.[propertyName]) {
      throw new Error(`No binary data found for property "${propertyName}" on item ${itemIndex}.`);
    }
    return item.binary[propertyName];
  };

  return {
    getNodeParameter: createParameterAccess(params, propDefaults),

    async getCredentials(type: string, _itemIndex?: number): Promise<Record<string, unknown>> {
      const creds = credentials[type];
      if (!creds) {
        throw new Error(
          `No credentials of type "${type}" provided. ` +
          `Available types: ${Object.keys(credentials).join(", ") || "(none)"}`,
        );
      }
      return { ...creds };
    },

    getInputData(_inputIndex?: number, _inputName?: string): INodeExecutionData[] {
      return inputData;
    },

    getWorkflow(): IWorkflowMetadata {
      return { id: "nathan-cli", name: "nathan CLI Execution", active: true };
    },

    getNode(): INodeMetadata {
      return { name: "nathan-shim", type: "nathan-shim", typeVersion: 1 };
    },

    getMode(): "manual" {
      return "manual";
    },

    getTimezone(): string {
      return timezone;
    },

    getRestApiUrl(): string {
      return "http://localhost/api/v1";
    },

    getInstanceBaseUrl(): string {
      return "http://localhost";
    },

    continueOnFail(_error?: Error): boolean {
      return shouldContinueOnFail;
    },

    evaluateExpression(expression: string, _itemIndex: number): unknown {
      return expression.replace(
        /\{\{\s*\$json\.(\w+)\s*\}\}/g,
        (_match, key) => {
          const val = params[key];
          return val !== undefined ? String(val) : "";
        },
      );
    },

    helpers,
    logger: shimLogger,
  };
}

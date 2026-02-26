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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a standard fetch `RequestInit` from an n8n IRequestOptions object.
 */
function requestOptionsToFetchInit(opts: IRequestOptions): {
  url: string;
  init: RequestInit;
} {
  const url = opts.url ?? opts.uri ?? "";

  const method = (opts.method ?? "GET").toUpperCase();
  const headers = new Headers(opts.headers ?? {});
  const init: RequestInit = {
    method,
    headers,
    redirect: opts.followRedirect === false ? "manual" : "follow",
  };

  // Body handling — skip for GET/HEAD/OPTIONS (fetch throws otherwise)
  const canHaveBody = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (canHaveBody && opts.body !== undefined && opts.body !== null) {
    // Skip empty objects (n8n nodes often pass {} as default body)
    const isEmpty = typeof opts.body === "object" && Object.keys(opts.body as Record<string, unknown>).length === 0;
    if (!isEmpty) {
      if (opts.json !== false && typeof opts.body === "object") {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(opts.body);
      } else if (typeof opts.body === "string") {
        init.body = opts.body;
      } else {
        init.body = JSON.stringify(opts.body);
      }
    }
  }

  // Form handling
  if (canHaveBody && opts.form) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) {
      params.set(k, String(v));
    }
    init.body = params.toString();
  }

  if (canHaveBody && opts.formData) {
    // Let the browser/runtime set the multipart boundary automatically.
    headers.delete("Content-Type");
    const fd = new FormData();
    for (const [k, v] of Object.entries(opts.formData)) {
      if (v instanceof Blob) {
        fd.append(k, v);
      } else {
        fd.append(k, String(v));
      }
    }
    init.body = fd;
  }

  // Basic auth
  if (opts.auth) {
    const encoded = btoa(`${opts.auth.user}:${opts.auth.pass}`);
    headers.set("Authorization", `Basic ${encoded}`);
  }

  // Query string
  let fullUrl = url;
  if (opts.qs && Object.keys(opts.qs).length > 0) {
    const sep = fullUrl.includes("?") ? "&" : "?";
    const qsParts: string[] = [];
    for (const [k, v] of Object.entries(opts.qs)) {
      qsParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    fullUrl = `${fullUrl}${sep}${qsParts.join("&")}`;
  }

  // Timeout via AbortSignal
  if (opts.timeout) {
    init.signal = AbortSignal.timeout(opts.timeout);
  }

  return { url: fullUrl, init };
}

/**
 * Build a standard fetch `RequestInit` from an n8n IHttpRequestOptions object.
 */
function httpRequestOptionsToFetchInit(opts: IHttpRequestOptions): {
  url: string;
  init: RequestInit;
} {
  const method = (opts.method ?? "GET").toUpperCase();
  const headers = new Headers(opts.headers ?? {});
  const init: RequestInit = {
    method,
    headers,
    redirect: opts.followRedirect === false ? "manual" : "follow",
  };

  // Body — skip for GET/HEAD/OPTIONS
  const canHaveBody = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (canHaveBody && opts.body !== undefined && opts.body !== null) {
    const isEmpty = typeof opts.body === "object" && Object.keys(opts.body as Record<string, unknown>).length === 0;
    if (!isEmpty) {
      if (opts.json !== false && typeof opts.body === "object") {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(opts.body);
      } else if (typeof opts.body === "string") {
        init.body = opts.body;
      } else {
        init.body = JSON.stringify(opts.body);
      }
    }
  }

  // Query string
  let fullUrl = opts.url;
  if (opts.qs && Object.keys(opts.qs).length > 0) {
    const sep = fullUrl.includes("?") ? "&" : "?";
    const qsParts: string[] = [];
    for (const [k, v] of Object.entries(opts.qs)) {
      if (Array.isArray(v)) {
        const format = opts.arrayFormat ?? "brackets";
        for (const item of v) {
          const key = format === "brackets" ? `${k}[]` : k;
          qsParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
        }
      } else {
        qsParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    fullUrl = `${fullUrl}${sep}${qsParts.join("&")}`;
  }

  // Timeout
  if (opts.timeout) {
    init.signal = AbortSignal.timeout(opts.timeout);
  }

  return { url: fullUrl, init };
}

/**
 * Execute a fetch and parse the response.
 */
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

/**
 * Parse the response body, preferring JSON.
 */
async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

/**
 * Try to load an n8n credential type definition and use its `authenticate`
 * config to inject credentials into request options.
 */
function loadCredentialAuthenticate(credentialType: string): any | null {
  try {
    // n8n credential files follow a naming convention
    const pascalName = credentialType.charAt(0).toUpperCase() + credentialType.slice(1);
    const mod = require(`n8n-nodes-base/dist/credentials/${pascalName}.credentials.js`);
    const CredClass = mod[pascalName] ?? mod.default ?? Object.values(mod)[0];
    if (CredClass && typeof CredClass === "function") {
      const instance = new CredClass();
      return instance.authenticate ?? null;
    }
  } catch {}
  return null;
}

/**
 * Resolve an n8n credential expression like '=token {{$credentials?.accessToken}}'
 * by substituting credential values.
 */
function resolveCredentialExpression(
  template: string,
  credentials: Record<string, unknown>,
): string {
  // Strip leading '=' if present (n8n expression marker)
  let expr = template.startsWith("=") ? template.slice(1) : template;
  // Replace {{$credentials?.field}} or {{$credentials.field}}
  expr = expr.replace(
    /\{\{\s*\$credentials\??\.\s*(\w+)\s*\}\}/g,
    (_match, key) => {
      const val = credentials[key];
      return val !== undefined ? String(val) : "";
    },
  );
  return expr;
}

/**
 * Inject credentials into request options. First tries to use the n8n
 * credential type's `authenticate` config (which knows exactly how to
 * apply credentials). Falls back to common patterns.
 */
function injectCredentials(
  credentials: Record<string, unknown>,
  headers: Headers,
  url: string,
  _body: unknown,
  credentialType?: string,
): { url: string; body: unknown } {
  // Try n8n credential authenticate config first
  if (credentialType) {
    const auth = loadCredentialAuthenticate(credentialType);
    if (auth?.type === "generic" && auth.properties) {
      // Apply headers
      if (auth.properties.headers) {
        for (const [key, template] of Object.entries(auth.properties.headers as Record<string, string>)) {
          headers.set(key, resolveCredentialExpression(template, credentials));
        }
      }
      // Apply query string
      if (auth.properties.qs) {
        for (const [key, template] of Object.entries(auth.properties.qs as Record<string, string>)) {
          const sep = url.includes("?") ? "&" : "?";
          url = `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(resolveCredentialExpression(String(template), credentials))}`;
        }
      }
      // Apply body
      if (auth.properties.body) {
        // Merge into body if it's an object
      }
      // Apply auth (basic)
      if (auth.properties.auth) {
        const user = resolveCredentialExpression(auth.properties.auth.username, credentials);
        const pass = resolveCredentialExpression(auth.properties.auth.password, credentials);
        const encoded = btoa(`${user}:${pass}`);
        headers.set("Authorization", `Basic ${encoded}`);
      }
      return { url, body: _body };
    }
  }

  // Fallback: common patterns

  // API key in header
  if (credentials.apiKey && typeof credentials.apiKey === "string") {
    const headerName =
      typeof credentials.headerName === "string"
        ? credentials.headerName
        : "Authorization";
    headers.set(headerName, credentials.apiKey);
  }

  // Bearer token
  if (credentials.accessToken && typeof credentials.accessToken === "string" && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${credentials.accessToken}`);
  }
  if (credentials.token && typeof credentials.token === "string" && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${credentials.token}`);
  }

  // Basic auth
  if (
    credentials.user &&
    credentials.password &&
    typeof credentials.user === "string" &&
    typeof credentials.password === "string"
  ) {
    const encoded = btoa(`${credentials.user}:${credentials.password}`);
    headers.set("Authorization", `Basic ${encoded}`);
  }

  return { url, body: _body };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExecutionContextOptions {
  /** Parameter values keyed by name. */
  params: Record<string, unknown>;
  /** Credential values keyed by credential type. */
  credentials: Record<string, Record<string, unknown>>;
  /** Timezone string (defaults to UTC). */
  timezone?: string;
  /** Whether to continue on error (defaults to false). */
  continueOnFail?: boolean;
}

/**
 * Create an `IExecuteFunctions`-compatible context for running n8n node
 * code from the nathan CLI.
 *
 * Usage:
 * ```ts
 * const ctx = createExecutionContext({
 *   params: { owner: "acme", repo: "widgets" },
 *   credentials: { githubApi: { accessToken: "ghp_..." } },
 * });
 * const result = await nodeInstance.execute.call(ctx);
 * ```
 */
export function createExecutionContext(
  options: ExecutionContextOptions,
): IExecuteFunctions {
  const { params, credentials, timezone = "UTC", continueOnFail: shouldContinueOnFail = false } = options;

  // Wrap params as a single-item input data array.
  const inputData: INodeExecutionData[] = [{ json: { ...params } }];

  const context: IExecuteFunctions = {
    // ---- Parameter access ----

    getNodeParameter(
      parameterName: string,
      _itemIndex: number,
      fallbackValue?: unknown,
    ): unknown {
      // Support dot-notation paths: "options.limit" -> params.options.limit
      if (parameterName in params) {
        return params[parameterName];
      }

      // Try dot-path traversal
      const parts = parameterName.split(".");
      let current: unknown = params;
      for (const part of parts) {
        if (current === null || current === undefined || typeof current !== "object") {
          return fallbackValue;
        }
        current = (current as Record<string, unknown>)[part];
      }

      return current !== undefined ? current : fallbackValue;
    },

    // ---- Credential access ----

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

    // ---- Input data ----

    getInputData(_inputIndex?: number, _inputName?: string): INodeExecutionData[] {
      return inputData;
    },

    // ---- Workflow / node metadata (stubs) ----

    getWorkflow(): IWorkflowMetadata {
      return { id: "nathan-cli", name: "nathan CLI Execution", active: true };
    },

    getNode(): INodeMetadata {
      return {
        name: "nathan-shim",
        type: "nathan-shim",
        typeVersion: 1,
      };
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
      // Basic expression evaluation: replace {{ $json.key }} patterns
      // with values from params.  Full n8n expression support is not
      // implemented; this handles the most common case.
      const replaced = expression.replace(
        /\{\{\s*\$json\.(\w+)\s*\}\}/g,
        (_match, key) => {
          const val = params[key];
          return val !== undefined ? String(val) : "";
        },
      );
      return replaced;
    },

    // ---- Helpers ----

    helpers: {
      async request(opts: IRequestOptions): Promise<unknown> {
        const { url, init } = requestOptionsToFetchInit(opts);
        return doFetch(
          url,
          init,
          opts.resolveWithFullResponse ?? false,
          opts.simple === false,
        );
      },

      async requestWithAuthentication(
        credentialType: string,
        opts: IRequestOptions,
        _additionalCredentialOptions?: Record<string, unknown>,
      ): Promise<unknown> {
        const creds = credentials[credentialType];
        if (!creds) {
          throw new Error(`No credentials of type "${credentialType}" provided.`);
        }

        const { url, init } = requestOptionsToFetchInit(opts);
        const headers = init.headers instanceof Headers ? init.headers : new Headers();
        const injected = injectCredentials(creds, headers, url, init.body, credentialType);
        init.headers = headers;
        init.body = injected.body as BodyInit | null | undefined;

        return doFetch(
          injected.url,
          init,
          opts.resolveWithFullResponse ?? false,
          opts.simple === false,
        );
      },

      async httpRequest(opts: IHttpRequestOptions): Promise<unknown> {
        const { url, init } = httpRequestOptionsToFetchInit(opts);
        return doFetch(
          url,
          init,
          opts.returnFullResponse ?? false,
          opts.ignoreHttpStatusErrors ?? false,
        );
      },

      async httpRequestWithAuthentication(
        credentialType: string,
        opts: IHttpRequestOptions,
        _additionalCredentialOptions?: Record<string, unknown>,
      ): Promise<unknown> {
        const creds = credentials[credentialType];
        if (!creds) {
          throw new Error(`No credentials of type "${credentialType}" provided.`);
        }

        const { url, init } = httpRequestOptionsToFetchInit(opts);
        const headers = init.headers instanceof Headers ? init.headers : new Headers();
        const injected = injectCredentials(creds, headers, url, init.body, credentialType);
        init.headers = headers;
        init.body = injected.body as BodyInit | null | undefined;

        return doFetch(
          injected.url,
          init,
          opts.returnFullResponse ?? false,
          opts.ignoreHttpStatusErrors ?? false,
        );
      },

      async prepareBinaryData(
        binaryData: Buffer | Uint8Array,
        fileName?: string,
        mimeType?: string,
      ): Promise<IBinaryData> {
        // Encode to base64 for storage.
        const buffer = binaryData instanceof Buffer ? binaryData : Buffer.from(binaryData);
        const base64 = buffer.toString("base64");

        return {
          data: base64,
          mimeType: mimeType ?? "application/octet-stream",
          fileName: fileName ?? "file",
          fileSize: buffer.length,
        };
      },

      async getBinaryDataBuffer(
        itemIndex: number,
        propertyName: string,
      ): Promise<Buffer> {
        const item = inputData[itemIndex];
        if (!item?.binary?.[propertyName]) {
          throw new Error(
            `No binary data found for property "${propertyName}" on item ${itemIndex}.`,
          );
        }
        return Buffer.from(item.binary[propertyName].data, "base64");
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
        return items.map((item) => ({
          ...item,
          pairedItem: options.itemData,
        }));
      },

      assertBinaryData(itemIndex: number, propertyName: string): IBinaryData {
        const item = inputData[itemIndex];
        if (!item?.binary?.[propertyName]) {
          throw new Error(
            `No binary data found for property "${propertyName}" on item ${itemIndex}.`,
          );
        }
        return item.binary[propertyName];
      },

      async binaryToBuffer(body: IBinaryData): Promise<Buffer> {
        return Buffer.from(body.data, "base64");
      },
    },

    // ---- Logger ----

    logger: {
      debug(message: string, meta?: Record<string, unknown>): void {
        if (process.env.DEBUG || process.env.NATHAN_DEBUG) {
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
    },
  };

  return context;
}

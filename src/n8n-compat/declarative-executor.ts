/**
 * Declarative routing executor for n8n community nodes.
 *
 * Executes declarative n8n nodes (those without a custom `execute()` method)
 * by interpreting their routing metadata. Uses `Expression.resolveWithoutWorkflow()`
 * from n8n-workflow for expression resolution.
 */

import {
  applyCredentialAuth,
  buildCredentialObject,
  validateUrlForCredentials,
} from '../core/credential-injector.js';
import type {
  Result,
  ResolvedCredentials,
  CredentialAuthConfig,
} from '../core/plugin-interface.js';
import { loadCredentialAuthenticate } from './credential-type-loader.js';
import { getRequire } from './require.js';
import type {
  INodeTypeDescription,
  INodeProperties,
  INodePropertyOptions,
  INodePropertyCollectionEntry,
  INodePropertyRouting,
} from './types.js';

// ---------------------------------------------------------------------------
// Expression resolution
// ---------------------------------------------------------------------------

/**
 * Lazily loaded Expression.resolveWithoutWorkflow from n8n-workflow.
 */
let _resolveWithoutWorkflow:
  | ((expr: string, context: Record<string, unknown>) => unknown)
  | undefined;

function getResolveWithoutWorkflow(): typeof _resolveWithoutWorkflow {
  if (_resolveWithoutWorkflow) return _resolveWithoutWorkflow;
  try {
    const req = getRequire();
    const mod = req('n8n-workflow');
    if (typeof mod?.Expression?.resolveWithoutWorkflow === 'function') {
      _resolveWithoutWorkflow = mod.Expression.resolveWithoutWorkflow;
      return _resolveWithoutWorkflow;
    }
  } catch {
    // n8n-workflow not available
  }
  return undefined;
}

/**
 * Resolve an n8n expression string using Expression.resolveWithoutWorkflow.
 * Falls back to simple template substitution if n8n-workflow is not available.
 */
export function resolveExpression(expr: string, context: Record<string, unknown>): string {
  const resolve = getResolveWithoutWorkflow();
  if (resolve) {
    const result = resolve(expr, context);
    const str = String(result ?? '');
    // resolveWithoutWorkflow prepends '=' to results — strip it
    return str.startsWith('=') ? str.slice(1) : str;
  }

  // Fallback: simple mustache-style replacement
  return expr.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, path: string) => {
    const parts = path.trim().replace(/\?\./g, '.').split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') return '';
      current = (current as Record<string, unknown>)[part];
    }
    return current !== undefined ? String(current) : '';
  });
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isPropertyOption(opt: unknown): opt is INodePropertyOptions {
  return typeof opt === 'object' && opt !== null && 'value' in opt && !('type' in opt);
}

// ---------------------------------------------------------------------------
// Routing resolution
// ---------------------------------------------------------------------------

/**
 * Find the operation option matching the given resource+operation in the node's properties.
 */
function findOperationOption(
  properties: INodeProperties[],
  resource: string,
  operation: string,
): { option: INodePropertyOptions; prop: INodeProperties } | null {
  const operationProps = properties.filter((p) => p.name === 'operation' && p.type === 'options');

  for (const opProp of operationProps) {
    // Check if this operation prop is scoped to the given resource
    const showResource = opProp.displayOptions?.show?.resource;
    if (showResource && !showResource.includes(resource)) continue;

    for (const opt of opProp.options ?? []) {
      if (isPropertyOption(opt) && String(opt.value) === operation) {
        return { option: opt, prop: opProp };
      }
    }
  }

  return null;
}

/**
 * Collect routing info from parameters that are relevant to this resource+operation.
 */
function applyRoutingForParam(
  name: string,
  value: unknown,
  routing: INodePropertyRouting,
  qs: Record<string, string>,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): void {
  if (routing.send?.type === 'query' || routing.request?.qs) {
    const key = routing.send?.property ?? name;
    qs[key] = String(value);
  } else if (routing.send?.type === 'body') {
    const key = routing.send?.property ?? name;
    body[key] = value;
  } else if (routing.request?.headers) {
    Object.assign(headers, routing.request.headers);
  }
}

/**
 * Collect routing info from parameters that are relevant to this resource+operation.
 *
 * For collection / fixedCollection properties whose children carry routing
 * metadata (e.g. `additionalFields.cql`), we descend into the child options
 * and match their routing against flat CLI params.
 */
function collectParameterRouting(
  properties: INodeProperties[],
  resource: string,
  operation: string,
  params: Record<string, unknown>,
): {
  qs: Record<string, string>;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const qs: Record<string, string> = {};
  const body: Record<string, unknown> = {};
  const headers: Record<string, string> = {};

  for (const prop of properties) {
    if (prop.name === 'resource' || prop.name === 'operation') continue;

    // Check display options
    const show = prop.displayOptions?.show;
    if (show) {
      if (show.resource && !show.resource.includes(resource)) continue;
      if (show.operation && !show.operation.includes(operation)) continue;
    }

    // Top-level property with routing
    if (prop.routing) {
      const value = params[prop.name];
      if (value !== undefined && value !== '') {
        applyRoutingForParam(prop.name, value, prop.routing, qs, body, headers);
      }
      continue;
    }

    // Descend into collection/fixedCollection children whose options carry routing.
    // The adapter flattens these children into top-level CLI params, so we check
    // `params[child.name]` directly.
    if ((prop.type === 'collection' || prop.type === 'fixedCollection') && prop.options) {
      for (const child of prop.options) {
        if ('values' in child && Array.isArray((child as INodePropertyCollectionEntry).values)) {
          for (const sub of (child as INodePropertyCollectionEntry).values) {
            if (!sub.routing) continue;
            const value = params[sub.name];
            if (value !== undefined && value !== '') {
              applyRoutingForParam(sub.name, value, sub.routing, qs, body, headers);
            }
          }
        } else if ('routing' in child && (child as INodeProperties).routing) {
          const sub = child as INodeProperties;
          const value = params[sub.name];
          if (value !== undefined && value !== '') {
            applyRoutingForParam(sub.name, value, sub.routing, qs, body, headers);
          }
        }
      }
    }
  }

  return { qs, body, headers };
}

/**
 * Resolve a value that may be an n8n expression string or a plain number.
 * Returns a positive integer or undefined.
 */
function resolveNumericValue(value: unknown, context: Record<string, unknown>): number | undefined {
  if (typeof value === 'number' && value > 0) return value;
  if (typeof value === 'string') {
    // If it looks like an expression, resolve it
    if (value.startsWith('=') || value.includes('{{')) {
      const resolved = resolveExpression(value, context);
      const num = Number(resolved);
      if (!Number.isNaN(num) && num > 0) return num;
      return undefined;
    }
    const num = Number(value);
    if (!Number.isNaN(num) && num > 0) return num;
  }
  return undefined;
}

/**
 * Apply post-receive transforms to the response data.
 */
function applyPostReceive(
  data: unknown,
  routing: INodePropertyRouting | undefined,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): unknown {
  if (!routing?.output?.postReceive) return data;

  let result = data;

  let limitApplied = false;
  for (const transform of routing.output.postReceive) {
    if (typeof transform === 'string') continue;

    if (transform.type === 'rootProperty' && transform.properties) {
      const prop = transform.properties.property as string;
      if (prop && result && typeof result === 'object') {
        result = (result as Record<string, unknown>)[prop] ?? result;
      }
    }

    if (transform.type === 'limit' && transform.properties) {
      const maxResults =
        resolveNumericValue(params.limit, context) ??
        resolveNumericValue(params.maxResults, context) ??
        resolveNumericValue(transform.properties.maxResults, context);
      if (maxResults && Array.isArray(result)) {
        result = result.slice(0, maxResults);
        limitApplied = true;
      }
    }
  }

  // Apply maxResults from output spec only if no postReceive limit was applied
  if (!limitApplied && routing.output?.maxResults !== undefined) {
    const limit =
      resolveNumericValue(params.limit, context) ??
      resolveNumericValue(params.maxResults, context) ??
      resolveNumericValue(routing.output.maxResults, context);
    if (limit && Array.isArray(result)) {
      result = result.slice(0, limit);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DeclarativeExecutionOptions {
  nodeDescription: INodeTypeDescription;
  resource: string;
  operation: string;
  params: Record<string, unknown>;
  credentials: ResolvedCredentials[];
  /** Pre-built credential map (from buildN8nCredentials). When provided,
   *  the first entry is used for expression context and auth injection
   *  instead of building from raw ResolvedCredentials. */
  credentialMap?: Record<string, Record<string, unknown>>;
}

/**
 * Execute a declarative n8n node by interpreting its routing metadata.
 */
export async function executeDeclarativeRouting(
  opts: DeclarativeExecutionOptions,
): Promise<Result> {
  const { nodeDescription, resource, operation, params, credentials, credentialMap } = opts;

  // 1. Build expression context
  // Prefer the pre-built credential map (which has enhanced field mapping)
  // over building from raw ResolvedCredentials.
  let credObj: Record<string, unknown> = {};
  if (credentialMap && credentials.length > 0) {
    credObj = credentialMap[credentials[0].typeName] ?? {};
  } else if (credentials.length > 0) {
    credObj = buildCredentialObject(credentials[0]);
  }
  const context: Record<string, unknown> = {
    $credentials: credObj,
    $parameter: { resource, operation, ...params },
  };

  // 2. Resolve baseURL
  let baseURL = '';
  if (nodeDescription.requestDefaults?.baseURL) {
    baseURL = resolveExpression(nodeDescription.requestDefaults.baseURL, context);
  }

  // 3. Find matching operation
  const opMatch = findOperationOption(nodeDescription.properties, resource, operation);

  if (!opMatch) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN_OPERATION',
        message: `Unknown declarative operation: ${resource}/${operation}`,
      },
    };
  }

  const routing = opMatch.option.routing;

  // 4. Resolve URL
  let url = '';
  if (routing?.request?.url) {
    url = resolveExpression(routing.request.url, context);
  }

  // 5. Resolve method
  const method = routing?.request?.method ?? nodeDescription.requestDefaults?.method ?? 'GET';

  // 6. Collect query params and body from parameter routing
  const paramRouting = collectParameterRouting(
    nodeDescription.properties,
    resource,
    operation,
    params,
  );

  // Merge query params from operation routing
  if (routing?.request?.qs) {
    for (const [key, val] of Object.entries(routing.request.qs)) {
      const resolved = resolveExpression(
        typeof val === 'string' && val.startsWith('=') ? val : String(val),
        context,
      );
      if (resolved) paramRouting.qs[key] = resolved;
    }
  }

  // 7. Merge headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...nodeDescription.requestDefaults?.headers,
    ...paramRouting.headers,
  };

  // 8. Build full URL (normalize slashes between base and path)
  const normalizedBase = baseURL.replace(/\/$/, '');
  const normalizedUrl = url.startsWith('/') ? url : url ? `/${url}` : '';
  const fullBase = `${normalizedBase}${normalizedUrl}`;
  const qsStr = new URLSearchParams(paramRouting.qs).toString();
  let fullUrl = qsStr ? `${fullBase}?${qsStr}` : fullBase;

  // 9. Apply credential auth
  if (credentials.length > 0) {
    const credTypeName = credentials[0].typeName;
    let authConfig: CredentialAuthConfig | null = null;
    try {
      authConfig = loadCredentialAuthenticate(credTypeName);
    } catch {
      // ignore — will fall back to default patterns
    }

    const injection = applyCredentialAuth(credObj, authConfig);
    // Credential auth headers override request defaults
    for (const [key, value] of Object.entries(injection.headers)) {
      headers[key] = value;
    }

    if (injection.queryParams) {
      const urlObj = new URL(fullUrl);
      for (const [key, value] of Object.entries(injection.queryParams)) {
        urlObj.searchParams.set(key, value);
      }
      fullUrl = urlObj.toString();
    }
  }

  // 10. Validate URL before sending credentials
  if (credentials.length > 0) {
    const urlError = validateUrlForCredentials(fullUrl);
    if (urlError) {
      return {
        success: false,
        error: { code: 'UNSAFE_URL', message: urlError },
      };
    }
  }

  // 11. Build body
  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  let bodyStr: string | undefined;
  if (hasBody) {
    const mergedBody = {
      ...routing?.request?.body,
      ...paramRouting.body,
    };
    if (Object.keys(mergedBody).length > 0) {
      bodyStr = JSON.stringify(mergedBody);
    }
  }

  // 12. Execute HTTP request
  const startTime = Date.now();
  try {
    const response = await fetch(fullUrl, {
      method,
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(30_000),
    });

    const duration = Date.now() - startTime;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    const contentType = response.headers.get('content-type') ?? '';
    let data: unknown;
    if (contentType.includes('application/json')) {
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

    // 13. Apply post-receive transforms
    data = applyPostReceive(data, routing, params, context);

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
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      success: false,
      error: {
        code: isTimeout ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED',
        message: isTimeout
          ? `Request timed out after 30s`
          : error instanceof Error
            ? error.message
            : String(error),
      },
      metadata: { duration },
    };
  }
}

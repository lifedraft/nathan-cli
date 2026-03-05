/**
 * n8n credential type introspection.
 *
 * Consolidates the previously duplicated logic from:
 * - core/credential-store.ts (loadCredentialTypeDefinition)
 * - n8n-compat/execution-shim.ts (loadCredentialAuthenticate)
 *
 * All n8n credential module loading now goes through this single module.
 */

import type {
  CredentialField,
  CredentialFieldType,
  CredentialTypeInfo,
} from '../core/credential-introspector.js';
import type { HttpMethod, CredentialAuthConfig } from '../core/plugin-interface.js';
import { getRequire } from './require.js';
import type { IAuthenticateGeneric } from './types.js';

// ---------------------------------------------------------------------------
// Community credential path registry
// ---------------------------------------------------------------------------

const communityCredentialPaths = new Map<string, string>();

/**
 * Register a community credential type's module path for resolution.
 * Called during startup from community package discovery.
 */
export function registerCommunityCredentialPath(typeName: string, modulePath: string): void {
  communityCredentialPaths.set(typeName, modulePath);
}

/**
 * Clear community credential paths. Useful for testing.
 */
export function clearCommunityCredentialPaths(): void {
  communityCredentialPaths.clear();
}

// ---------------------------------------------------------------------------
// Credential type name validation
// ---------------------------------------------------------------------------

const SAFE_CRED_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const VALID_CRED_FIELD_TYPES = new Set<CredentialFieldType>([
  'string',
  'number',
  'boolean',
  'password',
  'url',
  'options',
  'hidden',
]);

function toCredentialFieldType(raw: unknown): CredentialFieldType {
  if (typeof raw === 'string' && VALID_CRED_FIELD_TYPES.has(raw as CredentialFieldType)) {
    return raw as CredentialFieldType;
  }
  return 'string';
}

/**
 * Validate that a credential type name is safe for use in require() paths.
 * Rejects names containing path traversal characters or other unsafe patterns.
 */
function sanitizeCredTypeName(name: string): string | null {
  if (SAFE_CRED_TYPE_PATTERN.test(name)) return name;
  return null;
}

// ---------------------------------------------------------------------------
// Credential module loading helper
// ---------------------------------------------------------------------------

/**
 * Try to load a credential class from a given module path.
 * Returns a new instance or null if loading fails.
 */
function loadCredentialInstance(
  modulePath: string,
  className?: string,
): Record<string, unknown> | null {
  try {
    const mod = getRequire()(modulePath);
    const CredClass =
      (className ? mod[className] : undefined) ??
      mod.default ??
      Object.values(mod).find(
        (v: unknown) =>
          typeof v === 'function' &&
          (v as { prototype?: { name?: unknown } }).prototype?.name !== undefined,
      ) ??
      Object.values(mod).find((v: unknown) => typeof v === 'function');
    if (!CredClass || typeof CredClass !== 'function') return null;
    return new (CredClass as new () => Record<string, unknown>)();
  } catch (err) {
    if (process.env.NATHAN_DEBUG) {
      console.error(`[nathan] Failed to load credential module ${modulePath}: ${err}`);
    }
    return null;
  }
}

/**
 * Resolve the module path for a credential type.
 * Checks community registry first, then falls back to n8n-nodes-base.
 */
function resolveCredentialModulePath(
  safeName: string,
): { modulePath: string; pascalName: string } | null {
  // Check community registry first
  const communityPath = communityCredentialPaths.get(safeName);
  if (communityPath) {
    const pascalName = safeName.charAt(0).toUpperCase() + safeName.slice(1);
    return { modulePath: communityPath, pascalName };
  }

  // Fall back to n8n-nodes-base
  const pascalName = safeName.charAt(0).toUpperCase() + safeName.slice(1);
  return {
    modulePath: `n8n-nodes-base/dist/credentials/${pascalName}.credentials.js`,
    pascalName,
  };
}

// ---------------------------------------------------------------------------
// Credential type definition (field introspection)
// ---------------------------------------------------------------------------

/**
 * Dynamically load an n8n credential type definition.
 *
 * Returns a CredentialTypeInfo (core type) directly, so the composition root
 * can register this function as an introspection strategy without mapping.
 *
 * Checks community credential registry first, then falls back to n8n-nodes-base.
 *
 * Example: "githubApi" -> loads GithubApi.credentials.js -> returns properties, authenticate, test.
 */
export function loadCredentialTypeDefinition(credTypeName: string): CredentialTypeInfo | null {
  const safeName = sanitizeCredTypeName(credTypeName);
  if (!safeName) return null;

  const resolved = resolveCredentialModulePath(safeName);
  if (!resolved) return null;

  const instance = loadCredentialInstance(resolved.modulePath, resolved.pascalName);
  if (!instance) return null;

  try {
    const properties: CredentialField[] = (
      (instance.properties ?? []) as Array<Record<string, unknown>>
    ).map((p) => {
      const isPassword = (p.typeOptions as Record<string, unknown> | undefined)?.password === true;
      const hasEmptyDefault = p.default === '' || p.default === undefined;
      return {
        name: String(p.name ?? ''),
        displayName: String(p.displayName ?? p.name ?? ''),
        type: toCredentialFieldType(p.type),
        default: p.default,
        isPassword,
        required: p.required === true || (isPassword && hasEmptyDefault),
        description: p.description as string | undefined,
      };
    });

    // Normalize n8n authenticate config into core CredentialAuthConfig
    const rawAuth = instance.authenticate as
      | IAuthenticateGeneric
      | { type: 'custom'; properties: Record<string, unknown> }
      | null
      | undefined;
    const authenticate: CredentialTypeInfo['authenticate'] =
      rawAuth?.type === 'generic' && rawAuth.properties
        ? {
            headers: rawAuth.properties.headers,
            queryParams: rawAuth.properties.qs,
            body: rawAuth.properties.body,
            basicAuth: rawAuth.properties.auth,
          }
        : null;

    // Normalize n8n test config (drop `rules` — not used in core)
    const rawTest = instance.test as
      | { request: Record<string, unknown>; rules?: unknown }
      | null
      | undefined;
    const test: CredentialTypeInfo['test'] = rawTest?.request
      ? {
          request: {
            method: rawTest.request.method as HttpMethod | undefined,
            url: rawTest.request.url as string | undefined,
            baseURL: rawTest.request.baseURL as string | undefined,
            headers: rawTest.request.headers as Record<string, string> | undefined,
            qs: rawTest.request.qs as Record<string, string> | undefined,
          },
        }
      : null;

    return {
      name: String(instance.name ?? credTypeName),
      displayName: String(instance.displayName ?? credTypeName),
      properties,
      authenticate,
      test,
    };
  } catch (err) {
    if (process.env.NATHAN_DEBUG) {
      console.error(`[nathan] Failed to parse credential type ${credTypeName}: ${err}`);
    }
    return null;
  }
}

/**
 * Load the `authenticate` config from an n8n credential type.
 * Translates from n8n's IAuthenticateGeneric to core's CredentialAuthConfig.
 * Used by the execution shim and declarative executor to inject credentials.
 *
 * Checks community credential registry first, then falls back to n8n-nodes-base.
 */
export function loadCredentialAuthenticate(credentialType: string): CredentialAuthConfig | null {
  const safeName = sanitizeCredTypeName(credentialType);
  if (!safeName) return null;

  const resolved = resolveCredentialModulePath(safeName);
  if (!resolved) return null;

  const instance = loadCredentialInstance(resolved.modulePath, resolved.pascalName);
  if (!instance) return null;

  const auth = instance.authenticate;
  if (auth && typeof auth === 'object' && (auth as Record<string, unknown>).type === 'generic') {
    const generic = auth as IAuthenticateGeneric;
    return {
      headers: generic.properties?.headers,
      queryParams: generic.properties?.qs,
      body: generic.properties?.body,
      basicAuth: generic.properties?.auth,
    };
  }

  return null;
}

/**
 * Resolve an n8n credential expression like '=token {{$credentials?.accessToken}}'
 * by substituting credential values.
 */
export function resolveCredentialExpression(
  template: string,
  credentials: Record<string, unknown>,
): string {
  let expr = template.startsWith('=') ? template.slice(1) : template;
  expr = expr.replace(/\{\{\s*\$credentials\??\.\s*(\w+)\s*\}\}/g, (_match, key) => {
    const val = credentials[key];
    return val !== undefined ? String(val) : '';
  });
  return expr;
}

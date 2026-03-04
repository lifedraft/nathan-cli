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
// Credential type name validation
// ---------------------------------------------------------------------------

const SAFE_CRED_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

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
// Credential type definition (field introspection)
// ---------------------------------------------------------------------------

/**
 * Dynamically load an n8n credential type definition.
 *
 * Returns a CredentialTypeInfo (core type) directly, so the composition root
 * can register this function as an introspection strategy without mapping.
 *
 * Example: "githubApi" -> loads GithubApi.credentials.js -> returns properties, authenticate, test.
 */
export function loadCredentialTypeDefinition(credTypeName: string): CredentialTypeInfo | null {
  const safeName = sanitizeCredTypeName(credTypeName);
  if (!safeName) return null;

  try {
    const pascalName = safeName.charAt(0).toUpperCase() + safeName.slice(1);
    const mod = getRequire()(`n8n-nodes-base/dist/credentials/${pascalName}.credentials.js`);
    const CredClass = mod[pascalName] ?? mod.default ?? Object.values(mod)[0];
    if (!CredClass || typeof CredClass !== 'function') return null;

    const instance = new (CredClass as new () => Record<string, unknown>)();
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
  } catch {
    return null;
  }
}

/**
 * Load the `authenticate` config from an n8n credential type.
 * Translates from n8n's IAuthenticateGeneric to core's CredentialAuthConfig.
 * Used by the execution shim to inject credentials into HTTP requests.
 */
export function loadCredentialAuthenticate(credentialType: string): CredentialAuthConfig | null {
  const safeName = sanitizeCredTypeName(credentialType);
  if (!safeName) return null;

  try {
    const pascalName = safeName.charAt(0).toUpperCase() + safeName.slice(1);
    const mod = getRequire()(`n8n-nodes-base/dist/credentials/${pascalName}.credentials.js`);
    const CredClass = mod[pascalName] ?? mod.default ?? Object.values(mod)[0];
    if (CredClass && typeof CredClass === 'function') {
      const instance = new (CredClass as new () => Record<string, unknown>)();
      const auth = instance.authenticate;
      if (
        auth &&
        typeof auth === 'object' &&
        (auth as Record<string, unknown>).type === 'generic'
      ) {
        const generic = auth as IAuthenticateGeneric;
        return {
          headers: generic.properties?.headers,
          queryParams: generic.properties?.qs,
          body: generic.properties?.body,
          basicAuth: generic.properties?.auth,
        };
      }
    }
  } catch {}
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

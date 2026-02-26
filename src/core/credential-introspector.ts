/**
 * Credential type introspection interface.
 *
 * Abstracts over credential type systems (external adapters, YAML, etc.) so that
 * commands can discover credential fields without importing from
 * specific compatibility layers.
 */

import type { CredentialAuthConfig, HttpMethod } from "./plugin-interface.js";

/**
 * A single field in a credential type definition.
 */
/** Known credential field types. Covers YAML plugin fields and common adapter property types. */
export type CredentialFieldType = "string" | "number" | "boolean" | "password" | "url" | "options" | "hidden";

export interface CredentialField {
  name: string;
  displayName: string;
  type: CredentialFieldType;
  default?: unknown;
  isPassword: boolean;
  required: boolean;
  description?: string;
}

/**
 * Full credential type definition with field info, auth config, and test endpoint.
 */
export interface CredentialTypeInfo {
  name: string;
  displayName: string;
  properties: CredentialField[];
  /** How credentials are injected into requests. */
  authenticate: CredentialAuthConfig | null;
  /** Test endpoint for validating credentials. */
  test: {
    request: {
      method?: HttpMethod;
      url?: string;
      baseURL?: string;
      headers?: Record<string, string>;
      qs?: Record<string, string>;
    };
  } | null;
}

/**
 * Strategy for resolving credential expressions (e.g. "={{$credentials?.accessToken}}").
 */
export type CredentialExpressionResolver = (
  template: string,
  credentials: Record<string, unknown>,
) => string;

/**
 * Strategy for loading credential type definitions.
 * Returns null if the credential type is not recognized by this strategy.
 */
export type CredentialIntrospectionStrategy = (
  credTypeName: string,
) => CredentialTypeInfo | null;

// Module-level strategies (registered at startup by the composition root)
const introspectionStrategies: CredentialIntrospectionStrategy[] = [];
let expressionResolver: CredentialExpressionResolver = (template) => template;

/**
 * Register a credential introspection strategy.
 */
export function registerCredentialIntrospectionStrategy(strategy: CredentialIntrospectionStrategy): void {
  introspectionStrategies.push(strategy);
}

/**
 * Register a credential expression resolver.
 */
export function registerCredentialExpressionResolver(resolver: CredentialExpressionResolver): void {
  expressionResolver = resolver;
}

/**
 * Clear all registered introspection strategies. Useful for testing.
 */
export function clearCredentialIntrospectionStrategies(): void {
  introspectionStrategies.length = 0;
}

/**
 * Reset the expression resolver to the default passthrough. Useful for testing.
 */
export function clearCredentialExpressionResolver(): void {
  expressionResolver = (template) => template;
}

/**
 * Load credential type info by trying all registered strategies.
 */
export function loadCredentialType(credTypeName: string): CredentialTypeInfo | null {
  for (const strategy of introspectionStrategies) {
    const result = strategy(credTypeName);
    if (result) return result;
  }
  return null;
}

/**
 * Resolve credential expressions using the registered resolver.
 */
export function resolveCredentialExpr(
  template: string,
  credentials: Record<string, unknown>,
): string {
  return expressionResolver(template, credentials);
}

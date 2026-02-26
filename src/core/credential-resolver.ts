/**
 * Silent credential resolution chain.
 *
 * At runtime (agent mode), credentials must resolve without any interaction.
 * Resolution order:
 * 1. Environment variables (NATHAN_<SERVICE>_TOKEN, NATHAN_<SERVICE>_<FIELD>)
 * 2. Credential store (encrypted on-disk storage)
 *
 * For n8n nodes, credentials are keyed by credential type name (e.g. "githubApi")
 * and the node expects an object with specific fields (e.g. { accessToken, server }).
 *
 * Env var mapping:
 *   NATHAN_GITHUB_TOKEN     -> githubApi.accessToken + githubApi.token
 *   NATHAN_GITHUB_SERVER    -> githubApi.server
 *   GITHUB_TOKEN            -> githubApi.accessToken (fallback)
 *   NATHAN_<SERVICE>_<FIELD> -> <credType>.<field>
 */

import type { PluginDescriptor } from "./plugin-interface.js";
import { createCredentialStore } from "./credential-store.js";

/**
 * Resolve credentials for a plugin from environment variables and the
 * credential store. Returns a flat Record<string, string> that the
 * plugin's execute() can pass to the n8n shim or HTTP executor.
 *
 * For n8n-compat plugins, this builds the credential objects that
 * getCredentials() returns (keyed by credential type name).
 */
export async function resolveCredentialsForPlugin(
  descriptor: PluginDescriptor,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const serviceName = descriptor.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  // --- 1. Environment variables (always win) ---

  const token =
    process.env[`NATHAN_${serviceName}_TOKEN`] ??
    process.env[`${serviceName}_TOKEN`] ??
    process.env[`NATHAN_${serviceName}_API_KEY`] ??
    process.env[`${serviceName}_API_KEY`];

  if (token) {
    for (const cred of descriptor.credentials) {
      result[cred.name] = token;
    }
  }

  // Service-specific field overrides from env
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const prefix = `NATHAN_${serviceName}_`;
    if (key.startsWith(prefix) && key !== `${prefix}TOKEN` && key !== `${prefix}API_KEY`) {
      const field = key.slice(prefix.length).toLowerCase();
      result[`__field_${field}`] = value;
    }
  }

  // If env vars provided credentials, return early (env always wins)
  if (token) {
    return result;
  }

  // --- 2. Credential store fallback ---

  try {
    const store = createCredentialStore();
    const stored = await store.get(descriptor.name);
    if (stored) {
      // Map stored fields to the flat format expected by buildN8nCredentials.
      // The credential type name maps to the "token" value (the primary secret field).
      // Other fields become __field_ prefixed entries.
      for (const cred of descriptor.credentials) {
        if (cred.name === stored.type) {
          // Find the primary secret field (password-type field)
          // and map it to the credential type key
          for (const [fieldName, fieldValue] of Object.entries(stored.fields)) {
            // Set all field values as __field_ entries
            if (!result[`__field_${fieldName}`]) {
              result[`__field_${fieldName}`] = fieldValue;
            }
          }

          // Also set the credential type name to the token/secret value
          // Try common secret field names
          const secretValue =
            stored.fields.accessToken ??
            stored.fields.token ??
            stored.fields.apiKey ??
            stored.fields.password ??
            Object.values(stored.fields)[0];

          if (secretValue) {
            result[cred.name] = secretValue;
          }
        }
      }
    }
  } catch {
    // Credential store unavailable (no master key, etc.) — continue with empty
  }

  return result;
}

/**
 * Build the n8n credential objects from resolved credentials.
 * n8n nodes call getCredentials('githubApi') and expect an object like
 * { accessToken: "...", server: "https://api.github.com" }.
 *
 * This function builds those objects from the flat credential map.
 */
export function buildN8nCredentials(
  flatCredentials: Record<string, string>,
  credentialTypes: string[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const credType of credentialTypes) {
    const token = flatCredentials[credType];
    if (!token) continue;

    // Build the credential object with common field names
    const cred: Record<string, unknown> = {
      accessToken: token,
      token: token,
      apiKey: token,
    };

    // Add any field-specific overrides
    for (const [key, value] of Object.entries(flatCredentials)) {
      if (key.startsWith("__field_")) {
        cred[key.slice(8)] = value; // strip __field_ prefix
      }
    }

    result[credType] = cred;
  }

  return result;
}

/**
 * Silent credential resolution chain.
 *
 * At runtime (agent mode), credentials must resolve without any interaction.
 * Resolution order:
 * 1. Environment variables (NATHAN_<SERVICE>_TOKEN, NATHAN_<SERVICE>_<FIELD>)
 * 2. Credential store (encrypted on-disk storage)
 *
 * Returns ResolvedCredentials[] — one entry per credential type declared by the plugin.
 */

import type { PluginDescriptor, ResolvedCredentials } from "./plugin-interface.js";
import type { CredentialStore } from "./credential-store.js";
import { createCredentialStore } from "./credential-store.js";

/**
 * Resolve credentials for a plugin from environment variables and the
 * credential store. Returns a ResolvedCredentials[] array — one entry per
 * credential type declared by the plugin.
 *
 * Accepts an optional `store` parameter for dependency injection (testing,
 * alternative backends). Falls back to `createCredentialStore()` if not provided.
 */
export async function resolveCredentialsForPlugin(
  descriptor: PluginDescriptor,
  options?: { store?: CredentialStore; env?: Record<string, string | undefined> },
): Promise<ResolvedCredentials[]> {
  if (descriptor.credentials.length === 0) return [];

  const env = options?.env ?? process.env;
  const serviceName = descriptor.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  // --- 1. Environment variables (always win) ---

  const token =
    env[`NATHAN_${serviceName}_TOKEN`] ??
    env[`${serviceName}_TOKEN`] ??
    env[`NATHAN_${serviceName}_API_KEY`] ??
    env[`${serviceName}_API_KEY`];

  // Collect service-specific field overrides from env
  const envFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    const prefix = `NATHAN_${serviceName}_`;
    if (key.startsWith(prefix) && key !== `${prefix}TOKEN` && key !== `${prefix}API_KEY`) {
      const field = key.slice(prefix.length).toLowerCase();
      envFields[field] = value;
    }
  }

  if (token) {
    return descriptor.credentials.map((cred) => ({
      typeName: cred.name,
      primarySecret: token,
      fields: { ...envFields },
    }));
  }

  // --- 2. Credential store fallback ---

  try {
    const credStore = options?.store ?? createCredentialStore();
    const stored = await credStore.get(descriptor.name);
    if (stored) {
      return descriptor.credentials
        .filter((cred) => cred.name === stored.type)
        .map((cred) => {
          const secretValue =
            stored.fields.accessToken ??
            stored.fields.token ??
            stored.fields.apiKey ??
            stored.fields.password ??
            Object.values(stored.fields)[0];

          // Merge env fields over store fields (env always wins)
          const mergedFields = { ...stored.fields, ...envFields };

          return {
            typeName: cred.name,
            primarySecret: secretValue,
            fields: mergedFields,
          };
        });
    }
  } catch (err) {
    // Log credential store failures so they are not completely invisible
    if (env.NATHAN_DEBUG) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[nathan] Credential store error: ${msg}`);
    }
  }

  // Return empty credentials (no secret, no fields) for each declared type
  return descriptor.credentials.map((cred) => ({
    typeName: cred.name,
    primarySecret: undefined,
    fields: { ...envFields },
  }));
}

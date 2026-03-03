/**
 * Silent credential resolution from environment variables.
 *
 * At runtime (agent mode), credentials must resolve without any interaction.
 * Resolution: environment variables (NATHAN_<SERVICE>_TOKEN, NATHAN_<SERVICE>_<FIELD>)
 *
 * Returns ResolvedCredentials[] — one entry per credential type declared by the plugin.
 */

import type { PluginDescriptor, ResolvedCredentials } from './plugin-interface.js';

/**
 * Normalise a service name to the upper-case env var prefix form.
 */
function toEnvPrefix(serviceName: string): string {
  return serviceName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Return the 4 env var names that are probed for a service's primary secret.
 */
export function getExpectedEnvVarNames(serviceName: string): string[] {
  const s = toEnvPrefix(serviceName);
  return [`NATHAN_${s}_TOKEN`, `${s}_TOKEN`, `NATHAN_${s}_API_KEY`, `${s}_API_KEY`];
}

/**
 * Check whether any of the expected credential env vars are set for the plugin.
 */
export function hasConfiguredCredentials(
  descriptor: PluginDescriptor,
  env?: Record<string, string | undefined>,
): boolean {
  if (descriptor.credentials.length === 0) return false;
  const e = env ?? process.env;
  return getExpectedEnvVarNames(descriptor.name).some((k) => !!e[k]);
}

/**
 * Fail-fast check: if a plugin requires credentials but none are configured,
 * return a structured error result. Otherwise return null.
 */
export function checkCredentialsConfigured(
  descriptor: PluginDescriptor,
  resolved: ResolvedCredentials[],
): { error: { code: string; message: string; env_vars: string[] } } | null {
  if (descriptor.credentials.length === 0) return null;
  const allMissing = resolved.every((c) => c.primarySecret === undefined);
  if (!allMissing) return null;

  const envVars = getExpectedEnvVarNames(descriptor.name);
  return {
    error: {
      code: 'CREDENTIALS_MISSING',
      message:
        `Authentication required for "${descriptor.name}". Set one of:\n` +
        envVars.map((v) => `  export ${v}=<your-token>`).join('\n'),
      env_vars: envVars,
    },
  };
}

/**
 * Resolve credentials for a plugin from environment variables.
 * Returns a ResolvedCredentials[] array — one entry per credential type
 * declared by the plugin.
 */
export async function resolveCredentialsForPlugin(
  descriptor: PluginDescriptor,
  options?: { env?: Record<string, string | undefined> },
): Promise<ResolvedCredentials[]> {
  if (descriptor.credentials.length === 0) return [];

  const env = options?.env ?? process.env;
  const serviceName = toEnvPrefix(descriptor.name);

  // --- Environment variables ---

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

  // Return empty credentials (no secret, no fields) for each declared type
  return descriptor.credentials.map((cred) => ({
    typeName: cred.name,
    primarySecret: undefined,
    fields: { ...envFields },
  }));
}

/**
 * n8n node loader — loads n8n INodeType instances and wraps them as nathan Plugins.
 *
 * Moved out of core/plugin-loader.ts so that the core layer has no dependency
 * on n8n-compat types. This module is registered as a loader strategy by the
 * composition root.
 */

import { buildCredentialObject } from '../core/credential-injector.js';
import { loadCredentialType } from '../core/credential-introspector.js';
import {
  findResource,
  findOperation,
  type Plugin,
  type Result,
  type ResolvedCredentials,
} from '../core/plugin-interface.js';
import { adaptNodeTypeDescription } from './adapter.js';
import { executeDeclarativeRouting } from './declarative-executor.js';
import { createExecutionContext } from './execution-shim.js';
import { getRequire } from './require.js';
import type { INodeType } from './types.js';

/**
 * Build the n8n credential objects from ResolvedCredentials[].
 * n8n nodes call getCredentials('githubApi') and expect an object like
 * { accessToken: "...", server: "https://api.github.com" }.
 *
 * Enhanced with credential field mapping: loads the credential type definition
 * to map `primarySecret` to the correct field name (e.g. `apiToken` for
 * Confluence Cloud) and maps lowercased env var field names to the correct
 * camelCase names from the credential definition.
 */
export function buildN8nCredentials(
  credentials: ResolvedCredentials[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const cred of credentials) {
    if (!cred.primarySecret && Object.keys(cred.fields).length === 0) continue;

    const obj = buildCredentialObject(cred);

    // Try to load the credential type definition for field mapping
    const credTypeInfo = loadCredentialType(cred.typeName);
    if (credTypeInfo) {
      // Map lowercased env var field names to correct camelCase names
      const lowerToCorrect = new Map<string, string>();
      for (const prop of credTypeInfo.properties) {
        lowerToCorrect.set(prop.name.toLowerCase(), prop.name);
      }

      for (const [key, value] of Object.entries(obj)) {
        const correctKey = lowerToCorrect.get(key.toLowerCase());
        if (correctKey && correctKey !== key) {
          // Set the correctly-cased field
          if (obj[correctKey] === undefined) {
            obj[correctKey] = value;
          }
          delete obj[key];
        }
      }

      // Map primarySecret to the credential type's password field if not already set
      if (cred.primarySecret) {
        const passwordField = credTypeInfo.properties.find((p) => p.isPassword);
        if (passwordField && obj[passwordField.name] === undefined) {
          obj[passwordField.name] = cred.primarySecret;
        }
      }
    }

    result[cred.typeName] = obj;
  }

  return result;
}

/**
 * Wrap an n8n INodeType instance as a nathan Plugin.
 */
function loadN8nNode(nodeInstance: INodeType): Plugin {
  const descriptor = adaptNodeTypeDescription(nodeInstance.description);

  const plugin: Plugin = {
    descriptor,
    async execute(resource, operation, params, credentials): Promise<Result> {
      if (nodeInstance.execute) {
        try {
          const credMap = buildN8nCredentials(credentials);

          // Look up operation metadata for better error messages
          const res = findResource(descriptor, resource);
          const op = res ? findOperation(res, operation) : undefined;

          const ctx = createExecutionContext({
            params: { resource, operation, ...params },
            credentials: credMap,
            nodeProperties: nodeInstance.description.properties,
            operationMeta: op
              ? {
                  resource,
                  operation,
                  requiredParams: op.parameters.filter((p) => p.required).map((p) => p.name),
                }
              : undefined,
          });

          const result = await nodeInstance.execute.call(ctx);

          if (!result) return { success: true, data: [] };
          const flatData = result
            .flat()
            .filter((item) => item?.json)
            .map((item) => item.json);
          return {
            success: true,
            data: flatData.length === 1 ? flatData[0] : flatData,
          };
        } catch (err) {
          return {
            success: false,
            error: {
              code: 'EXECUTION_ERROR',
              message: err instanceof Error ? err.message : String(err),
              details: process.env.NATHAN_DEBUG && err instanceof Error ? err.stack : undefined,
            },
          };
        }
      }

      // For declarative nodes (no execute method), use the declarative routing executor
      // which resolves n8n expressions and interprets routing metadata.
      // Pass the pre-built credential map so expressions like {{$credentials.apiToken}}
      // resolve correctly with enhanced field mapping.
      const credMap = buildN8nCredentials(credentials);
      return executeDeclarativeRouting({
        nodeDescription: nodeInstance.description,
        resource,
        operation,
        params,
        credentials,
        credentialMap: credMap,
      });
    },
  };

  return plugin;
}

/**
 * Load an n8n node from a module path (require the .node.js file).
 */
export async function loadN8nNodeFromPath(modulePath: string): Promise<Plugin> {
  const mod = getRequire()(modulePath);
  const NodeClass =
    mod.default ??
    Object.values(mod).find(
      (v: unknown) =>
        typeof v === 'function' &&
        (v as { prototype?: { description?: unknown } }).prototype?.description,
    ) ??
    Object.values(mod).find((v: unknown) => typeof v === 'function');

  if (!NodeClass || typeof NodeClass !== 'function') {
    throw new Error(`No node class found in ${modulePath}`);
  }

  const instance = new (NodeClass as new () => INodeType & {
    nodeVersions?: Record<string, INodeType>;
  })();

  // Validate that the instance looks like an n8n node
  if (!instance.description?.name || !Array.isArray(instance.description?.properties)) {
    // Handle versioned nodes (e.g., Postgres, MySQL, Slack)
    if (instance.nodeVersions && typeof instance.nodeVersions === 'object') {
      const versions = Object.keys(instance.nodeVersions).toSorted((a, b) => Number(a) - Number(b));
      const latestKey = versions[versions.length - 1];
      const latestNode = instance.nodeVersions[latestKey];
      if (latestNode?.description?.properties) {
        return loadN8nNode(latestNode);
      }
    }
    throw new Error(`Module ${modulePath} does not export a valid n8n node`);
  }

  // Handle versioned nodes (e.g., Postgres, MySQL, Slack)
  if (instance.nodeVersions && typeof instance.nodeVersions === 'object') {
    const versions = Object.keys(instance.nodeVersions).toSorted((a, b) => Number(a) - Number(b));
    const latestKey = versions[versions.length - 1];
    const latestNode = instance.nodeVersions[latestKey];
    if (latestNode?.description?.properties) {
      return loadN8nNode(latestNode);
    }
  }

  return loadN8nNode(instance);
}

// ---------------------------------------------------------------------------
// Module path validation
// ---------------------------------------------------------------------------

const SAFE_MODULE_PATTERN = /^[a-zA-Z0-9@][a-zA-Z0-9\-_./]*$/;

/**
 * Validate that a module path from a YAML manifest is safe.
 * Rejects path traversal (../) and absolute paths.
 */
export function validateModulePath(modulePath: string): boolean {
  if (modulePath.includes('..')) return false;
  if (modulePath.startsWith('/')) return false;
  return SAFE_MODULE_PATTERN.test(modulePath);
}

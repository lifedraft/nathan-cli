/**
 * Unified plugin loader.
 *
 * Supports loading plugins from:
 * - YAML declarative definitions
 * - n8n-compatible node descriptions
 * - Native TypeScript plugins
 */

import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Plugin, PluginDescriptor, CredentialSpec, Resource, Result } from "./plugin-interface.js";
import { executeOperation, type ExecutorOptions } from "./executor.js";
import { adaptNodeTypeDescription } from "../n8n-compat/adapter.js";
import { createExecutionContext } from "../n8n-compat/execution-shim.js";
import { buildN8nCredentials } from "./credential-resolver.js";
import type { INodeType, INodeTypeDescription } from "../n8n-compat/types.js";

/** Registry of loaded plugins, keyed by plugin name. */
const pluginRegistry = new Map<string, Plugin>();

/**
 * Load a declarative plugin from a YAML file.
 */
export async function loadYamlPlugin(filePath: string): Promise<Plugin> {
  const raw = await readFile(filePath, "utf-8");
  const manifest = parseYaml(raw);

  const descriptor: PluginDescriptor = {
    name: manifest.name,
    displayName: manifest.displayName ?? manifest.name,
    description: manifest.description ?? "",
    version: manifest.version ?? "0.0.0",
    type: "declarative",
    credentials: (manifest.credentials ?? []) as CredentialSpec[],
    resources: (manifest.resources ?? []).map((r: any) => ({
      name: r.name,
      displayName: r.displayName ?? r.name,
      description: r.description ?? "",
      operations: (r.operations ?? []).map((op: any) => ({
        name: op.name,
        displayName: op.displayName ?? op.name,
        description: op.description ?? "",
        method: op.method ?? "GET",
        path: op.path ?? "/",
        parameters: (op.parameters ?? []).map((p: any) => ({
          name: p.name,
          displayName: p.displayName ?? p.name,
          description: p.description ?? "",
          type: p.type ?? "string",
          required: p.required ?? false,
          default: p.default,
          location: p.location ?? "query",
          options: p.options,
        })),
        output: op.output ?? { format: "json" },
        requiresAuth: false,
      })),
    })) as Resource[],
  };

  const baseUrl = manifest.baseURL ?? manifest.baseUrl ?? "";

  const plugin: Plugin = {
    descriptor,
    async execute(resource, operation, params, credentials) {
      const res = descriptor.resources.find((r) => r.name === resource);
      if (!res) {
        return {
          success: false,
          error: {
            code: "UNKNOWN_RESOURCE",
            message: `Unknown resource "${resource}". Available: ${descriptor.resources.map((r) => r.name).join(", ")}`,
          },
        };
      }

      const op = res.operations.find((o) => o.name === operation);
      if (!op) {
        return {
          success: false,
          error: {
            code: "UNKNOWN_OPERATION",
            message: `Unknown operation "${operation}" on resource "${resource}". Available: ${res.operations.map((o) => o.name).join(", ")}`,
          },
        };
      }

      const execOptions: ExecutorOptions = {
        baseUrl,
        credentials,
      };

      return executeOperation(op, params, execOptions);
    },
  };

  return plugin;
}

/**
 * Load an n8n node and wrap it as a nathan Plugin.
 */
export function loadN8nNode(nodeInstance: INodeType): Plugin {
  const descriptor = adaptNodeTypeDescription(nodeInstance.description);

  const plugin: Plugin = {
    descriptor,
    async execute(resource, operation, params, credentials): Promise<Result> {
      // If the node has an execute method, use the shim to run it
      if (nodeInstance.execute) {
        try {
          const credTypes = descriptor.credentials.map((c) => c.name);
          const credMap = buildN8nCredentials(credentials, credTypes);

          const ctx = createExecutionContext({
            params: { resource, operation, ...params },
            credentials: credMap,
          });

          const result = await nodeInstance.execute.call(ctx);

          // n8n returns INodeExecutionData[][] — flatten to array of json objects
          const flatData = result.flat().map((item) => item.json);
          return {
            success: true,
            data: flatData.length === 1 ? flatData[0] : flatData,
          };
        } catch (err) {
          return {
            success: false,
            error: {
              code: "N8N_EXECUTION_ERROR",
              message: err instanceof Error ? err.message : String(err),
              details: err instanceof Error ? err.stack : undefined,
            },
          };
        }
      }

      // For declarative nodes (no execute method), use the routing info
      // from the descriptor to make HTTP calls via the generic executor
      const res = descriptor.resources.find((r) => r.name === resource);
      const op = res?.operations.find((o) => o.name === operation);
      if (!res || !op) {
        return {
          success: false,
          error: {
            code: "UNKNOWN_OPERATION",
            message: `Unknown: ${resource}/${operation}`,
          },
        };
      }

      const baseUrl = nodeInstance.description.requestDefaults?.baseURL ?? "";
      return executeOperation(op, params, { baseUrl, credentials });
    },
  };

  return plugin;
}

/**
 * Load an n8n node from a module path (require the .node.js file).
 */
export async function loadN8nNodeFromPath(modulePath: string): Promise<Plugin> {
  const mod = require(modulePath);
  // n8n nodes export the class as default or as a named export
  const NodeClass = mod.default ?? Object.values(mod).find(
    (v: any) => typeof v === "function" && v.prototype?.description,
  ) ?? Object.values(mod).find(
    (v: any) => typeof v === "function",
  );

  if (!NodeClass || typeof NodeClass !== "function") {
    throw new Error(`No node class found in ${modulePath}`);
  }

  const instance = new (NodeClass as any)();

  // Handle versioned nodes (e.g., Postgres, MySQL, Slack)
  // They have a nodeVersions map with sub-instances per version.
  if (instance.nodeVersions && typeof instance.nodeVersions === "object") {
    const versions = Object.keys(instance.nodeVersions);
    const latestKey = versions[versions.length - 1];
    const latestNode = instance.nodeVersions[latestKey];
    if (latestNode?.description?.properties) {
      return loadN8nNode(latestNode as INodeType);
    }
  }

  return loadN8nNode(instance as INodeType);
}

/**
 * Load all YAML plugins from a directory.
 */
export async function loadPluginsFromDir(dirPath: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return; // Directory doesn't exist, that's fine
  }

  for (const entry of entries) {
    const ext = extname(entry);
    if (ext === ".yaml" || ext === ".yml") {
      try {
        const raw = await readFile(join(dirPath, entry), "utf-8");
        const manifest = parseYaml(raw);

        if (manifest.type === "n8n-compat" && manifest.module) {
          // Resolve the n8n node module path
          const modulePath = join(process.cwd(), "node_modules", manifest.module);
          const plugin = await loadN8nNodeFromPath(modulePath);
          registerPlugin(plugin);
        } else {
          const plugin = await loadYamlPlugin(join(dirPath, entry));
          registerPlugin(plugin);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (process.env.NATHAN_DEBUG) {
          console.error(`Failed to load plugin ${entry}: ${msg}`);
        }
      }
    }
  }
}

/**
 * Register a plugin in the global registry.
 */
export function registerPlugin(plugin: Plugin): void {
  pluginRegistry.set(plugin.descriptor.name, plugin);
}

/**
 * Get a plugin by name.
 */
export function getPlugin(name: string): Plugin | undefined {
  return pluginRegistry.get(name);
}

/**
 * Get all registered plugins.
 */
export function getAllPlugins(): Plugin[] {
  return Array.from(pluginRegistry.values());
}

/**
 * Clear the plugin registry. Useful for testing.
 */
export function clearRegistry(): void {
  pluginRegistry.clear();
}

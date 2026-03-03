/**
 * Plugin loader.
 *
 * Supports loading plugins from:
 * - YAML declarative definitions
 * - Pluggable loader strategies (e.g., adapted nodes, native TS)
 *
 * Adapter-specific loading logic lives in dedicated loader modules.
 * The plugin registry has been moved to plugin-registry.ts.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

import { parse as parseYaml } from 'yaml';

/** Type predicate for Node.js filesystem errors with an error code. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

import { executeOperation } from './executor.js';
import type { ExecutorOptions } from './executor.js';
import {
  findResource,
  findOperation,
  type Plugin,
  type PluginDescriptor,
  type CredentialSpec,
  type Resource,
  type HttpMethod,
  type ParameterType,
  type ParameterLocation,
  type OutputFormat,
} from './plugin-interface.js';
import type { PluginRegistry } from './plugin-registry.js';

// ---------------------------------------------------------------------------
// Runtime validators for union types (YAML is untrusted input)
// ---------------------------------------------------------------------------

const VALID_HTTP_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
const VALID_PARAM_TYPES = new Set<ParameterType>([
  'string',
  'number',
  'boolean',
  'object',
  'array',
]);
const VALID_PARAM_LOCATIONS = new Set<ParameterLocation>([
  'query',
  'path',
  'header',
  'body',
  'cookie',
]);
const VALID_CRED_TYPES = new Set<CredentialSpec['type']>([
  'api_key',
  'oauth2',
  'bearer',
  'basic',
  'custom',
]);
const VALID_FIELD_TYPES = new Set<'string' | 'password' | 'url'>(['string', 'password', 'url']);
const VALID_OUTPUT_FORMATS = new Set<OutputFormat>(['json', 'text', 'binary']);

function validateEnum<T extends string>(
  value: unknown,
  valid: Set<T>,
  fallback: T,
  label: string,
): T {
  if (typeof value === 'string' && valid.has(value as T)) return value as T;
  if (value !== undefined && value !== null) {
    console.error(`[nathan] Warning: Invalid ${label} "${String(value)}", using "${fallback}"`);
  }
  return fallback;
}

function validateOutputSpec(raw: unknown): {
  format: OutputFormat;
  schema?: Record<string, unknown>;
  description?: string;
} {
  if (typeof raw !== 'object' || raw === null) return { format: 'json' };
  const obj = raw as Record<string, unknown>;
  return {
    format: validateEnum(obj.format, VALID_OUTPUT_FORMATS, 'json', 'output format'),
    schema:
      typeof obj.schema === 'object' && obj.schema !== null
        ? (obj.schema as Record<string, unknown>)
        : undefined,
    description: typeof obj.description === 'string' ? obj.description : undefined,
  };
}

// ---------------------------------------------------------------------------
// Loader strategy pattern
// ---------------------------------------------------------------------------

/**
 * A strategy that can load a plugin from a YAML manifest.
 * Returns a Plugin if the strategy handles this manifest type, null otherwise.
 */
export type LoaderStrategy = (
  filePath: string,
  manifest: Record<string, unknown>,
) => Promise<Plugin | null>;

const loaderStrategies: LoaderStrategy[] = [];

/**
 * Register a loader strategy for handling specific manifest types.
 * Strategies are tried in registration order.
 */
export function registerLoaderStrategy(strategy: LoaderStrategy): void {
  loaderStrategies.push(strategy);
}

/**
 * Clear all registered loader strategies. Useful for testing.
 */
export function clearLoaderStrategies(): void {
  loaderStrategies.length = 0;
}

// ---------------------------------------------------------------------------
// YAML manifest interface
// ---------------------------------------------------------------------------

interface YamlManifest {
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  baseURL?: string;
  baseUrl?: string;
  type?: string;
  module?: string;
  credentials?: Array<Record<string, unknown>>;
  resources?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    operations?: Array<Record<string, unknown>>;
  }>;
}

function assertManifest(raw: unknown): YamlManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Plugin manifest must be an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string') {
    throw new TypeError("Plugin manifest must have a string 'name' field");
  }
  return {
    name: obj.name,
    displayName: typeof obj.displayName === 'string' ? obj.displayName : undefined,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    version: typeof obj.version === 'string' ? obj.version : undefined,
    baseURL: typeof obj.baseURL === 'string' ? obj.baseURL : undefined,
    baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined,
    type: typeof obj.type === 'string' ? obj.type : undefined,
    module: typeof obj.module === 'string' ? obj.module : undefined,
    credentials: Array.isArray(obj.credentials) ? obj.credentials : undefined,
    resources: Array.isArray(obj.resources) ? obj.resources : undefined,
  };
}

// ---------------------------------------------------------------------------
// YAML plugin loading
// ---------------------------------------------------------------------------

/**
 * Load a declarative plugin from a YAML file.
 */
async function loadYamlPlugin(filePath: string): Promise<Plugin> {
  const raw = await readFile(filePath, 'utf-8');
  const manifest = assertManifest(parseYaml(raw));

  const descriptor: PluginDescriptor = {
    name: manifest.name,
    displayName: manifest.displayName ?? manifest.name,
    description: manifest.description ?? '',
    version: manifest.version ?? '0.0.0',
    type: 'declarative',
    credentials: (manifest.credentials ?? []).map((c) => ({
      name: String(c.name ?? ''),
      displayName: String(c.displayName ?? c.name ?? ''),
      type: validateEnum(c.type, VALID_CRED_TYPES, 'custom', 'credential type'),
      fields: Array.isArray(c.fields)
        ? c.fields.map((f: Record<string, unknown>) => ({
            name: String(f.name ?? ''),
            displayName: String(f.displayName ?? f.name ?? ''),
            type: validateEnum(f.type, VALID_FIELD_TYPES, 'string', 'field type'),
            required: Boolean(f.required),
            default: typeof f.default === 'string' ? f.default : undefined,
            description: typeof f.description === 'string' ? f.description : undefined,
          }))
        : [],
    })),
    resources: (manifest.resources ?? []).map((r) => ({
      name: r.name,
      displayName: r.displayName ?? r.name,
      description: r.description ?? '',
      operations: (r.operations ?? []).map((op) => ({
        name: String(op.name ?? ''),
        displayName: String(op.displayName ?? op.name ?? ''),
        description: String(op.description ?? ''),
        method: validateEnum(op.method, VALID_HTTP_METHODS, 'GET', 'HTTP method'),
        path: String(op.path ?? '/'),
        parameters: Array.isArray(op.parameters)
          ? op.parameters.map((p: Record<string, unknown>) => ({
              name: String(p.name ?? ''),
              displayName: String(p.displayName ?? p.name ?? ''),
              description: String(p.description ?? ''),
              type: validateEnum(p.type, VALID_PARAM_TYPES, 'string', 'parameter type'),
              required: Boolean(p.required),
              default: p.default,
              location: validateEnum(
                p.location,
                VALID_PARAM_LOCATIONS,
                'query',
                'parameter location',
              ),
              options: Array.isArray(p.options) ? p.options : undefined,
            }))
          : [],
        output: validateOutputSpec(op.output),
        requiresAuth: false,
      })),
    })) as Resource[],
  };

  const baseUrl = manifest.baseURL ?? manifest.baseUrl ?? '';

  const plugin: Plugin = {
    descriptor,
    async execute(resource, operation, params, credentials) {
      const res = findResource(descriptor, resource);
      if (!res) {
        return {
          success: false as const,
          error: {
            code: 'UNKNOWN_RESOURCE',
            message: `Unknown resource "${resource}". Available: ${descriptor.resources.map((r) => r.name).join(', ')}`,
          },
        };
      }

      const op = findOperation(res, operation);
      if (!op) {
        return {
          success: false as const,
          error: {
            code: 'UNKNOWN_OPERATION',
            message: `Unknown operation "${operation}" on resource "${resource}". Available: ${res.operations.map((o) => o.name).join(', ')}`,
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

// ---------------------------------------------------------------------------
// Directory loading
// ---------------------------------------------------------------------------

/**
 * Load all plugins from a directory into the given registry.
 * Tries registered loader strategies first, then falls back to YAML loading.
 */
export async function loadPluginsFromDir(dirPath: string, registry: PluginRegistry): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (err: unknown) {
    // ENOENT is expected (directory doesn't exist yet). Other errors are real problems.
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return;
    }
    console.error(
      `[nathan] Warning: Cannot read plugin directory ${dirPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  for (const entry of entries) {
    const ext = extname(entry);
    if (ext === '.yaml' || ext === '.yml') {
      try {
        const filePath = join(dirPath, entry);
        const raw = await readFile(filePath, 'utf-8');
        const parsed = parseYaml(raw);

        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('Plugin manifest must be an object');
        }

        const manifest = parsed as Record<string, unknown>;

        // Try registered loader strategies first (e.g., adapted node manifests
        // that have only `type` and `module` fields, no `name`).
        let plugin: Plugin | null = null;
        for (const strategy of loaderStrategies) {
          plugin = await strategy(filePath, manifest);
          if (plugin) break;
        }

        // Fall back to YAML loading (requires `name` field)
        if (!plugin) {
          plugin = await loadYamlPlugin(filePath);
        }

        registry.register(plugin);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Always warn on plugin load failures — silent swallowing makes debugging impossible
        console.error(`[nathan] Warning: Failed to load plugin ${entry}: ${msg}`);
      }
    }
  }
}

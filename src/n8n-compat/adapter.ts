/**
 * Generic adapter that converts any n8n INodeTypeDescription into a nathan
 * PluginDescriptor.
 *
 * This is the bridge between the n8n node ecosystem and nathan's own plugin
 * model.  It inspects the node's properties array, identifies the
 * resource/operation structure (or treats the node as single-purpose when
 * those properties are absent), collects scoped parameters, maps credential
 * definitions, and returns a fully-formed PluginDescriptor.
 */

import type {
  PluginDescriptor,
  Resource,
  Operation,
  Parameter,
  CredentialSpec,
  ParameterType,
} from '../core/plugin-interface.ts';
import type {
  INodeTypeDescription,
  INodeProperties,
  INodePropertyOptions,
  INodePropertyCollectionEntry,
  NodePropertyType,
  HttpMethod,
} from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise an n8n property type to the simpler nathan ParameterType.
 */
function mapParameterType(n8nType: NodePropertyType): ParameterType {
  switch (n8nType) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'json':
    case 'collection':
    case 'fixedCollection':
    case 'resourceMapper':
      return 'object';
    case 'multiOptions':
      return 'array';
    case 'string':
    case 'options':
    case 'color':
    case 'dateTime':
    case 'resourceLocator':
    case 'notice':
    case 'hidden':
    default:
      return 'string';
  }
}

/**
 * Map n8n credential auth type names to nathan CredentialSpec types.
 */
function inferCredentialType(credName: string): CredentialSpec['type'] {
  const lower = credName.toLowerCase();
  if (lower.includes('oauth2')) return 'oauth2';
  if (lower.includes('oauth')) return 'oauth2';
  if (lower.includes('bearer') || lower.includes('token')) return 'bearer';
  if (lower.includes('basic') || lower.includes('digest')) return 'basic';
  if (lower.includes('api') || lower.includes('key')) return 'api_key';
  return 'custom';
}

/**
 * Build a human-readable display name from a camelCase or kebab-case string.
 */
function humanise(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Return the version number (scalar) for the node description.
 */
function resolveVersion(desc: INodeTypeDescription): string {
  if (desc.defaultVersion !== undefined) return String(desc.defaultVersion);
  if (Array.isArray(desc.version)) return String(desc.version[desc.version.length - 1]);
  return String(desc.version);
}

/**
 * Check whether a property's displayOptions.show/hide conditions match a
 * given resource+operation pair.
 */
function matchesDisplayOptions(
  prop: INodeProperties,
  resource: string | undefined,
  operation: string | undefined,
): boolean {
  const opts = prop.displayOptions;
  if (!opts) return true; // no filter means always visible

  // --- show ---
  if (opts.show) {
    for (const [key, allowedValues] of Object.entries(opts.show)) {
      if (key === 'resource' && resource !== undefined) {
        if (!allowedValues.includes(resource)) return false;
      } else if (key === 'operation' && operation !== undefined) {
        if (!allowedValues.includes(operation)) return false;
      }
      // Other show keys (e.g. based on another param value) can't be
      // statically resolved here — we optimistically include the param.
    }
  }

  // --- hide ---
  if (opts.hide) {
    for (const [key, hiddenValues] of Object.entries(opts.hide)) {
      if (key === 'resource' && resource !== undefined) {
        if (hiddenValues.includes(resource)) return false;
      } else if (key === 'operation' && operation !== undefined) {
        if (hiddenValues.includes(operation)) return false;
      }
    }
  }

  return true;
}

/**
 * Internal/meta parameter names that should be excluded from CLI-facing params.
 */
const INTERNAL_PARAMS = new Set(['resource', 'operation', 'authentication']);

/**
 * Determine whether a property is a meta/internal selector that should be
 * excluded from CLI-facing parameters.
 */
function isMetaProperty(prop: INodeProperties): boolean {
  return INTERNAL_PARAMS.has(prop.name) || prop.type === 'notice';
}

/**
 * Normalise n8n widget defaults like `{ mode: "list", value: "" }` to a plain
 * value.  Returns `undefined` when the inner value is empty so the parameter
 * won't appear as having a default.
 */
const N8N_WIDGET_MODES = new Set(['list', 'manual', 'id', 'url']);

function normalizeDefault(val: unknown): unknown {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    if ('mode' in obj && 'value' in obj && N8N_WIDGET_MODES.has(String(obj.mode))) {
      const v = obj.value;
      return v === '' || v === null ? undefined : v;
    }
  }
  return val;
}

/**
 * Type-guard: is the option entry an INodePropertyOptions?
 */
function isPropertyOption(
  opt: INodePropertyOptions | INodeProperties | INodePropertyCollectionEntry,
): opt is INodePropertyOptions {
  return 'value' in opt && !('type' in opt);
}

/**
 * Extract option items from a property's options array.
 */
function extractOptions(
  prop: INodeProperties,
): Array<{ name: string; value: string | number | boolean }> | undefined {
  if (!prop.options || prop.options.length === 0) return undefined;
  if (prop.type !== 'options' && prop.type !== 'multiOptions') return undefined;

  const mapped: Array<{ name: string; value: string | number | boolean }> = [];
  for (const opt of prop.options) {
    if (isPropertyOption(opt)) {
      mapped.push({ name: opt.name, value: opt.value });
    }
  }
  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Infer the HTTP method for a resource+operation pair by inspecting the
 * request routing metadata on the operation option value.
 */
function inferHttpMethod(
  operationProp: INodeProperties | undefined,
  operationValue: string,
  desc: INodeTypeDescription,
): HttpMethod {
  // Check the operation option's routing.request.method
  if (operationProp?.options) {
    for (const opt of operationProp.options) {
      if (isPropertyOption(opt) && opt.value === operationValue && opt.routing?.request?.method) {
        return opt.routing.request.method;
      }
    }
  }

  // Fallback: infer from the operation name
  const lower = operationValue.toLowerCase();
  if (lower.startsWith('get') || lower === 'list' || lower === 'read' || lower === 'search')
    return 'GET';
  if (lower.startsWith('create') || lower === 'add' || lower === 'insert' || lower === 'send')
    return 'POST';
  if (lower.startsWith('update') || lower === 'edit' || lower === 'modify' || lower === 'upsert')
    return 'PUT';
  if (lower.startsWith('patch')) return 'PATCH';
  if (lower.startsWith('delete') || lower === 'remove' || lower === 'destroy') return 'DELETE';

  // Last resort: use requestDefaults
  return desc.requestDefaults?.method ?? 'GET';
}

/**
 * Infer the URL path for a resource+operation pair by inspecting routing
 * metadata on the operation option.
 */
function inferPath(
  operationProp: INodeProperties | undefined,
  operationValue: string,
  desc: INodeTypeDescription,
): string {
  if (operationProp?.options) {
    for (const opt of operationProp.options) {
      if (isPropertyOption(opt) && opt.value === operationValue && opt.routing?.request?.url) {
        return opt.routing.request.url;
      }
    }
  }
  return desc.requestDefaults?.url ?? '/';
}

/**
 * Convert an n8n property to a nathan Parameter.
 */
function toNathanParameter(prop: INodeProperties): Parameter {
  return {
    name: prop.name,
    displayName: prop.displayName,
    description: prop.description ?? '',
    type: mapParameterType(prop.type),
    required: prop.required ?? false,
    default: normalizeDefault(prop.default),
    location: prop.routing?.send?.type === 'query' ? 'query' : 'body',
    options: extractOptions(prop),
  };
}

/**
 * Collect all parameters that are relevant for a given resource + operation
 * combination, excluding the resource/operation selector properties
 * themselves.
 */
function collectScopedParameters(
  allProperties: INodeProperties[],
  resource: string | undefined,
  operation: string | undefined,
): Parameter[] {
  const params: Parameter[] = [];

  for (const prop of allProperties) {
    if (isMetaProperty(prop)) continue;
    if (!matchesDisplayOptions(prop, resource, operation)) continue;

    // For collection and fixedCollection, flatten their child values into
    // the parameter list so the CLI can present them individually.
    if (
      (prop.type === 'collection' || prop.type === 'fixedCollection') &&
      prop.options &&
      prop.options.length > 0
    ) {
      // Still include the parent as an object-type parameter so callers
      // know the grouping exists.
      params.push(toNathanParameter(prop));

      // Additionally, walk children.
      for (const child of prop.options) {
        if ('values' in child && Array.isArray((child as INodePropertyCollectionEntry).values)) {
          for (const sub of (child as INodePropertyCollectionEntry).values) {
            if (!isMetaProperty(sub)) {
              params.push(toNathanParameter(sub));
            }
          }
        } else if ('type' in child) {
          // child is INodeProperties (nested inside a collection)
          params.push(toNathanParameter(child as INodeProperties));
        }
      }
    } else {
      params.push(toNathanParameter(prop));
    }
  }

  return params;
}

/**
 * Determine a description for the operation, preferring the option's
 * description field.
 */
function buildOperationDescription(
  operationProp: INodeProperties | undefined,
  operationValue: string,
): string {
  if (operationProp?.options) {
    for (const opt of operationProp.options) {
      if (isPropertyOption(opt) && opt.value === operationValue && opt.description) {
        return opt.description;
      }
    }
  }
  return humanise(operationValue);
}

// ---------------------------------------------------------------------------
// Branch extractors (file-private)
// ---------------------------------------------------------------------------

/**
 * Adapt a node that uses the resource + operation pattern — the most common
 * shape.  Each resource+operation combination becomes a nathan
 * Resource+Operation.
 */
function adaptResourceOperationNode(
  desc: INodeTypeDescription,
  resourceProp: INodeProperties,
  allOperationProps: INodeProperties[],
  allProperties: INodeProperties[],
): Resource[] {
  const resources: Resource[] = [];

  for (const resOpt of resourceProp.options!) {
    if (!isPropertyOption(resOpt)) continue;

    const resourceValue = String(resOpt.value);
    const resourceDisplayName = resOpt.name;

    // Find the operation property(ies) that apply to this resource.
    // n8n nodes often have one operation prop per resource, each with
    // displayOptions.show.resource scoped to that resource.
    const matchingOpProps = allOperationProps.filter((opProp) => {
      if (!opProp.displayOptions?.show?.resource) return true;
      return opProp.displayOptions.show.resource.includes(resourceValue);
    });

    const operations: Operation[] = [];

    for (const opProp of matchingOpProps) {
      if (!opProp.options) continue;

      for (const opOpt of opProp.options) {
        if (!isPropertyOption(opOpt)) continue;

        const operationValue = String(opOpt.value);
        const method = inferHttpMethod(opProp, operationValue, desc);
        const path = inferPath(opProp, operationValue, desc);
        const params = collectScopedParameters(allProperties, resourceValue, operationValue);

        operations.push({
          name: operationValue,
          displayName: humanise(operationValue),
          description: buildOperationDescription(opProp, operationValue),
          method,
          path,
          parameters: params,
          output: {
            format: 'json',
            description: `Result of ${humanise(operationValue)} on ${resourceDisplayName}`,
          },
          requiresAuth: (desc.credentials?.length ?? 0) > 0,
        });
      }
    }

    if (matchingOpProps.length === 0) {
      // Resource exists but no operation property — single "execute".
      const params = collectScopedParameters(allProperties, resourceValue, undefined);
      operations.push({
        name: 'execute',
        displayName: 'Execute',
        description: `Execute action on ${resourceDisplayName}`,
        method: desc.requestDefaults?.method ?? 'POST',
        path: desc.requestDefaults?.url ?? '/',
        parameters: params,
        output: {
          format: 'json',
          description: `Result of executing ${resourceDisplayName}`,
        },
        requiresAuth: (desc.credentials?.length ?? 0) > 0,
      });
    }

    if (operations.length > 0) {
      resources.push({
        name: resourceValue,
        displayName: resourceDisplayName,
        description: resOpt.description ?? humanise(resourceValue),
        operations,
      });
    }
  }

  return resources;
}

/**
 * Adapt a node that has an operation property but no resource property.
 * All operations go under a single synthetic "default" resource.
 */
function adaptOperationOnlyNode(
  desc: INodeTypeDescription,
  operationProp: INodeProperties,
  allProperties: INodeProperties[],
): Resource[] {
  const operations: Operation[] = [];

  for (const opOpt of operationProp.options!) {
    if (!isPropertyOption(opOpt)) continue;
    const operationValue = String(opOpt.value);
    const method = inferHttpMethod(operationProp, operationValue, desc);
    const path = inferPath(operationProp, operationValue, desc);
    const params = collectScopedParameters(allProperties, undefined, operationValue);

    operations.push({
      name: operationValue,
      displayName: humanise(operationValue),
      description: buildOperationDescription(operationProp, operationValue),
      method,
      path,
      parameters: params,
      output: {
        format: 'json',
        description: `Result of ${humanise(operationValue)}`,
      },
      requiresAuth: (desc.credentials?.length ?? 0) > 0,
    });
  }

  if (operations.length > 0) {
    return [
      {
        name: 'default',
        displayName: desc.displayName,
        description: desc.description,
        operations,
      },
    ];
  }

  return [];
}

/**
 * Adapt a single-purpose node (no resource, no operation properties).
 * All non-meta properties are collected into one resource with one
 * "execute" operation.
 */
function adaptSinglePurposeNode(
  desc: INodeTypeDescription,
  allProperties: INodeProperties[],
): Resource[] {
  const params = collectScopedParameters(allProperties, undefined, undefined);
  const method: HttpMethod = desc.requestDefaults?.method ?? 'POST';

  return [
    {
      name: 'default',
      displayName: desc.displayName,
      description: desc.description,
      operations: [
        {
          name: 'execute',
          displayName: 'Execute',
          description: desc.description,
          method,
          path: desc.requestDefaults?.url ?? '/',
          parameters: params,
          output: {
            format: 'json',
            description: `Result of executing ${desc.displayName}`,
          },
          requiresAuth: (desc.credentials?.length ?? 0) > 0,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an n8n INodeTypeDescription into a nathan PluginDescriptor.
 *
 * The conversion handles three shapes of n8n nodes:
 *
 * 1. **Resource + operation nodes** — the most common pattern.  The
 *    description contains a property named `resource` (type `options`)
 *    and a property named `operation` (type `options`).  Every
 *    resource+operation combination becomes a nathan Resource+Operation.
 *
 * 2. **Operation-only nodes** — an `operation` property exists but no
 *    `resource`.  All operations go under a single synthetic resource.
 *
 * 3. **Single-purpose nodes** — no resource/operation properties.  All
 *    non-meta properties are collected into a single resource with a
 *    single "execute" operation.
 */
export function adaptNodeTypeDescription(desc: INodeTypeDescription): PluginDescriptor {
  const resourceProp = desc.properties.find((p) => p.name === 'resource' && p.type === 'options');
  const operationProp = desc.properties.find((p) => p.name === 'operation' && p.type === 'options');
  const allOperationProps = desc.properties.filter(
    (p) => p.name === 'operation' && p.type === 'options',
  );

  let resources: Resource[];
  if (resourceProp && resourceProp.options && resourceProp.options.length > 0) {
    resources = adaptResourceOperationNode(desc, resourceProp, allOperationProps, desc.properties);
  } else if (operationProp && operationProp.options && operationProp.options.length > 0) {
    resources = adaptOperationOnlyNode(desc, operationProp, desc.properties);
  } else {
    resources = adaptSinglePurposeNode(desc, desc.properties);
  }

  // ---- Credentials ----
  const credentials: CredentialSpec[] = (desc.credentials ?? []).map((cred) => ({
    name: cred.name,
    displayName: humanise(cred.name),
    type: inferCredentialType(cred.name),
    fields: [], // Fields would be populated from ICredentialType, not INodeTypeDescription
  }));

  return {
    name: desc.name,
    displayName: desc.displayName,
    description: desc.description,
    version: resolveVersion(desc),
    type: 'adapted',
    credentials,
    resources,
  };
}

/**
 * Core type definitions for the nathan plugin system.
 */

/** Supported HTTP methods for operations. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Parameter location in the HTTP request. */
export type ParameterLocation = "query" | "path" | "header" | "body" | "cookie";

/** Parameter types. */
export type ParameterType = "string" | "number" | "boolean" | "object" | "array";

/** Output format for operation results. */
export type OutputFormat = "json" | "text" | "binary";

/** Plugin types supported by the loader. */
export type PluginType = "declarative" | "adapted" | "native";

/**
 * Describes a single parameter accepted by an operation.
 */
export interface Parameter {
  name: string;
  displayName: string;
  description: string;
  type: ParameterType;
  required: boolean;
  default?: unknown;
  location: ParameterLocation;
  /** Enum values if the parameter is constrained. */
  options?: Array<{ name: string; value: string | number | boolean }>;
}

/**
 * Describes the expected output shape of an operation.
 */
export interface OutputSpec {
  format: OutputFormat;
  /** JSON Schema or description of the response shape. */
  schema?: Record<string, unknown>;
  /** Human-readable description of what the output contains. */
  description?: string;
}

/**
 * A single operation (action) that can be performed on a resource.
 */
export interface Operation {
  name: string;
  displayName: string;
  description: string;
  method: HttpMethod;
  path: string;
  parameters: Parameter[];
  output: OutputSpec;
  /** Whether this operation requires authentication. */
  requiresAuth: boolean;
}

/**
 * A resource groups related operations (e.g., "users", "repos").
 */
export interface Resource {
  name: string;
  displayName: string;
  description: string;
  operations: Operation[];
}

/**
 * Specification for a credential required by a plugin.
 */
export interface CredentialSpec {
  name: string;
  displayName: string;
  type: "api_key" | "oauth2" | "bearer" | "basic" | "custom";
  /** Fields that must be provided for this credential. */
  fields: Array<{
    name: string;
    displayName: string;
    type: "string" | "password" | "url";
    required: boolean;
    default?: string;
    description?: string;
  }>;
}

/**
 * Resolved credentials ready for injection into requests.
 *
 * Replaces the previous Record<string, string> + __field_ prefix convention
 * with a properly typed structure that separates the primary secret from
 * individual credential fields.
 */
export interface ResolvedCredentials {
  /** Credential type name (e.g. "githubApi"). */
  typeName: string;
  /** Primary secret value (token, API key, etc.) resolved from env or store. */
  primarySecret?: string;
  /** All resolved credential fields keyed by field name. */
  fields: Readonly<Record<string, string>>;
}

/**
 * Metadata attached to operation results.
 */
export interface ResultMetadata {
  statusCode?: number;
  headers?: Record<string, string>;
  duration?: number;
}

/** Known error codes used across the system. */
export type ErrorCode =
  | "MISSING_PARAM"
  | "UNKNOWN_RESOURCE"
  | "UNKNOWN_OPERATION"
  | "HTTP_ERROR"
  | "REQUEST_FAILED"
  | "EXECUTION_ERROR"
  | "PLUGIN_NOT_FOUND"
  | "RESOURCE_NOT_FOUND"
  | "OPERATION_NOT_FOUND"
  | "STARTUP_ERROR"
  | "CREDENTIAL_ERROR"
  | (string & {}); // Allow custom codes while providing autocomplete for known ones

/**
 * Structured error information.
 */
export interface ResultError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/**
 * The result of executing an operation.
 * Discriminated union — `success` narrows the type so that:
 * - On success: `data` is guaranteed, `error` does not exist
 * - On failure: `error` is guaranteed, `data` does not exist
 */
export type Result<T = unknown> =
  | { success: true; data: T; metadata?: ResultMetadata }
  | { success: false; error: ResultError; metadata?: ResultMetadata };

/**
 * Configuration describing how a credential type authenticates requests.
 * Used by credential-injector, credential-introspector, and adapter layers.
 *
 * Values in headers, queryParams, body, and basicAuth may contain
 * credential template expressions (e.g. "Bearer {{secret}}") that are
 * resolved at injection time by the registered expression resolver.
 */
export interface CredentialAuthConfig {
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: Record<string, string>;
  basicAuth?: { username: string; password: string };
}

/**
 * Full descriptor for a plugin — the central type of the system.
 */
export interface PluginDescriptor {
  name: string;
  displayName: string;
  description: string;
  version: string;
  type: PluginType;
  credentials: CredentialSpec[];
  resources: Resource[];
}

/**
 * Find a resource by name in a plugin descriptor.
 * Eliminates duplicated lookup logic across plugin-loader, adapter layers, and commands.
 */
export function findResource(descriptor: PluginDescriptor, name: string): Resource | undefined {
  return descriptor.resources.find((r) => r.name === name);
}

/**
 * Find an operation by name within a resource.
 */
export function findOperation(resource: Resource, name: string): Operation | undefined {
  return resource.operations.find((o) => o.name === name);
}

/**
 * Interface that native plugins must implement.
 */
export interface Plugin {
  descriptor: PluginDescriptor;
  /** Execute an operation. */
  execute(
    resource: string,
    operation: string,
    params: Record<string, unknown>,
    credentials: ResolvedCredentials[],
  ): Promise<Result>;
}

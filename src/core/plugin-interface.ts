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
export type PluginType = "declarative" | "n8n-compat" | "native";

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
 * The result of executing an operation.
 */
export interface Result<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: {
    statusCode?: number;
    headers?: Record<string, string>;
    duration?: number;
  };
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
 * Interface that native plugins must implement.
 */
export interface Plugin {
  descriptor: PluginDescriptor;
  /** Execute an operation. */
  execute(
    resource: string,
    operation: string,
    params: Record<string, unknown>,
    credentials: Record<string, string>,
  ): Promise<Result>;
}

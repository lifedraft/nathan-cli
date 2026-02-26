/**
 * Credential field validation and resolution.
 *
 * Validates user-provided flags against a credential type's field schema,
 * resolves the --token shortcut, fills defaults, and reports missing fields.
 */

import type { CredentialSpec } from "./plugin-interface.js";
import type { CredentialTypeInfo } from "./credential-introspector.js";

/**
 * Unified field descriptor that normalizes both CredentialTypeDefinition.properties
 * and CredentialSpec.fields into a common shape.
 */
interface FieldDescriptor {
  name: string;
  isPassword: boolean;
  required: boolean;
  default?: unknown;
}

export interface ValidationError {
  missing: string[];
  available: string[];
  hasTokenShortcut: boolean;
}

export type ValidationResult =
  | { success: true; fields: Record<string, string> }
  | { success: false; error: ValidationError };

/**
 * Normalize field sources into a common FieldDescriptor array.
 *
 * When a CredentialTypeDefinition is available (from external introspection),
 * its properties are used. Otherwise, falls back to the plugin's
 * CredentialSpec.fields.
 */
function normalizeFields(
  credTypeDef: CredentialTypeInfo | null,
  credSpec: CredentialSpec,
): FieldDescriptor[] {
  if (credTypeDef) {
    return credTypeDef.properties.map((p) => ({
      name: p.name,
      isPassword: p.isPassword,
      required: p.required,
      default: p.default,
    }));
  }

  return credSpec.fields.map((f) => ({
    name: f.name,
    isPassword: f.type === "password",
    required: f.required,
    default: f.default,
  }));
}

/**
 * Validate and resolve credential fields from user-provided flags.
 *
 * Handles:
 * - --token shortcut mapping to the password field
 * - Explicit flag-to-field mapping
 * - Required field validation
 * - Default value filling
 */
export function resolveCredentialFields(
  credTypeDef: CredentialTypeInfo | null,
  credSpec: CredentialSpec,
  flags: Record<string, string>,
): ValidationResult {
  const descriptors = normalizeFields(credTypeDef, credSpec);
  const fields: Record<string, string> = {};

  // Find the password field for --token shortcut
  const passwordField = descriptors.find((d) => d.isPassword);

  // Map --token shortcut to the password field
  if (flags.token && passwordField) {
    fields[passwordField.name] = flags.token;
  }

  // Map explicit flags to matching fields
  for (const desc of descriptors) {
    if (desc.name in flags) {
      fields[desc.name] = flags[desc.name];
    }
  }

  // Validate all required fields are present
  const missing = descriptors
    .filter((d) => d.required && !(d.name in fields))
    .map((d) => `--${d.name}`);

  if (missing.length > 0) {
    const available = descriptors.map(
      (d) => `--${d.name}${d.required ? " (required)" : ""}`,
    );
    return {
      success: false,
      error: {
        missing,
        available,
        hasTokenShortcut: passwordField !== undefined,
      },
    };
  }

  // Fill defaults for fields not provided
  for (const desc of descriptors) {
    if (!(desc.name in fields) && desc.default !== undefined && desc.default !== "") {
      fields[desc.name] = String(desc.default);
    }
  }

  return { success: true, fields };
}

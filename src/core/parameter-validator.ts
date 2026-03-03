/**
 * Shared parameter validation for operations.
 *
 * Validates required parameters before plugin execution,
 * providing clear error messages for agents.
 */

import type { Operation, Result } from './plugin-interface.js';

export function validateParameters(
  operation: Operation,
  params: Record<string, unknown>,
): Result | null {
  const missing = operation.parameters
    .filter((p) => p.required && params[p.name] === undefined && p.default === undefined)
    .map((p) => ({ name: p.name, type: p.type, description: p.description, location: p.location }));

  if (missing.length === 0) return null;

  return {
    success: false,
    error: {
      code: 'MISSING_PARAM',
      message: `Missing required parameter(s): ${missing.map((p) => p.name).join(', ')}`,
      details: {
        missing,
        all_parameters: operation.parameters.map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
          description: p.description,
          ...(p.default !== undefined ? { default: p.default } : {}),
        })),
      },
    },
  };
}

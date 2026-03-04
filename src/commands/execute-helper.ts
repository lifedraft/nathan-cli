/**
 * Shared execution flow for all command types (run, eager dynamic, lazy dynamic).
 *
 * Consolidates: flag parsing → limit extraction → parameter validation →
 * credential resolution → fail-fast check → plugin.execute → output.
 */

import {
  resolveCredentialsForPlugin,
  checkCredentialsConfigured,
} from '../core/credential-resolver.js';
import { parseFlags, extractLimit } from '../core/flag-parser.js';
import { validateParameters } from '../core/parameter-validator.js';
import type { Plugin, Operation } from '../core/plugin-interface.js';
import { printOutput, printError } from './output.js';

/**
 * Execute a plugin operation with full validation, credential checks, and output.
 * Sets process.exitCode = 1 on failure.
 */
export async function executePluginOperation(opts: {
  plugin: Plugin;
  resource: string;
  operation: string;
  op: Operation;
  rawArgs: string[];
  json: boolean;
}): Promise<void> {
  const { plugin, resource, operation, op, rawArgs, json } = opts;

  const params = parseFlags(rawArgs);
  const limit = extractLimit(params);

  const describeHint = `Run 'nathan describe ${plugin.descriptor.name} ${resource} ${operation}' for full documentation.`;

  const validationResult = validateParameters(op, params);
  if (validationResult && !validationResult.success) {
    printError(validationResult.error, { json, hint: describeHint });
    process.exitCode = 1;
    return;
  }

  const credentials = await resolveCredentialsForPlugin(plugin.descriptor);

  const credError = checkCredentialsConfigured(plugin.descriptor, credentials);
  if (credError) {
    printError(credError.error, { json, hint: credError.error.env_vars.join(', ') });
    process.exitCode = 1;
    return;
  }

  const result = await plugin.execute(resource, operation, params, credentials);

  if (!result.success) {
    printError(result.error, { json });
    process.exitCode = 1;
    return;
  }

  printOutput(result.data, { json, limit });
}

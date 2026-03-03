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
import { printOutput } from './output.js';

/**
 * Execute a plugin operation with full validation, credential checks, and output.
 * Returns void — sets process.exitCode on failure.
 */
export async function executePluginOperation(opts: {
  plugin: Plugin;
  resource: string;
  operation: string;
  op?: Operation;
  rawArgs: string[];
  human: boolean;
}): Promise<void> {
  const { plugin, resource, operation, op, rawArgs, human } = opts;

  const params = parseFlags(rawArgs);
  const limit = extractLimit(params);

  if (op) {
    const validationError = validateParameters(op, params);
    if (validationError) {
      printOutput(validationError, { human });
      process.exitCode = 1;
      return;
    }
  }

  const credentials = await resolveCredentialsForPlugin(plugin.descriptor);

  const credError = checkCredentialsConfigured(plugin.descriptor, credentials);
  if (credError) {
    printOutput(credError, { human });
    process.exitCode = 1;
    return;
  }

  const result = await plugin.execute(resource, operation, params, credentials);

  if (!result.success) {
    printOutput(result, { human });
    process.exitCode = 1;
    return;
  }

  printOutput(result.data, { human, limit });
}

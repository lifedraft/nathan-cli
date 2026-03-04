import { Command, Option } from 'clipanion';

import { extractJsonFlag } from '../core/flag-parser.js';
import { findResource, findOperation } from '../core/plugin-interface.js';
import { registry } from '../core/registry-instance.js';
import { executePluginOperation } from './execute-helper.js';
import { printError } from './output.js';

export class RunCommand extends Command {
  static override paths = [['run']];

  static override usage = Command.Usage({
    description: 'Execute a service operation',
    examples: [
      ['Get a post', 'nathan run jsonplaceholder post get --id=1'],
      ['List users', 'nathan run jsonplaceholder user list'],
      [
        'Create a post',
        'nathan run jsonplaceholder post create --title="Hello" --body="World" --userId=1',
      ],
    ],
  });

  json = Option.Boolean('--json', false, {
    description: 'Output in JSON format (default: human-readable)',
  });

  // All positional + flag args captured via proxy (no -- required)
  args = Option.Proxy();

  async execute(): Promise<void> {
    // Option.Proxy swallows all flags including --json, so extract it from raw args
    const [jsonFromArgs, args] = extractJsonFlag(this.args);
    const json = this.json || jsonFromArgs;

    // Extract positional args — filter out flags so order doesn't matter
    const positional = args.filter((a) => !a.startsWith('-'));
    const [service, resource, operation] = positional;

    if (!service || !resource || !operation) {
      printError(
        {
          code: 'INVALID_USAGE',
          message: 'Usage: nathan run <service> <resource> <operation> [--param=value ...]',
        },
        { json },
      );
      process.exitCode = 1;
      return;
    }

    const plugin = await registry.getOrLoad(service);
    if (!plugin) {
      printError(
        {
          code: 'PLUGIN_NOT_FOUND',
          message: `Plugin "${service}" not found`,
          suggestion: "Run 'nathan discover' to see available plugins",
        },
        { json },
      );
      process.exitCode = 1;
      return;
    }

    const res = findResource(plugin.descriptor, resource);
    if (!res) {
      const resources = plugin.descriptor.resources.map((r) => r.name);
      printError(
        {
          code: 'RESOURCE_NOT_FOUND',
          message: `Resource "${resource}" not found in "${service}"`,
          available: resources,
        },
        {
          json,
          hint: `Available resources: ${resources.join(', ')}\nRun 'nathan describe ${service}' for full documentation.`,
        },
      );
      process.exitCode = 1;
      return;
    }

    const op = findOperation(res, operation);
    if (!op) {
      const ops = res.operations.map((o) => o.name);
      printError(
        {
          code: 'OPERATION_NOT_FOUND',
          message: `Operation "${operation}" not found on "${resource}"`,
          available: ops,
        },
        {
          json,
          hint: `Available operations: ${ops.join(', ')}\nRun 'nathan describe ${service} ${resource}' for full documentation.`,
        },
      );
      process.exitCode = 1;
      return;
    }

    await executePluginOperation({
      plugin,
      resource,
      operation,
      op,
      rawArgs: args,
      json,
    });
  }
}

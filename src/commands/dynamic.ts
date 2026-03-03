/**
 * Dynamic command factory.
 *
 * Creates clipanion Command classes at runtime from loaded plugin descriptors.
 * Each service/resource/operation combo becomes a direct command:
 *   nathan <service> <resource> <operation> --param=value
 *
 * Also provides a lazy factory for plugins that haven't been loaded yet,
 * registering a single `nathan <service>` catch-all command that loads on
 * first invocation.
 */

import { Command, Option } from 'clipanion';
import type { CommandClass } from 'clipanion';

import type { Plugin } from '../core/plugin-interface.js';
import { findResource, findOperation } from '../core/plugin-interface.js';
import type { PluginRegistry } from '../core/plugin-registry.js';
import { executePluginOperation } from './execute-helper.js';
import { printOutput } from './output.js';

/**
 * Generate all dynamic Command classes for a loaded plugin.
 */
export function createPluginCommands(plugin: Plugin): CommandClass[] {
  const commands: CommandClass[] = [];
  const desc = plugin.descriptor;

  for (const resource of desc.resources) {
    for (const operation of resource.operations) {
      const commandPaths: string[][] = [[desc.name, resource.name, operation.name]];

      const cmd = class extends Command {
        static override paths = commandPaths;

        static override usage = Command.Usage({
          description: operation.description,
          examples: [
            [
              operation.description,
              buildExample(desc.name, resource.name, operation.name, operation.parameters),
            ],
          ],
        });

        human = Option.Boolean('--human', false, {
          description: 'Output in human-readable format instead of JSON',
        });

        args = Option.Proxy();

        async execute(): Promise<void> {
          await executePluginOperation({
            plugin,
            resource: resource.name,
            operation: operation.name,
            op: operation,
            rawArgs: this.args,
            human: this.human,
          });
        }
      };

      commands.push(cmd);
    }
  }

  return commands;
}

/**
 * Create a single lazy catch-all command for a service that hasn't been loaded
 * yet. The command has path `[serviceName]` and uses Option.Proxy() to capture
 * `<resource> <operation> --flags...`.  On first invocation the plugin is
 * loaded from the registry.
 *
 * Clipanion prefers more-specific paths (3-segment) over shorter ones, so
 * eagerly loaded plugins always win if both are registered.
 */
export function createLazyPluginCommand(
  serviceName: string,
  registryRef: PluginRegistry,
): CommandClass {
  const cmd = class extends Command {
    static override paths = [[serviceName]];

    static override usage = Command.Usage({
      description: `Run an operation on the ${serviceName} service (lazy-loaded)`,
    });

    human = Option.Boolean('--human', false, {
      description: 'Output in human-readable format instead of JSON',
    });

    args = Option.Proxy();

    async execute(): Promise<void> {
      const plugin = await registryRef.getOrLoad(serviceName);
      if (!plugin) {
        printOutput({
          error: {
            code: 'PLUGIN_NOT_FOUND',
            message: `Plugin "${serviceName}" not found`,
            suggestion: "Run 'nathan discover' to see available plugins",
          },
        });
        process.exitCode = 1;
        return;
      }

      // Extract positional args — filter out flags so order doesn't matter
      const positional = this.args.filter((a) => !a.startsWith('-'));
      const [resource, operation] = positional;

      if (!resource || !operation) {
        printOutput({
          error: {
            code: 'INVALID_USAGE',
            message: `Usage: nathan ${serviceName} <resource> <operation> [--param=value ...]`,
            available_resources: plugin.descriptor.resources.map((r) => r.name),
          },
        });
        process.exitCode = 1;
        return;
      }

      const res = findResource(plugin.descriptor, resource);
      if (!res) {
        printOutput({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource "${resource}" not found in "${serviceName}"`,
            available: plugin.descriptor.resources.map((r) => r.name),
          },
        });
        process.exitCode = 1;
        return;
      }

      const op = findOperation(res, operation);
      if (!op) {
        printOutput({
          error: {
            code: 'OPERATION_NOT_FOUND',
            message: `Operation "${operation}" not found on "${resource}"`,
            available: res.operations.map((o) => o.name),
          },
        });
        process.exitCode = 1;
        return;
      }

      await executePluginOperation({
        plugin,
        resource,
        operation,
        op,
        rawArgs: this.args,
        human: this.human,
      });
    }
  };

  return cmd;
}

function buildExample(
  service: string,
  resource: string,
  operation: string,
  parameters: Array<{ name: string; required: boolean; type: string }>,
): string {
  const requiredParams = parameters
    .filter((p) => p.required)
    .map((p) => {
      const example = p.type === 'number' ? '1' : `"value"`;
      return `--${p.name}=${example}`;
    })
    .join(' ');

  return `nathan ${service} ${resource} ${operation}${requiredParams ? ' ' + requiredParams : ''}`;
}

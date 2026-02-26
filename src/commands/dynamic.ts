/**
 * Dynamic command factory.
 *
 * Creates clipanion Command classes at runtime from loaded plugin descriptors.
 * Each service/resource/operation combo becomes a direct command:
 *   nathan <service> <resource> <operation> --param=value
 */

import { Command, Option } from "clipanion";
import type { CommandClass } from "clipanion";
import type { Plugin } from "../core/plugin-interface.js";
import { printOutput } from "./output.js";
import { parseFlags } from "../core/flag-parser.js";
import { resolveCredentialsForPlugin } from "../core/credential-resolver.js";

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

        human = Option.Boolean("--human", false, {
          description: "Output in human-readable format instead of JSON",
        });

        args = Option.Proxy();

        async execute(): Promise<void> {
          const params = parseFlags(this.args);
          const credentials = await resolveCredentialsForPlugin(plugin.descriptor);

          const result = await plugin.execute(
            resource.name,
            operation.name,
            params,
            credentials,
          );

          if (!result.success) {
            printOutput(result, { human: this.human });
            process.exitCode = 1;
            return;
          }

          printOutput(result.data, { human: this.human });
        }
      };

      commands.push(cmd);
    }
  }

  return commands;
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
      const example = p.type === "number" ? "1" : `"value"`;
      return `--${p.name}=${example}`;
    })
    .join(" ");

  return `nathan ${service} ${resource} ${operation}${requiredParams ? " " + requiredParams : ""}`;
}

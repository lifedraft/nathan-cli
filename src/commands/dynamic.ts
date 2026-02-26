/**
 * Dynamic command factory.
 *
 * Creates clipanion Command classes at runtime from loaded plugin descriptors.
 * Each service/resource/operation combo becomes a direct command:
 *   nathan <service> <resource> <operation> --param=value
 */

import { Command, Option } from "clipanion";
import type { Plugin } from "../core/plugin-interface.js";
import { printOutput } from "../core/output.js";
import { resolveCredentialsForPlugin } from "../core/credential-resolver.js";

/**
 * Generate all dynamic Command classes for a loaded plugin.
 */
export function createPluginCommands(plugin: Plugin): Array<typeof Command> {
  const commands: Array<typeof Command> = [];
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

function parseFlags(args: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const raw = arg.slice(eqIndex + 1);
        params[key] = coerce(raw);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          params[key] = coerce(next);
          i++;
        } else {
          params[key] = true;
        }
      }
    }
    i++;
  }
  return params;
}

function coerce(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;
  return value;
}

import { Command, Option } from "clipanion";
import { printOutput } from "./output.js";
import { registry } from "../core/registry-instance.js";
import { findResource, findOperation } from "../core/plugin-interface.js";
import { executePluginOperation } from "./execute-helper.js";

export class RunCommand extends Command {
  static override paths = [["run"]];

  static override usage = Command.Usage({
    description: "Execute a service operation",
    examples: [
      ["Get a post", "nathan run jsonplaceholder post get --id=1"],
      ["List users", "nathan run jsonplaceholder user list"],
      ["Create a post", 'nathan run jsonplaceholder post create --title="Hello" --body="World" --userId=1'],
    ],
  });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

  // All positional + flag args captured via proxy (no -- required)
  args = Option.Proxy();

  async execute(): Promise<void> {
    // Extract positional args — filter out flags so order doesn't matter
    const positional = this.args.filter((a) => !a.startsWith("-"));
    const [service, resource, operation] = positional;

    if (!service || !resource || !operation) {
      printOutput({
        error: {
          code: "INVALID_USAGE",
          message: "Usage: nathan run <service> <resource> <operation> [--param=value ...]",
        },
      });
      process.exitCode = 1;
      return;
    }

    const plugin = await registry.getOrLoad(service);
    if (!plugin) {
      printOutput({
        error: {
          code: "PLUGIN_NOT_FOUND",
          message: `Plugin "${service}" not found`,
          suggestion: "Run 'nathan discover' to see available plugins",
        },
      });
      process.exitCode = 1;
      return;
    }

    const res = findResource(plugin.descriptor, resource);
    const op = res ? findOperation(res, operation) : undefined;

    await executePluginOperation({
      plugin,
      resource,
      operation,
      op,
      rawArgs: this.args,
      human: this.human,
    });
  }
}

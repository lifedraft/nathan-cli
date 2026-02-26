import { Command, Option } from "clipanion";
import { printOutput } from "./output.js";
import { parseFlags } from "../core/flag-parser.js";
import { resolveCredentialsForPlugin } from "../core/credential-resolver.js";
import { registry } from "../core/registry-instance.js";

export class RunCommand extends Command {
  static override paths = [["run"]];

  static override usage = Command.Usage({
    description: "Execute a service operation",
    examples: [
      ["Get a post", "nathan run jsonplaceholder post get -- --id=1"],
      ["List users", "nathan run jsonplaceholder user list"],
      ["Create a post", 'nathan run jsonplaceholder post create -- --title="Hello" --body="World" --userId=1'],
    ],
  });

  service = Option.String({ required: true, name: "service" });
  resource = Option.String({ required: true, name: "resource" });
  operation = Option.String({ required: true, name: "operation" });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

  // Everything after -- goes here
  params = Option.Proxy();

  async execute(): Promise<void> {
    const plugin = registry.get(this.service);
    if (!plugin) {
      printOutput({
        error: {
          code: "PLUGIN_NOT_FOUND",
          message: `Plugin "${this.service}" not found`,
          suggestion: "Run 'nathan discover' to see available plugins",
        },
      });
      process.exitCode = 1;
      return;
    }

    const params = parseFlags(this.params);
    const credentials = await resolveCredentialsForPlugin(plugin.descriptor);

    const result = await plugin.execute(
      this.resource,
      this.operation,
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
}

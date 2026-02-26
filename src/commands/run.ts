import { Command, Option } from "clipanion";
import { printOutput } from "../core/output.js";
import { getPlugin, loadPluginsFromDir } from "../core/plugin-loader.js";
import { join } from "node:path";

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
    await loadPluginsFromDir(join(import.meta.dir, "../../plugins"));

    const plugin = getPlugin(this.service);
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

    const result = await plugin.execute(
      this.resource,
      this.operation,
      params,
      {},
    );

    if (!result.success) {
      printOutput(result, { human: this.human });
      process.exitCode = 1;
      return;
    }

    printOutput(result.data, { human: this.human });
  }
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

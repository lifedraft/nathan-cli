/**
 * nathan plugin install <name> — Install a plugin.
 */

import { Command, Option } from "clipanion";
import { printOutput } from "../output.js";

export class PluginInstallCommand extends Command {
  static override paths = [["plugin", "install"]];

  static override usage = Command.Usage({
    description: "Install a plugin by name or path",
    examples: [
      ["Install from registry", "nathan plugin install github"],
      ["Install from local path", "nathan plugin install ./my-plugin.yaml"],
    ],
  });

  name = Option.String({ required: true, name: "name" });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

  async execute(): Promise<void> {
    printOutput(
      { status: "not_implemented", plugin: this.name },
      { human: this.human },
    );
  }
}

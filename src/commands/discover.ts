import { Command, Option } from "clipanion";
import { printOutput } from "./output.js";
import { registry } from "../core/registry-instance.js";

export class DiscoverCommand extends Command {
  static override paths = [["discover"]];

  static override usage = Command.Usage({
    description: "Discover available services, resources, and operations",
    examples: [
      ["List all available services", "nathan discover"],
      ["Human-readable output", "nathan discover --human"],
    ],
  });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

  async execute(): Promise<void> {
    const plugins = registry.getAll();

    const result = {
      plugins: plugins.map((p) => ({
        name: p.descriptor.name,
        displayName: p.descriptor.displayName,
        description: p.descriptor.description,
        version: p.descriptor.version,
        resources: p.descriptor.resources.map((r) => ({
          name: r.name,
          operations: r.operations.map((o) => o.name),
        })),
        authenticated: p.descriptor.credentials.length > 0,
      })),
    };

    printOutput(this.human ? result.plugins : result, { human: this.human });
  }
}

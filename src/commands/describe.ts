import { Command, Option } from "clipanion";
import { printOutput } from "./output.js";
import { registry } from "../core/registry-instance.js";
import { findResource, findOperation } from "../core/plugin-interface.js";

export class DescribeCommand extends Command {
  static override paths = [["describe"]];

  static override usage = Command.Usage({
    description: "Describe a specific service, resource, or operation in detail",
    examples: [
      ["Describe a service", "nathan describe jsonplaceholder"],
      ["Describe a resource", "nathan describe jsonplaceholder post"],
      ["Describe an operation", "nathan describe jsonplaceholder post create"],
    ],
  });

  service = Option.String({ required: true, name: "service" });
  resource = Option.String({ required: false, name: "resource" });
  operation = Option.String({ required: false, name: "operation" });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

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

    if (!this.resource) {
      printOutput({
        name: plugin.descriptor.name,
        displayName: plugin.descriptor.displayName,
        description: plugin.descriptor.description,
        version: plugin.descriptor.version,
        authenticated: plugin.descriptor.credentials.length > 0,
        resources: plugin.descriptor.resources.map((r) => ({
          name: r.name,
          displayName: r.displayName,
          operations: r.operations.map((o) => o.name),
        })),
      }, { human: this.human });
      return;
    }

    const res = findResource(plugin.descriptor, this.resource!);
    if (!res) {
      printOutput({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: `Resource "${this.resource}" not found in "${this.service}"`,
          available: plugin.descriptor.resources.map((r) => r.name),
        },
      });
      process.exitCode = 1;
      return;
    }

    if (!this.operation) {
      printOutput({
        service: this.service,
        resource: res.name,
        displayName: res.displayName,
        description: res.description,
        operations: res.operations.map((o) => ({
          name: o.name,
          displayName: o.displayName,
          description: o.description,
          method: o.method,
        })),
      }, { human: this.human });
      return;
    }

    const op = findOperation(res, this.operation!);
    if (!op) {
      printOutput({
        error: {
          code: "OPERATION_NOT_FOUND",
          message: `Operation "${this.operation}" not found on "${this.resource}"`,
          available: res.operations.map((o) => o.name),
        },
      });
      process.exitCode = 1;
      return;
    }

    printOutput({
      command: `nathan ${this.service} ${this.resource} ${this.operation}`,
      description: op.description,
      method: op.method,
      parameters: op.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.description,
        default: p.default,
        location: p.location,
      })),
      auth: {
        required: plugin.descriptor.credentials.length > 0,
        configured: false,
      },
    }, { human: this.human });
  }
}

/**
 * nathan auth add <service> — Add credentials for a service.
 *
 * Dynamically discovers credential fields from the plugin's credential
 * type definition via the core introspection interface. The --token shortcut
 * maps to whichever field has isPassword: true.
 */

import { Command, Option } from "clipanion";
import { createCredentialStore } from "../../core/credential-store.js";
import { printOutput, printError } from "../output.js";
import { parseFlagsAsStrings } from "../../core/flag-parser.js";
import { loadCredentialType } from "../../core/credential-introspector.js";
import { registry } from "../../core/registry-instance.js";
import { resolveCredentialFields } from "../../core/credential-validator.js";

export class AuthAddCommand extends Command {
  static override paths = [["auth", "add"]];

  static override usage = Command.Usage({
    description: "Add or update credentials for a service",
    examples: [
      ["Add GitHub token", "nathan auth add github --token=ghp_xxx"],
      ["Add with explicit fields", "nathan auth add github --accessToken=ghp_xxx --server=https://github.example.com"],
    ],
  });

  service = Option.String({ required: true, name: "service" });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

  // Capture all remaining flags as proxy args
  args = Option.Proxy();

  async execute(): Promise<void> {
    const plugin = registry.get(this.service);
    if (!plugin) {
      printError(`Unknown service "${this.service}". Run 'nathan discover' to see available services.`, { human: this.human });
      process.exitCode = 1;
      return;
    }

    const credSpec = plugin.descriptor.credentials[0];
    if (!credSpec) {
      printError(`Service "${this.service}" does not require credentials.`, { human: this.human });
      process.exitCode = 1;
      return;
    }

    // Load credential type definition for field introspection (via core interface)
    const credTypeInfo = loadCredentialType(credSpec.name);

    // Parse flags from proxy args
    const flags = parseFlagsAsStrings(this.args);

    // Validate and resolve credential fields
    const validation = resolveCredentialFields(credTypeInfo, credSpec, flags);
    if (!validation.success) {
      const { missing, available, hasTokenShortcut } = validation.error;
      const tokenHint = hasTokenShortcut ? " or --token=<value>" : "";
      printError(
        `Missing required fields: ${missing.join(", ")}${tokenHint}\nAvailable fields: ${available.join(", ")}`,
        { human: this.human },
      );
      process.exitCode = 1;
      return;
    }

    const fields = validation.fields;

    // Store credentials
    try {
      const store = createCredentialStore();
      await store.set(this.service, { type: credSpec.name, fields });
    } catch (err) {
      printError(
        `Failed to store credentials: ${err instanceof Error ? err.message : String(err)}`,
        { human: this.human },
      );
      process.exitCode = 1;
      return;
    }

    const fieldNames = Object.keys(fields);
    printOutput(
      {
        status: "ok",
        service: this.service,
        type: credSpec.name,
        fields: fieldNames,
        message: `Credentials stored for ${this.service}`,
      },
      { human: this.human },
    );
  }
}

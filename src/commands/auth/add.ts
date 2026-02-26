/**
 * nathan auth add <service> — Add credentials for a service.
 *
 * Dynamically discovers credential fields from the plugin's n8n credential
 * type definition. The --token shortcut maps to whichever field has
 * typeOptions.password: true.
 */

import { Command, Option } from "clipanion";
import { getPlugin } from "../../core/plugin-loader.js";
import { createCredentialStore, loadCredentialTypeDefinition } from "../../core/credential-store.js";
import { printOutput, printError } from "../../core/output.js";

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
    const plugin = getPlugin(this.service);
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

    // Load n8n credential type definition for field introspection
    const credTypeDef = loadCredentialTypeDefinition(credSpec.name);

    // Parse flags from proxy args
    const flags = parseAuthFlags(this.args);

    // Build the fields map — user-provided values first, then defaults
    const fields: Record<string, string> = {};

    if (credTypeDef) {
      const passwordField = credTypeDef.properties.find((p) => p.isPassword);

      // --token shortcut maps to the password field
      if (flags.token && passwordField) {
        fields[passwordField.name] = flags.token;
      }

      // Map explicit flags to matching fields
      for (const prop of credTypeDef.properties) {
        if (prop.name in flags) {
          fields[prop.name] = flags[prop.name];
        }
      }

      // Validate all required fields are present
      const missing = credTypeDef.properties
        .filter((p) => p.required && !(p.name in fields))
        .map((p) => `--${p.name}`);

      if (missing.length > 0) {
        const allFields = credTypeDef.properties
          .map((p) => `--${p.name}${p.required ? " (required)" : ""}`)
          .join(", ");
        const tokenHint = passwordField ? " or --token=<value>" : "";
        printError(
          `Missing required fields: ${missing.join(", ")}${tokenHint}\nAvailable fields: ${allFields}`,
          { human: this.human },
        );
        process.exitCode = 1;
        return;
      }

      // Fill defaults for fields not provided
      for (const prop of credTypeDef.properties) {
        if (!(prop.name in fields) && prop.default !== undefined && prop.default !== "") {
          fields[prop.name] = String(prop.default);
        }
      }
    } else {
      // Fallback: use the plugin's CredentialSpec fields
      const passwordField = credSpec.fields.find((f) => f.type === "password");

      if (flags.token && passwordField) {
        fields[passwordField.name] = flags.token;
      }

      for (const field of credSpec.fields) {
        if (field.name in flags) {
          fields[field.name] = flags[field.name];
        }
      }

      const missing = credSpec.fields
        .filter((f) => f.required && !(f.name in fields))
        .map((f) => `--${f.name}`);

      if (missing.length > 0) {
        const allFields = credSpec.fields
          .map((f) => `--${f.name}${f.required ? " (required)" : ""}`)
          .join(", ");
        const tokenHint = passwordField ? " or --token=<value>" : "";
        printError(
          `Missing required fields: ${missing.join(", ")}${tokenHint}\nAvailable fields: ${allFields}`,
          { human: this.human },
        );
        process.exitCode = 1;
        return;
      }

      for (const field of credSpec.fields) {
        if (!(field.name in fields) && field.default !== undefined && field.default !== "") {
          fields[field.name] = field.default;
        }
      }
    }

    // Store credentials
    const store = createCredentialStore();
    await store.set(this.service, {
      type: credSpec.name,
      fields,
    });

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

function parseAuthFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        }
      }
    }
    i++;
  }
  return flags;
}

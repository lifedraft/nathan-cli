/**
 * nathan auth test <service> — Test credentials for a service.
 *
 * Thin command that delegates to the credential tester service.
 * Resolves credentials via the full chain (env -> store), then uses
 * testCredentials() for the actual validation API call.
 */

import { Command, Option } from "clipanion";
import { resolveCredentialsForPlugin } from "../../core/credential-resolver.js";
import { printOutput, printError } from "../output.js";
import { loadCredentialType } from "../../core/credential-introspector.js";
import { registry } from "../../core/registry-instance.js";
import { testCredentials } from "../../core/credential-tester.js";

export class AuthTestCommand extends Command {
  static override paths = [["auth", "test"]];

  static override usage = Command.Usage({
    description: "Test if credentials for a service are valid",
    examples: [
      ["Test GitHub credentials", "nathan auth test github"],
    ],
  });

  service = Option.String({ required: true, name: "service" });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

  async execute(): Promise<void> {
    const plugin = registry.get(this.service);
    if (!plugin) {
      printError(`Unknown service "${this.service}".`, { human: this.human });
      process.exitCode = 1;
      return;
    }

    const credSpec = plugin.descriptor.credentials[0];
    if (!credSpec) {
      printOutput(
        { status: "ok", service: this.service, message: "Service does not require credentials" },
        { human: this.human },
      );
      return;
    }

    // Resolve credentials through the full chain
    const resolvedCreds = await resolveCredentialsForPlugin(plugin.descriptor);
    const cred = resolvedCreds.find((c) => c.typeName === credSpec.name);

    if (!cred || (!cred.primarySecret && Object.keys(cred.fields).length === 0)) {
      printError(
        `No credentials found for "${this.service}". Run 'nathan auth add ${this.service} --token=<value>' first.`,
        { human: this.human },
      );
      process.exitCode = 1;
      return;
    }

    // Load credential type info
    const credTypeInfo = loadCredentialType(credSpec.name);
    if (!credTypeInfo) {
      printOutput(
        {
          status: "ok",
          service: this.service,
          type: credSpec.name,
          message: "Credentials found (no credential type info available)",
        },
        { human: this.human },
      );
      return;
    }

    // Delegate to credential tester
    const result = await testCredentials(cred, credTypeInfo);

    printOutput(
      { ...result, service: this.service, type: credSpec.name },
      { human: this.human },
    );

    if (result.status === "error") {
      process.exitCode = 1;
    }
  }
}

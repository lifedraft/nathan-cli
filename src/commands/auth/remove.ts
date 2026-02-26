/**
 * nathan auth remove <service> — Remove credentials for a service.
 */

import { Command, Option } from "clipanion";
import { createCredentialStore } from "../../core/credential-store.js";
import { printOutput, printError } from "../output.js";

export class AuthRemoveCommand extends Command {
  static override paths = [["auth", "remove"]];

  static override usage = Command.Usage({
    description: "Remove stored credentials for a service",
    examples: [
      ["Remove GitHub credentials", "nathan auth remove github"],
    ],
  });

  service = Option.String({ required: true, name: "service" });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

  async execute(): Promise<void> {
    try {
      const store = createCredentialStore();
      const removed = await store.remove(this.service);

      if (removed) {
        printOutput(
          {
            status: "ok",
            service: this.service,
            message: `Credentials removed for ${this.service}`,
          },
          { human: this.human },
        );
      } else {
        printError(
          `No credentials found for "${this.service}".`,
          { human: this.human },
        );
        process.exitCode = 1;
      }
    } catch (err) {
      printError(
        `Failed to access credential store: ${err instanceof Error ? err.message : String(err)}`,
        { human: this.human },
      );
      process.exitCode = 1;
    }
  }
}

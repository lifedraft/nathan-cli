/**
 * nathan auth list — List all configured credentials.
 *
 * Shows services with their credential type and field names (never values).
 */

import { Command, Option } from "clipanion";
import { createCredentialStore } from "../../core/credential-store.js";
import { printOutput } from "../../core/output.js";

export class AuthListCommand extends Command {
  static override paths = [["auth", "list"]];

  static override usage = Command.Usage({
    description: "List all configured service credentials",
    examples: [
      ["List credentials", "nathan auth list"],
    ],
  });

  human = Option.Boolean("--human", false, {
    description: "Output in human-readable format instead of JSON",
  });

  async execute(): Promise<void> {
    const store = createCredentialStore();
    const credentials = await store.list();

    const entries = credentials.map((cred) => ({
      service: cred.service,
      type: cred.type,
      fields: Object.keys(cred.fields),
      updatedAt: cred.updatedAt,
    }));

    printOutput(
      { status: "ok", credentials: entries },
      { human: this.human },
    );
  }
}

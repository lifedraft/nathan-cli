/**
 * nathan auth test <service> — Test credentials for a service.
 *
 * Resolves credentials via the full chain (env → store), then uses the
 * n8n credential type's test.request config to make a validation API call.
 */

import { Command, Option } from "clipanion";
import { getPlugin } from "../../core/plugin-loader.js";
import { resolveCredentialsForPlugin, buildN8nCredentials } from "../../core/credential-resolver.js";
import { loadCredentialTypeDefinition } from "../../core/credential-store.js";
import { printOutput, printError } from "../../core/output.js";

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
    const plugin = getPlugin(this.service);
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
    const flatCreds = await resolveCredentialsForPlugin(plugin.descriptor);
    const credTypes = plugin.descriptor.credentials.map((c) => c.name);
    const n8nCreds = buildN8nCredentials(flatCreds, credTypes);

    const creds = n8nCreds[credSpec.name];
    if (!creds || Object.keys(creds).length === 0) {
      printError(
        `No credentials found for "${this.service}". Run 'nathan auth add ${this.service} --token=<value>' first.`,
        { human: this.human },
      );
      process.exitCode = 1;
      return;
    }

    // Load the credential type's test config
    const credTypeDef = loadCredentialTypeDefinition(credSpec.name);
    if (!credTypeDef?.test?.request) {
      // No test endpoint defined — just confirm credentials exist
      printOutput(
        {
          status: "ok",
          service: this.service,
          type: credSpec.name,
          message: "Credentials found (no test endpoint defined for this credential type)",
        },
        { human: this.human },
      );
      return;
    }

    // Build the test request from the credential type's test config
    const testReq = credTypeDef.test.request;
    let baseUrl = resolveTemplate(testReq.baseURL ?? "", creds);
    const url = resolveTemplate(testReq.url ?? "", creds);
    const method = testReq.method ?? "GET";

    // Build the full URL
    const fullUrl = baseUrl ? `${baseUrl}${url}` : url;

    if (!fullUrl) {
      printError("Cannot determine test URL from credential type definition.", { human: this.human });
      process.exitCode = 1;
      return;
    }

    // Inject authentication
    const headers: Record<string, string> = {};
    if (credTypeDef.authenticate?.type === "generic" && credTypeDef.authenticate.properties?.headers) {
      for (const [key, template] of Object.entries(credTypeDef.authenticate.properties.headers as Record<string, string>)) {
        headers[key] = resolveTemplate(template, creds);
      }
    } else {
      // Fallback: try Bearer token
      const token = creds.accessToken ?? creds.token ?? creds.apiKey;
      if (token) {
        headers["Authorization"] = `Bearer ${String(token)}`;
      }
    }

    try {
      const response = await fetch(fullUrl, { method, headers });

      if (response.ok) {
        printOutput(
          {
            status: "ok",
            service: this.service,
            type: credSpec.name,
            statusCode: response.status,
            message: "Credentials are valid",
          },
          { human: this.human },
        );
      } else {
        const body = await response.text().catch(() => "");
        printOutput(
          {
            status: "error",
            service: this.service,
            type: credSpec.name,
            statusCode: response.status,
            message: `Authentication failed: HTTP ${response.status}`,
            details: body.slice(0, 500),
          },
          { human: this.human },
        );
        process.exitCode = 1;
      }
    } catch (err) {
      printError(
        `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
        { human: this.human },
      );
      process.exitCode = 1;
    }
  }
}

/**
 * Resolve n8n-style expression templates in credential config.
 * Handles patterns like: '={{$credentials?.server}}' and '=token {{$credentials?.accessToken}}'
 */
function resolveTemplate(template: string, credentials: Record<string, unknown>): string {
  let expr = template.startsWith("=") ? template.slice(1) : template;
  expr = expr.replace(
    /\{\{\s*\$credentials\??\.\s*(\w+)\s*\}\}/g,
    (_match, key) => {
      const val = credentials[key];
      return val !== undefined ? String(val) : "";
    },
  );
  return expr;
}

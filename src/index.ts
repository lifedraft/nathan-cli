#!/usr/bin/env bun
/**
 * nathan — AI-agent-friendly CLI for unified API orchestration.
 *
 * Loads plugins, registers dynamic commands, then runs the CLI.
 */

import { Cli, Builtins } from "clipanion";
import { join } from "node:path";

import { DiscoverCommand } from "./commands/discover.js";
import { DescribeCommand } from "./commands/describe.js";
import { RunCommand } from "./commands/run.js";
import { AuthAddCommand } from "./commands/auth/add.js";
import { AuthListCommand } from "./commands/auth/list.js";
import { AuthTestCommand } from "./commands/auth/test.js";
import { AuthRemoveCommand } from "./commands/auth/remove.js";
import { PluginInstallCommand } from "./commands/plugin/install.js";
import { PluginListCommand } from "./commands/plugin/list.js";
import { loadConfig } from "./core/config.js";
import { registry } from "./core/registry-instance.js";
import { loadPluginsFromDir, registerLoaderStrategy } from "./core/plugin-loader.js";
import { createPluginCommands } from "./commands/dynamic.js";
import { loadN8nNodeFromPath, validateModulePath } from "./n8n-compat/loader.js";
import {
  registerCredentialIntrospectionStrategy,
  registerCredentialExpressionResolver,
} from "./core/credential-introspector.js";
import {
  loadCredentialTypeDefinition,
  resolveCredentialExpression,
} from "./n8n-compat/credential-type-loader.js";

// ---------------------------------------------------------------------------
// Register n8n-compat loader strategy
// ---------------------------------------------------------------------------

registerLoaderStrategy(async (_filePath, manifest) => {
  if ((manifest.type === "adapted" || manifest.type === "n8n-compat") && typeof manifest.module === "string") {
    if (!validateModulePath(manifest.module)) {
      throw new Error(`Unsafe module path: ${manifest.module}`);
    }
    const modulePath = join(process.cwd(), "node_modules", manifest.module);
    return loadN8nNodeFromPath(modulePath);
  }
  return null;
});

// ---------------------------------------------------------------------------
// Register n8n-compat credential introspection strategy
// ---------------------------------------------------------------------------

registerCredentialIntrospectionStrategy(loadCredentialTypeDefinition);

registerCredentialExpressionResolver(resolveCredentialExpression);

// ---------------------------------------------------------------------------
// Load plugins
// ---------------------------------------------------------------------------

const config = loadConfig();

try {
  for (const dir of config.pluginDirs) {
    await loadPluginsFromDir(dir, registry);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ error: { code: "STARTUP_ERROR", message: `Failed to load plugins: ${msg}` } }));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const cli = new Cli({
  binaryLabel: "nathan",
  binaryName: "nathan",
  binaryVersion: "0.1.0",
});

// Built-in commands
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

// Static commands
cli.register(DiscoverCommand);
cli.register(DescribeCommand);
cli.register(RunCommand);
cli.register(AuthAddCommand);
cli.register(AuthListCommand);
cli.register(AuthTestCommand);
cli.register(AuthRemoveCommand);
cli.register(PluginInstallCommand);
cli.register(PluginListCommand);

// Dynamic commands from loaded plugins
for (const plugin of registry.getAll()) {
  for (const cmd of createPluginCommands(plugin)) {
    cli.register(cmd);
  }
}

cli.runExit(process.argv.slice(2));

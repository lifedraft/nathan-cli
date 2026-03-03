#!/usr/bin/env bun
/**
 * nathan — AI-agent-friendly CLI for unified API orchestration.
 *
 * Loads plugins, registers dynamic commands, then runs the CLI.
 */

import { join } from 'node:path';

import { Cli, Builtins } from 'clipanion';

import { DescribeCommand } from './commands/describe.js';
import { DiscoverCommand } from './commands/discover.js';
import { createPluginCommands, createLazyPluginCommand } from './commands/dynamic.js';
import { PluginInstallCommand } from './commands/plugin/install.js';
import { PluginListCommand } from './commands/plugin/list.js';
import { RunCommand } from './commands/run.js';
import { loadConfig } from './core/config.js';
import {
  registerCredentialIntrospectionStrategy,
  registerCredentialExpressionResolver,
} from './core/credential-introspector.js';
import { loadPluginsFromDir, registerLoaderStrategy } from './core/plugin-loader.js';
import { registry } from './core/registry-instance.js';
import {
  loadCredentialTypeDefinition,
  resolveCredentialExpression,
} from './n8n-compat/credential-type-loader.js';
import { discoverN8nNodes } from './n8n-compat/discovery.js';
import { loadN8nNodeFromPath, validateModulePath } from './n8n-compat/loader.js';

// ---------------------------------------------------------------------------
// Register n8n-compat loader strategy
// ---------------------------------------------------------------------------

registerLoaderStrategy(async (_filePath, manifest) => {
  if (
    (manifest.type === 'adapted' || manifest.type === 'n8n-compat') &&
    typeof manifest.module === 'string'
  ) {
    if (!validateModulePath(manifest.module)) {
      throw new Error(`Unsafe module path: ${manifest.module}`);
    }
    const modulePath = join(process.cwd(), 'node_modules', manifest.module);
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
  console.error(
    JSON.stringify({ error: { code: 'STARTUP_ERROR', message: `Failed to load plugins: ${msg}` } }),
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Auto-discover n8n nodes (lazy registration)
// ---------------------------------------------------------------------------

try {
  const discovered = discoverN8nNodes();
  for (const entry of discovered) {
    if (!registry.has(entry.serviceName)) {
      registry.registerLazy(entry.serviceName, () => loadN8nNodeFromPath(entry.modulePath));
    }
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[nathan] Warning: n8n node auto-discovery failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const cli = new Cli({
  binaryLabel: 'nathan',
  binaryName: 'nathan',
  binaryVersion: '0.1.0',
});

// Built-in commands
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

// Static commands
cli.register(DiscoverCommand);
cli.register(DescribeCommand);
cli.register(RunCommand);
cli.register(PluginInstallCommand);
cli.register(PluginListCommand);

// Dynamic commands from loaded plugins (eagerly loaded — full 3-segment paths)
for (const plugin of registry.getAll()) {
  for (const cmd of createPluginCommands(plugin)) {
    cli.register(cmd);
  }
}

// Lazy commands for plugins that haven't been loaded yet (1-segment catch-all).
// Skip names that collide with built-in commands to avoid ambiguous routing.
const RESERVED_COMMANDS = new Set(['run', 'describe', 'discover', 'plugin', 'help', 'version']);
for (const name of registry.getAllNames()) {
  if (registry.isLazy(name) && !RESERVED_COMMANDS.has(name)) {
    cli.register(createLazyPluginCommand(name, registry));
  }
}

cli.runExit(process.argv.slice(2));

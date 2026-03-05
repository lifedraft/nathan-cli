#!/usr/bin/env bun
/**
 * nathan — AI-agent-friendly CLI for unified API orchestration.
 *
 * Loads plugins, registers dynamic commands, then runs the CLI.
 */

declare const __APP_VERSION__: string;

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { plugin as bunPlugin } from 'bun';
import { Cli, Builtins } from 'clipanion';

import { DescribeCommand } from './commands/describe.js';
import { createPluginCommands, createLazyPluginCommand } from './commands/dynamic.js';
import { HelpCommand } from './commands/help.js';
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
  registerCommunityCredentialPath,
  resolveCredentialExpression,
} from './n8n-compat/credential-type-loader.js';
import { discoverN8nNodes, discoverCommunityN8nNodes } from './n8n-compat/discovery.js';
import { loadN8nNodeFromPath, validateModulePath } from './n8n-compat/loader.js';

// ---------------------------------------------------------------------------
// Stub n8n-core so n8n-nodes-base can load without the full dependency tree.
// This replaces the old postinstall script that copied a stub to node_modules.
// ---------------------------------------------------------------------------

bunPlugin({
  name: 'n8n-core-stub',
  setup(build) {
    build.module('n8n-core', () => ({
      exports: {
        getWebhookSandboxCSP() {
          return '';
        },
        ErrorReporter: {
          error() {},
          warn() {},
          info() {},
        },
      },
      loader: 'object',
    }));
  },
});

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

const builtinPluginDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins');
const config = loadConfig(undefined, { builtinPluginDir });

try {
  for (const dir of config.pluginDirs) {
    // eslint-disable-next-line no-await-in-loop -- sequential: plugin dirs may depend on load order
    await loadPluginsFromDir(dir, registry);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: Failed to load plugins: ${msg}`);
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
// Auto-discover community n8n nodes (lazy registration)
// ---------------------------------------------------------------------------

try {
  const communityPackages = discoverCommunityN8nNodes();
  for (const pkg of communityPackages) {
    for (const cred of pkg.credentials) {
      registerCommunityCredentialPath(cred.typeName, cred.modulePath);
    }
    for (const entry of pkg.nodes) {
      if (!registry.has(entry.serviceName)) {
        registry.registerLazy(entry.serviceName, () => loadN8nNodeFromPath(entry.modulePath));
      }
    }
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[nathan] Warning: community n8n node discovery failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const cli = new Cli({
  binaryLabel: 'nathan',
  binaryName: 'nathan',
  binaryVersion:
    __APP_VERSION__ !== undefined
      ? __APP_VERSION__
      : (process.env.npm_package_version ?? '0.0.0-dev'),
});

// Built-in commands
cli.register(HelpCommand);
cli.register(Builtins.VersionCommand);

// Static commands
cli.register(DescribeCommand);
cli.register(RunCommand);
cli.register(PluginListCommand);

// Dynamic commands from loaded plugins (eagerly loaded — full 3-segment paths)
for (const plugin of registry.getAll()) {
  for (const cmd of createPluginCommands(plugin)) {
    cli.register(cmd);
  }
}

// Lazy commands for plugins that haven't been loaded yet (1-segment catch-all).
// Skip names that collide with built-in commands to avoid ambiguous routing.
const RESERVED_COMMANDS = new Set(['run', 'describe', 'plugin', 'help', 'version']);
for (const name of registry.getAllNames()) {
  if (registry.isLazy(name) && !RESERVED_COMMANDS.has(name)) {
    cli.register(createLazyPluginCommand(name, registry));
  }
}

cli.runExit(process.argv.slice(2));

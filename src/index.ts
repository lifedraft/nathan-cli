#!/usr/bin/env bun
/**
 * nathan — AI-agent-friendly CLI for unified API orchestration.
 *
 * Loads plugins, registers dynamic commands, then runs the CLI.
 */

import { Cli, Builtins } from "clipanion";
import { join } from "node:path";
import { homedir } from "node:os";

import { DiscoverCommand } from "./commands/discover.js";
import { DescribeCommand } from "./commands/describe.js";
import { RunCommand } from "./commands/run.js";
import { AuthAddCommand } from "./commands/auth/add.js";
import { AuthListCommand } from "./commands/auth/list.js";
import { AuthTestCommand } from "./commands/auth/test.js";
import { AuthRemoveCommand } from "./commands/auth/remove.js";
import { PluginInstallCommand } from "./commands/plugin/install.js";
import { PluginListCommand } from "./commands/plugin/list.js";
import { getAllPlugins, loadPluginsFromDir } from "./core/plugin-loader.js";
import { createPluginCommands } from "./commands/dynamic.js";

// Plugin search paths (in order):
// 1. NATHAN_PLUGINS env var
// 2. ~/.nathan/plugins
// 3. ./plugins (relative to cwd, for development)
const pluginDirs = [
  process.env.NATHAN_PLUGINS,
  join(homedir(), ".nathan", "plugins"),
  join(process.cwd(), "plugins"),
].filter(Boolean) as string[];

for (const dir of pluginDirs) {
  await loadPluginsFromDir(dir);
}

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
for (const plugin of getAllPlugins()) {
  for (const cmd of createPluginCommands(plugin)) {
    cli.register(cmd);
  }
}

cli.runExit(process.argv.slice(2));

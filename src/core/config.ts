/**
 * Centralized configuration for the nathan runtime.
 *
 * All environment variable reads should funnel through this module
 * so that the rest of the system operates on a typed config object
 * rather than reaching into process.env directly.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface NathanConfig {
  /** Enable verbose debug logging. */
  debug: boolean;
  /** Allow sending credentials over insecure HTTP (bypasses HTTPS enforcement). */
  allowHttp: boolean;
  /** Directories to search for plugins (in order). */
  pluginDirs: string[];
}

/**
 * Load configuration from environment variables.
 *
 * Accepts an optional env parameter for testing (defaults to process.env).
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  opts?: { builtinPluginDir?: string },
): NathanConfig {
  const dirs = [
    opts?.builtinPluginDir,
    env.NATHAN_PLUGINS,
    join(homedir(), '.nathan', 'plugins'),
    join(process.cwd(), 'plugins'),
  ].filter((x): x is string => typeof x === 'string');

  // Deduplicate by resolved absolute path
  const seen = new Set<string>();
  const pluginDirs: string[] = [];
  for (const d of dirs) {
    const abs = resolve(d);
    if (!seen.has(abs)) {
      seen.add(abs);
      pluginDirs.push(d);
    }
  }

  return {
    debug: !!env.NATHAN_DEBUG,
    allowHttp: !!env.NATHAN_ALLOW_HTTP,
    pluginDirs,
  };
}

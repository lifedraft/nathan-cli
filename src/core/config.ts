/**
 * Centralized configuration for the nathan runtime.
 *
 * All environment variable reads should funnel through this module
 * so that the rest of the system operates on a typed config object
 * rather than reaching into process.env directly.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

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
export function loadConfig(env: Record<string, string | undefined> = process.env): NathanConfig {
  return {
    debug: !!env.NATHAN_DEBUG,
    allowHttp: !!env.NATHAN_ALLOW_HTTP,
    pluginDirs: [
      env.NATHAN_PLUGINS,
      join(homedir(), '.nathan', 'plugins'),
      join(process.cwd(), 'plugins'),
    ].filter((x): x is string => typeof x === 'string'),
  };
}

/**
 * Injectable plugin registry.
 *
 * Replaces the module-level Map singleton previously in plugin-loader.ts.
 * The registry is created in the composition root and passed to consumers,
 * enabling isolated testing and multiple registry instances.
 */

import type { Plugin } from "./plugin-interface.js";

export interface PluginRegistry {
  /** Register a plugin. Overwrites if name already exists. */
  register(plugin: Plugin): void;
  /** Get a plugin by name. */
  get(name: string): Plugin | undefined;
  /** Get all registered plugins. */
  getAll(): Plugin[];
  /** Check if a plugin is registered. */
  has(name: string): boolean;
  /** Remove all registered plugins. */
  clear(): void;
}

/**
 * Create an in-memory plugin registry.
 */
export function createPluginRegistry(): PluginRegistry {
  const map = new Map<string, Plugin>();

  return {
    register(plugin) {
      map.set(plugin.descriptor.name, plugin);
    },
    get(name) {
      return map.get(name);
    },
    getAll() {
      return Array.from(map.values());
    },
    has(name) {
      return map.has(name);
    },
    clear() {
      map.clear();
    },
  };
}

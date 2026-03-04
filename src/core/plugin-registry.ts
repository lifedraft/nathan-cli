/**
 * Injectable plugin registry.
 *
 * Replaces the module-level Map singleton previously in plugin-loader.ts.
 * The registry is created in the composition root and passed to consumers,
 * enabling isolated testing and multiple registry instances.
 *
 * Supports lazy registration: a plugin can be registered with just a name
 * and a loader function. The loader is called on first access via getOrLoad().
 */

import type { Plugin } from './plugin-interface.js';

export interface PluginRegistry {
  /** Register a plugin eagerly. Overwrites if name already exists (including lazy). */
  register(plugin: Plugin): void;
  /** Register a lazy loader. No-op if the name is already eagerly loaded. */
  registerLazy(name: string, loader: () => Promise<Plugin>): void;
  /** Get an eagerly loaded plugin by name. */
  get(name: string): Plugin | undefined;
  /** Get a plugin, loading it lazily if needed. */
  getOrLoad(name: string): Promise<Plugin | undefined>;
  /** Get all eagerly loaded plugins. */
  getAll(): Plugin[];
  /** Get all registered names (eager + lazy). */
  getAllNames(): string[];
  /** Check if a plugin is registered (eager or lazy). */
  has(name: string): boolean;
  /** Check if a plugin is registered as lazy (not yet loaded). */
  isLazy(name: string): boolean;
  /** Remove all registered plugins (eager and lazy). */
  clear(): void;
}

/**
 * Create an in-memory plugin registry with lazy loading support.
 */
export function createPluginRegistry(): PluginRegistry {
  const loaded = new Map<string, Plugin>();
  const lazy = new Map<string, () => Promise<Plugin>>();

  return {
    register(plugin) {
      const name = plugin.descriptor.name;
      loaded.set(name, plugin);
      lazy.delete(name);
    },
    registerLazy(name, loader) {
      // Don't overwrite an eagerly loaded plugin
      if (loaded.has(name)) return;
      lazy.set(name, loader);
    },
    get(name) {
      return loaded.get(name);
    },
    async getOrLoad(name) {
      const existing = loaded.get(name);
      if (existing) return existing;

      const loader = lazy.get(name);
      if (!loader) return undefined;

      const plugin = await loader();
      loaded.set(name, plugin);
      lazy.delete(name);
      return plugin;
    },
    getAll() {
      return Array.from(loaded.values());
    },
    getAllNames() {
      const names = new Set([...loaded.keys(), ...lazy.keys()]);
      return Array.from(names).toSorted();
    },
    has(name) {
      return loaded.has(name) || lazy.has(name);
    },
    isLazy(name) {
      return lazy.has(name) && !loaded.has(name);
    },
    clear() {
      loaded.clear();
      lazy.clear();
    },
  };
}

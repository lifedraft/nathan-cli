/**
 * Singleton plugin registry instance.
 *
 * Separated from index.ts to avoid circular imports — commands need
 * the registry, and index.ts imports commands.
 */

import { createPluginRegistry } from './plugin-registry.js';

export const registry = createPluginRegistry();

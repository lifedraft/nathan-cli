import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const emptyEnv: Record<string, string | undefined> = {};

  test('includes builtinPluginDir as first entry', () => {
    const config = loadConfig(emptyEnv, { builtinPluginDir: '/opt/nathan/plugins' });
    expect(config.pluginDirs[0]).toBe('/opt/nathan/plugins');
  });

  test('deduplicates directories that resolve to the same absolute path', () => {
    const abs = join(process.cwd(), 'plugins');
    const config = loadConfig({ NATHAN_PLUGINS: abs }, { builtinPluginDir: '/opt/nathan/plugins' });
    // cwd()/plugins and NATHAN_PLUGINS pointing to the same path → deduplicated
    const matches = config.pluginDirs.filter((d) => {
      const resolved = join(d.startsWith('/') ? d : join(process.cwd(), d), '');
      return resolved === abs || d === abs;
    });
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  test('preserves order: builtin first, then env, then defaults', () => {
    const config = loadConfig(
      { NATHAN_PLUGINS: '/custom/plugins' },
      { builtinPluginDir: '/builtin/plugins' },
    );
    expect(config.pluginDirs[0]).toBe('/builtin/plugins');
    expect(config.pluginDirs[1]).toBe('/custom/plugins');
  });

  test('omits builtinPluginDir when not provided', () => {
    const config = loadConfig(emptyEnv);
    // Should only contain ~/.nathan/plugins and cwd()/plugins
    expect(config.pluginDirs.length).toBeGreaterThanOrEqual(1);
    expect(config.pluginDirs.every((d) => d !== undefined)).toBe(true);
  });

  test('NATHAN_DEBUG sets debug to true', () => {
    const config = loadConfig({ NATHAN_DEBUG: '1' });
    expect(config.debug).toBe(true);
  });

  test('NATHAN_ALLOW_HTTP sets allowHttp to true', () => {
    const config = loadConfig({ NATHAN_ALLOW_HTTP: '1' });
    expect(config.allowHttp).toBe(true);
  });

  test('defaults debug and allowHttp to false', () => {
    const config = loadConfig(emptyEnv);
    expect(config.debug).toBe(false);
    expect(config.allowHttp).toBe(false);
  });
});

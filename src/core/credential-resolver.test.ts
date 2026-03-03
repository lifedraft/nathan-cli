import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { resolveCredentialsForPlugin } from './credential-resolver.js';
import type { PluginDescriptor } from './plugin-interface.js';

// Mock descriptor with one credential type
const mockDescriptor: PluginDescriptor = {
  name: 'github',
  displayName: 'GitHub',
  description: 'GitHub API',
  version: '1.0.0',
  type: 'adapted',
  credentials: [
    {
      name: 'githubApi',
      displayName: 'GitHub API',
      type: 'bearer',
      fields: [],
    },
  ],
  resources: [],
};

describe('resolveCredentialsForPlugin', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save env vars we'll modify
    for (const key of ['NATHAN_GITHUB_TOKEN', 'GITHUB_TOKEN', 'NATHAN_GITHUB_SERVER']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test('returns empty array for plugins with no credentials', async () => {
    const desc: PluginDescriptor = { ...mockDescriptor, credentials: [] };
    const result = await resolveCredentialsForPlugin(desc);
    expect(result).toEqual([]);
  });

  test('resolves credentials from NATHAN_<SERVICE>_TOKEN', async () => {
    process.env.NATHAN_GITHUB_TOKEN = 'ghp_test123';
    const result = await resolveCredentialsForPlugin(mockDescriptor);
    expect(result).toHaveLength(1);
    expect(result[0].typeName).toBe('githubApi');
    expect(result[0].primarySecret).toBe('ghp_test123');
  });

  test('resolves credentials from <SERVICE>_TOKEN fallback', async () => {
    process.env.GITHUB_TOKEN = 'ghp_fallback';
    const result = await resolveCredentialsForPlugin(mockDescriptor);
    expect(result).toHaveLength(1);
    expect(result[0].primarySecret).toBe('ghp_fallback');
  });

  test('collects field overrides from NATHAN_<SERVICE>_<FIELD>', async () => {
    process.env.NATHAN_GITHUB_TOKEN = 'ghp_test123';
    process.env.NATHAN_GITHUB_SERVER = 'https://github.example.com';
    const result = await resolveCredentialsForPlugin(mockDescriptor);
    expect(result).toHaveLength(1);
    expect(result[0].fields.server).toBe('https://github.example.com');
  });

  test('ResolvedCredentials has correct shape', async () => {
    process.env.NATHAN_GITHUB_TOKEN = 'ghp_test123';
    const result = await resolveCredentialsForPlugin(mockDescriptor);
    const cred = result[0];
    // Verify shape: typeName, primarySecret, fields
    expect(typeof cred.typeName).toBe('string');
    expect(typeof cred.primarySecret).toBe('string');
    expect(typeof cred.fields).toBe('object');
    // No __field_ prefix anywhere
    for (const key of Object.keys(cred.fields)) {
      expect(key.startsWith('__field_')).toBe(false);
    }
  });
});

import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';

import type { ResolvedCredentials } from '../core/plugin-interface.js';
import { loadN8nNodeFromPath, buildN8nCredentials, validateModulePath } from './loader.js';

describe('validateModulePath', () => {
  test('accepts valid module paths', () => {
    expect(validateModulePath('n8n-nodes-base/dist/nodes/Github/Github.node.js')).toBe(true);
    expect(validateModulePath('@scope/package/dist/index.js')).toBe(true);
  });

  test('rejects path traversal', () => {
    expect(validateModulePath('../../../etc/passwd')).toBe(false);
    expect(validateModulePath('n8n-nodes-base/../other')).toBe(false);
  });

  test('rejects absolute paths', () => {
    expect(validateModulePath('/etc/passwd')).toBe(false);
  });
});

describe('buildN8nCredentials', () => {
  test('builds credential objects from ResolvedCredentials', () => {
    const creds: ResolvedCredentials[] = [
      {
        typeName: 'githubApi',
        primarySecret: 'ghp_test123',
        fields: { server: 'https://api.github.com' },
      },
    ];

    const result = buildN8nCredentials(creds);
    expect(result.githubApi).toBeTruthy();
    expect(result.githubApi.accessToken).toBe('ghp_test123');
    expect(result.githubApi.token).toBe('ghp_test123');
    expect(result.githubApi.server).toBe('https://api.github.com');
  });

  test('skips credentials with no secret and no fields', () => {
    const creds: ResolvedCredentials[] = [
      { typeName: 'githubApi', primarySecret: undefined, fields: {} },
    ];
    const result = buildN8nCredentials(creds);
    expect(result.githubApi).toBeUndefined();
  });

  test('field values take precedence over primary secret aliases', () => {
    const creds: ResolvedCredentials[] = [
      {
        typeName: 'githubApi',
        primarySecret: 'generic_token',
        fields: { accessToken: 'specific_token' },
      },
    ];
    const result = buildN8nCredentials(creds);
    // accessToken was explicitly set in fields, should not be overwritten
    expect(result.githubApi.accessToken).toBe('specific_token');
  });
});

describe('loadN8nNodeFromPath (GitHub node)', () => {
  const githubModulePath = join(
    process.cwd(),
    'node_modules',
    'n8n-nodes-base/dist/nodes/Github/Github.node.js',
  );

  test('loads the GitHub node successfully', async () => {
    const plugin = await loadN8nNodeFromPath(githubModulePath);
    expect(plugin).toBeTruthy();
    expect(plugin.descriptor.name).toBe('github');
    expect(plugin.descriptor.type).toBe('adapted');
  });

  test('GitHub node has expected resources', async () => {
    const plugin = await loadN8nNodeFromPath(githubModulePath);
    const resourceNames = plugin.descriptor.resources.map((r) => r.name);
    expect(resourceNames).toContain('file');
    expect(resourceNames).toContain('issue');
    expect(resourceNames).toContain('repository');
    expect(resourceNames).toContain('release');
    expect(resourceNames).toContain('user');
  });

  test('GitHub node has credential requirement', async () => {
    const plugin = await loadN8nNodeFromPath(githubModulePath);
    expect(plugin.descriptor.credentials.length).toBeGreaterThan(0);
    expect(plugin.descriptor.credentials[0].name).toBe('githubApi');
  });

  test('GitHub issue resource has get/getAll/create operations', async () => {
    const plugin = await loadN8nNodeFromPath(githubModulePath);
    const issueResource = plugin.descriptor.resources.find((r) => r.name === 'issue');
    expect(issueResource).toBeTruthy();
    const opNames = issueResource!.operations.map((o) => o.name);
    expect(opNames).toContain('get');
    expect(opNames).toContain('create');
  });

  test('GitHub operations have parameters', async () => {
    const plugin = await loadN8nNodeFromPath(githubModulePath);
    const issueResource = plugin.descriptor.resources.find((r) => r.name === 'issue');
    const getOp = issueResource!.operations.find((o) => o.name === 'get');
    expect(getOp).toBeTruthy();
    expect(getOp!.parameters.length).toBeGreaterThan(0);
    // Should have owner and repo parameters
    const paramNames = getOp!.parameters.map((p) => p.name);
    expect(paramNames).toContain('owner');
    expect(paramNames).toContain('repository');
  });
});

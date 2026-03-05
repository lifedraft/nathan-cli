import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';

import {
  registerCredentialIntrospectionStrategy,
  clearCredentialIntrospectionStrategies,
} from '../core/credential-introspector.js';
import type { ResolvedCredentials } from '../core/plugin-interface.js';
import {
  loadCredentialTypeDefinition,
  registerCommunityCredentialPath,
  clearCommunityCredentialPaths,
} from './credential-type-loader.js';
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
    const opNames = issueResource?.operations.map((o) => o.name);
    expect(opNames).toContain('get');
    expect(opNames).toContain('create');
  });

  test('GitHub operations have parameters', async () => {
    const plugin = await loadN8nNodeFromPath(githubModulePath);
    const issueResource = plugin.descriptor.resources.find((r) => r.name === 'issue');
    const getOp = issueResource?.operations.find((o) => o.name === 'get');
    expect(getOp).toBeTruthy();
    expect(getOp?.parameters.length).toBeGreaterThan(0);
    // Should have owner and repo parameters
    const paramNames = getOp?.parameters.map((p) => p.name);
    expect(paramNames).toContain('owner');
    expect(paramNames).toContain('repository');
  });
});

describe('buildN8nCredentials — credential field mapping', () => {
  afterEach(() => {
    clearCommunityCredentialPaths();
    clearCredentialIntrospectionStrategies();
  });

  test('maps primarySecret to password field from credential definition', () => {
    // Register the introspection strategy so loadCredentialType works
    registerCredentialIntrospectionStrategy(loadCredentialTypeDefinition);

    const creds: ResolvedCredentials[] = [
      {
        typeName: 'githubApi',
        primarySecret: 'ghp_test123',
        fields: { server: 'https://api.github.com' },
      },
    ];

    const result = buildN8nCredentials(creds);
    expect(result.githubApi).toBeTruthy();
    // githubApi has accessToken as password field — should be mapped
    expect(result.githubApi.accessToken).toBe('ghp_test123');
    expect(result.githubApi.server).toBe('https://api.github.com');
  });

  test('maps primarySecret to apiToken for confluence cloud credentials', () => {
    registerCredentialIntrospectionStrategy(loadCredentialTypeDefinition);

    const credPath = join(
      process.cwd(),
      'node_modules',
      'n8n-nodes-confluence-cloud/dist/credentials/ConfluenceCloudApi.credentials.js',
    );
    registerCommunityCredentialPath('confluenceCloudApi', credPath);

    const creds: ResolvedCredentials[] = [
      {
        typeName: 'confluenceCloudApi',
        primarySecret: 'my-api-token',
        fields: {
          domain: 'https://example.atlassian.net',
          email: 'user@example.com',
        },
      },
    ];

    const result = buildN8nCredentials(creds);
    expect(result.confluenceCloudApi).toBeTruthy();
    expect(result.confluenceCloudApi.apiToken).toBe('my-api-token');
    expect(result.confluenceCloudApi.domain).toBe('https://example.atlassian.net');
    expect(result.confluenceCloudApi.email).toBe('user@example.com');
  });

  test('maps lowercased env var fields to correct camelCase', () => {
    registerCredentialIntrospectionStrategy(loadCredentialTypeDefinition);

    const credPath = join(
      process.cwd(),
      'node_modules',
      'n8n-nodes-confluence-cloud/dist/credentials/ConfluenceCloudApi.credentials.js',
    );
    registerCommunityCredentialPath('confluenceCloudApi', credPath);

    const creds: ResolvedCredentials[] = [
      {
        typeName: 'confluenceCloudApi',
        primarySecret: 'tok',
        // Simulates env vars: NATHAN_CONFLUENCECLOUD_APITOKEN -> fields.apitoken
        fields: {
          domain: 'https://example.atlassian.net',
          email: 'user@example.com',
          apitoken: 'from-env',
        },
      },
    ];

    const result = buildN8nCredentials(creds);
    // 'apitoken' (lowercase) should map to 'apiToken' (camelCase)
    expect(result.confluenceCloudApi.apiToken).toBe('from-env');
    // The lowercase key should be removed
    expect(result.confluenceCloudApi.apitoken).toBeUndefined();
  });
});

describe('loadN8nNodeFromPath (ConfluenceCloud community node)', () => {
  const confluenceModulePath = join(
    process.cwd(),
    'node_modules',
    'n8n-nodes-confluence-cloud/dist/nodes/ConfluenceCloud/ConfluenceCloud.node.js',
  );

  test('loads the ConfluenceCloud node successfully', async () => {
    const plugin = await loadN8nNodeFromPath(confluenceModulePath);
    expect(plugin).toBeTruthy();
    expect(plugin.descriptor.name).toBe('confluenceCloud');
    expect(plugin.descriptor.type).toBe('adapted');
  });

  test('ConfluenceCloud node has expected resources', async () => {
    const plugin = await loadN8nNodeFromPath(confluenceModulePath);
    const resourceNames = plugin.descriptor.resources.map((r) => r.name);
    expect(resourceNames).toContain('space');
    expect(resourceNames).toContain('page');
  });

  test('ConfluenceCloud node has credential requirement', async () => {
    const plugin = await loadN8nNodeFromPath(confluenceModulePath);
    expect(plugin.descriptor.credentials.length).toBeGreaterThan(0);
    expect(plugin.descriptor.credentials[0].name).toBe('confluenceCloudApi');
  });

  test('ConfluenceCloud space resource has operations', async () => {
    const plugin = await loadN8nNodeFromPath(confluenceModulePath);
    const spaceResource = plugin.descriptor.resources.find((r) => r.name === 'space');
    expect(spaceResource).toBeTruthy();
    expect(spaceResource?.operations.length).toBeGreaterThan(0);
  });
});

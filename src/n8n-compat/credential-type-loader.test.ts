import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';

import {
  loadCredentialTypeDefinition,
  loadCredentialAuthenticate,
  registerCommunityCredentialPath,
  clearCommunityCredentialPaths,
} from './credential-type-loader.js';

afterEach(() => {
  clearCommunityCredentialPaths();
});

describe('loadCredentialTypeDefinition', () => {
  test('loads n8n-nodes-base credential type (githubApi)', () => {
    const info = loadCredentialTypeDefinition('githubApi');
    expect(info).toBeTruthy();
    expect(info?.name).toBe('githubApi');
    expect(info?.properties.length).toBeGreaterThan(0);
  });

  test('returns null for unknown types', () => {
    expect(loadCredentialTypeDefinition('nonExistent')).toBeNull();
  });

  test('loads community credential type when registered', () => {
    const credPath = join(
      process.cwd(),
      'node_modules',
      'n8n-nodes-confluence-cloud/dist/credentials/ConfluenceCloudApi.credentials.js',
    );
    registerCommunityCredentialPath('confluenceCloudApi', credPath);

    const info = loadCredentialTypeDefinition('confluenceCloudApi');
    expect(info).toBeTruthy();
    expect(info?.name).toBe('confluenceCloudApi');

    const fields = info?.properties.map((p) => p.name) ?? [];
    expect(fields).toContain('domain');
    expect(fields).toContain('email');
    expect(fields).toContain('apiToken');
  });

  test('community credential has authenticate config', () => {
    const credPath = join(
      process.cwd(),
      'node_modules',
      'n8n-nodes-confluence-cloud/dist/credentials/ConfluenceCloudApi.credentials.js',
    );
    registerCommunityCredentialPath('confluenceCloudApi', credPath);

    const info = loadCredentialTypeDefinition('confluenceCloudApi');
    expect(info?.authenticate).toBeTruthy();
    expect(info?.authenticate?.basicAuth).toBeTruthy();
  });
});

describe('loadCredentialAuthenticate', () => {
  test('loads auth config from n8n-nodes-base', () => {
    const auth = loadCredentialAuthenticate('githubApi');
    expect(auth).toBeTruthy();
  });

  test('loads auth config from community package', () => {
    const credPath = join(
      process.cwd(),
      'node_modules',
      'n8n-nodes-confluence-cloud/dist/credentials/ConfluenceCloudApi.credentials.js',
    );
    registerCommunityCredentialPath('confluenceCloudApi', credPath);

    const auth = loadCredentialAuthenticate('confluenceCloudApi');
    expect(auth).toBeTruthy();
    expect(auth?.basicAuth).toBeTruthy();
    expect(auth?.basicAuth?.username).toContain('$credentials');
    expect(auth?.basicAuth?.password).toContain('$credentials');
  });

  test('returns null for unknown types', () => {
    expect(loadCredentialAuthenticate('nonExistent')).toBeNull();
  });
});

import { describe, test, expect } from 'bun:test';

import { adaptNodeTypeDescription } from './adapter.js';
import type { INodeTypeDescription } from './types.js';

describe('adaptNodeTypeDescription', () => {
  test('adapts a resource+operation node', () => {
    const desc: INodeTypeDescription = {
      displayName: 'GitHub',
      name: 'github',
      group: ['transform'],
      version: 1,
      description: 'GitHub API',
      defaults: { name: 'GitHub' },
      inputs: ['main'],
      outputs: ['main'],
      credentials: [{ name: 'githubApi', required: true }],
      properties: [
        {
          displayName: 'Resource',
          name: 'resource',
          type: 'options',
          default: 'issue',
          options: [
            { name: 'Issue', value: 'issue', description: 'Work with issues' },
            { name: 'Repository', value: 'repository', description: 'Work with repos' },
          ],
        },
        {
          displayName: 'Operation',
          name: 'operation',
          type: 'options',
          default: 'get',
          displayOptions: { show: { resource: ['issue'] } },
          options: [
            { name: 'Get', value: 'get', description: 'Get an issue' },
            { name: 'Create', value: 'create', description: 'Create an issue' },
          ],
        },
        {
          displayName: 'Operation',
          name: 'operation',
          type: 'options',
          default: 'get',
          displayOptions: { show: { resource: ['repository'] } },
          options: [{ name: 'Get', value: 'get', description: 'Get a repository' }],
        },
        {
          displayName: 'Owner',
          name: 'owner',
          type: 'string',
          default: '',
          description: 'Repository owner',
          displayOptions: { show: { resource: ['issue', 'repository'] } },
        },
      ],
    };

    const result = adaptNodeTypeDescription(desc);

    expect(result.name).toBe('github');
    expect(result.displayName).toBe('GitHub');
    expect(result.type).toBe('adapted');
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0].name).toBe('githubApi');

    // Should have 2 resources
    expect(result.resources).toHaveLength(2);
    const issueResource = result.resources.find((r) => r.name === 'issue');
    const repoResource = result.resources.find((r) => r.name === 'repository');
    expect(issueResource).toBeTruthy();
    expect(repoResource).toBeTruthy();

    // Issue should have 2 operations
    expect(issueResource?.operations).toHaveLength(2);
    expect(issueResource?.operations.map((o) => o.name)).toEqual(['get', 'create']);

    // Repository should have 1 operation
    expect(repoResource?.operations).toHaveLength(1);

    // Operations should require auth
    expect(issueResource?.operations[0].requiresAuth).toBe(true);

    // Owner parameter should be present on issue operations
    const getOp = issueResource?.operations[0];
    expect(getOp?.parameters.some((p) => p.name === 'owner')).toBe(true);
  });

  test('adapts a single-purpose node (no resource/operation)', () => {
    const desc: INodeTypeDescription = {
      displayName: 'HTTP Request',
      name: 'httpRequest',
      group: ['transform'],
      version: 1,
      description: 'Make HTTP requests',
      defaults: { name: 'HTTP Request' },
      inputs: ['main'],
      outputs: ['main'],
      properties: [
        {
          displayName: 'URL',
          name: 'url',
          type: 'string',
          default: '',
          required: true,
        },
      ],
    };

    const result = adaptNodeTypeDescription(desc);

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].name).toBe('default');
    expect(result.resources[0].operations).toHaveLength(1);
    expect(result.resources[0].operations[0].name).toBe('execute');
  });

  test('GET operations default params to query location', () => {
    const desc: INodeTypeDescription = {
      displayName: 'Hacker News',
      name: 'hackerNews',
      group: ['transform'],
      version: 1,
      description: 'Hacker News API',
      defaults: { name: 'Hacker News' },
      inputs: ['main'],
      outputs: ['main'],
      properties: [
        {
          displayName: 'Resource',
          name: 'resource',
          type: 'options',
          default: 'article',
          options: [{ name: 'Article', value: 'article', description: 'Articles' }],
        },
        {
          displayName: 'Operation',
          name: 'operation',
          type: 'options',
          default: 'getAll',
          displayOptions: { show: { resource: ['article'] } },
          options: [
            {
              name: 'Get All',
              value: 'getAll',
              description: 'Get all articles',
              routing: { request: { method: 'GET', url: '/search' } },
            },
          ],
        },
        {
          displayName: 'Additional Fields',
          name: 'additionalFields',
          type: 'collection',
          default: {},
          displayOptions: { show: { resource: ['article'], operation: ['getAll'] } },
          options: [
            {
              displayName: 'Keyword',
              name: 'keyword',
              type: 'string',
              default: '',
              description: 'Search keyword',
            },
          ],
        },
      ],
    };

    const result = adaptNodeTypeDescription(desc);
    const articleResource = result.resources.find((r) => r.name === 'article');
    const getAllOp = articleResource?.operations.find((o) => o.name === 'getAll');

    // The keyword param (child of collection) should default to 'query' for GET
    const keywordParam = getAllOp?.parameters.find((p) => p.name === 'keyword');
    expect(keywordParam).toBeTruthy();
    expect(keywordParam?.location).toBe('query');

    // The parent collection param should also be 'query'
    const additionalFieldsParam = getAllOp?.parameters.find((p) => p.name === 'additionalFields');
    expect(additionalFieldsParam?.location).toBe('query');
  });

  test('POST operations default params to body location', () => {
    const desc: INodeTypeDescription = {
      displayName: 'Test',
      name: 'test',
      group: ['transform'],
      version: 1,
      description: 'Test',
      defaults: { name: 'Test' },
      inputs: ['main'],
      outputs: ['main'],
      properties: [
        {
          displayName: 'Operation',
          name: 'operation',
          type: 'options',
          default: 'create',
          options: [
            {
              name: 'Create',
              value: 'create',
              description: 'Create item',
              routing: { request: { method: 'POST', url: '/items' } },
            },
          ],
        },
        {
          displayName: 'Title',
          name: 'title',
          type: 'string',
          default: '',
          displayOptions: { show: { operation: ['create'] } },
        },
      ],
    };

    const result = adaptNodeTypeDescription(desc);
    const defaultResource = result.resources[0];
    const createOp = defaultResource.operations.find((o) => o.name === 'create');
    const titleParam = createOp?.parameters.find((p) => p.name === 'title');
    expect(titleParam?.location).toBe('body');
  });

  test('handles credentials mapping', () => {
    const desc: INodeTypeDescription = {
      displayName: 'Test',
      name: 'test',
      group: ['transform'],
      version: 1,
      description: 'Test',
      defaults: { name: 'Test' },
      inputs: ['main'],
      outputs: ['main'],
      credentials: [{ name: 'oAuth2Api' }, { name: 'testApiKey' }],
      properties: [],
    };

    const result = adaptNodeTypeDescription(desc);
    expect(result.credentials).toHaveLength(2);
    expect(result.credentials[0].type).toBe('oauth2');
    expect(result.credentials[1].type).toBe('api_key');
  });
});

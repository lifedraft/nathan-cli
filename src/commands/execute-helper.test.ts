import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';

import type { Plugin, PluginDescriptor, Operation } from '../core/plugin-interface.js';
import { executePluginOperation, type CredentialDeps } from './execute-helper.js';

// ---------------------------------------------------------------------------
// Mocks — state-based so individual tests can override behavior.
// Uses dependency injection instead of mock.module to avoid contaminating
// the credential-resolver module for other test files.
// ---------------------------------------------------------------------------

let mockResolve: CredentialDeps['resolveCredentialsForPlugin'] = async () => [
  { typeName: 'test', primarySecret: 'tok', fields: {} },
];
let mockCheck: CredentialDeps['checkCredentialsConfigured'] = () => null;

const mockDeps: CredentialDeps = {
  resolveCredentialsForPlugin: (...args) => mockResolve(...args),
  checkCredentialsConfigured: (...args) => mockCheck(...args),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(overrides: Partial<Operation> = {}): Operation {
  return {
    name: 'list',
    displayName: 'List items',
    description: 'Lists items',
    method: 'GET',
    path: '/items',
    parameters: [],
    output: { format: 'json' },
    requiresAuth: false,
    ...overrides,
  };
}

function makeDescriptor(overrides: Partial<PluginDescriptor> = {}): PluginDescriptor {
  return {
    name: 'test-svc',
    displayName: 'Test Service',
    description: 'A test service',
    version: '1.0.0',
    type: 'native',
    credentials: [],
    resources: [
      {
        name: 'items',
        displayName: 'Items',
        description: 'Item resource',
        operations: [makeOp()],
      },
    ],
    ...overrides,
  };
}

function makePlugin(
  executeFn: Plugin['execute'] = async () => ({ success: true, data: { ok: true } }),
  descriptor?: PluginDescriptor,
): Plugin {
  return { descriptor: descriptor ?? makeDescriptor(), execute: executeFn };
}

// ---------------------------------------------------------------------------
// Spies & cleanup
// ---------------------------------------------------------------------------

let logSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
  errSpy = spyOn(console, 'error').mockImplementation(() => {});
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  // Reset mock delegates to defaults
  mockResolve = async () => [{ typeName: 'test', primarySecret: 'tok', fields: {} }];
  mockCheck = () => null;
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  process.exitCode = savedExitCode ?? 0;
});

function stdout(): string {
  return logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
}

function stderr(): string {
  return errSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executePluginOperation', () => {
  // ---- Success paths ----

  test('success (json: false) → human output on stdout, no exitCode', async () => {
    const plugin = makePlugin(async () => ({ success: true, data: { id: 1, name: 'thing' } }));
    await executePluginOperation(
      { plugin, resource: 'items', operation: 'list', op: makeOp(), rawArgs: [], json: false },
      mockDeps,
    );

    expect(stdout()).toContain('name');
    expect(stdout()).toContain('thing');
    expect(process.exitCode).toBe(0);
  });

  test('success (json: true) → JSON on stdout', async () => {
    const data = { id: 1, items: [1, 2, 3] };
    const plugin = makePlugin(async () => ({ success: true, data }));
    await executePluginOperation(
      { plugin, resource: 'items', operation: 'list', op: makeOp(), rawArgs: [], json: true },
      mockDeps,
    );

    const parsed = JSON.parse(stdout());
    expect(parsed).toEqual(data);
    expect(process.exitCode).toBe(0);
  });

  // ---- Validation errors ----

  test('validation error (json: false) → stderr with "Missing required" + describe hint', async () => {
    const op = makeOp({
      parameters: [
        {
          name: 'owner',
          displayName: 'Owner',
          description: 'repo owner',
          type: 'string',
          required: true,
          location: 'path',
        },
      ],
    });
    const plugin = makePlugin(undefined, makeDescriptor());
    await executePluginOperation(
      { plugin, resource: 'items', operation: 'list', op, rawArgs: [], json: false },
      mockDeps,
    );

    expect(stderr()).toContain('Missing required');
    expect(stderr()).toContain('owner');
    expect(stderr()).toContain('nathan describe');
    expect(process.exitCode).toBe(1);
  });

  test('validation error (json: true) → human-readable error on stderr', async () => {
    const op = makeOp({
      parameters: [
        {
          name: 'owner',
          displayName: 'Owner',
          description: 'repo owner',
          type: 'string',
          required: true,
          location: 'path',
        },
      ],
    });
    const plugin = makePlugin(undefined, makeDescriptor());
    await executePluginOperation(
      { plugin, resource: 'items', operation: 'list', op, rawArgs: [], json: true },
      mockDeps,
    );

    expect(stderr()).toContain('Error:');
    expect(stderr()).toContain('Missing required');
    expect(process.exitCode).toBe(1);
  });

  // ---- Credential errors ----

  test('credential error (json: false) → stderr with human message', async () => {
    mockResolve = async () => [{ typeName: 'testCred', primarySecret: undefined, fields: {} }];
    mockCheck = () => ({
      error: {
        code: 'CREDENTIALS_MISSING',
        message: 'Authentication required for "test-svc".',
        env_vars: ['NATHAN_TEST_SVC_TOKEN'],
      },
    });

    const descriptor = makeDescriptor({
      credentials: [
        {
          name: 'testCred',
          displayName: 'Test Cred',
          type: 'api_key',
          fields: [{ name: 'token', displayName: 'Token', type: 'password', required: true }],
        },
      ],
    });
    const plugin = makePlugin(undefined, descriptor);

    await executePluginOperation(
      { plugin, resource: 'items', operation: 'list', op: makeOp(), rawArgs: [], json: false },
      mockDeps,
    );

    expect(stderr()).toContain('Authentication required');
    expect(process.exitCode).toBe(1);
  });

  // ---- Execution failures ----

  test('execution failure (json: false) → stderr with human error', async () => {
    const plugin = makePlugin(async () => ({
      success: false,
      error: { code: 'HTTP_ERROR', message: 'Not Found' },
    }));
    await executePluginOperation(
      { plugin, resource: 'items', operation: 'list', op: makeOp(), rawArgs: [], json: false },
      mockDeps,
    );

    expect(stderr()).toContain('Not Found');
    expect(process.exitCode).toBe(1);
  });

  test('execution failure (json: true) → human-readable error on stderr', async () => {
    const plugin = makePlugin(async () => ({
      success: false,
      error: { code: 'HTTP_ERROR', message: 'Not Found' },
    }));
    await executePluginOperation(
      { plugin, resource: 'items', operation: 'list', op: makeOp(), rawArgs: [], json: true },
      mockDeps,
    );

    expect(stderr()).toContain('Error: Not Found');
    expect(process.exitCode).toBe(1);
  });

  // ---- Describe hint content ----

  test('describe hint contains service/resource/operation names', async () => {
    const op = makeOp({
      parameters: [
        {
          name: 'id',
          displayName: 'ID',
          description: 'item id',
          type: 'string',
          required: true,
          location: 'path',
        },
      ],
    });
    const plugin = makePlugin(undefined, makeDescriptor());
    await executePluginOperation(
      { plugin, resource: 'items', operation: 'list', op, rawArgs: [], json: false },
      mockDeps,
    );

    const err = stderr();
    expect(err).toContain('test-svc');
    expect(err).toContain('items');
    expect(err).toContain('list');
  });
});

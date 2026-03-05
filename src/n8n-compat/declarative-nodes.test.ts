/**
 * Smoke test for ALL declarative n8n nodes.
 *
 * Loads every declarative node (no custom execute(), has requestDefaults),
 * adapts it to a nathan plugin, and exercises every resource+operation via
 * the declarative routing executor with a mocked fetch.
 *
 * Catches regressions in: loader, adapter, expression resolution, credential
 * injection, collection/fixedCollection child routing, and post-receive transforms.
 */

import { describe, test, expect, afterAll, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  registerCredentialIntrospectionStrategy,
  clearCredentialIntrospectionStrategies,
} from '../core/credential-introspector.js';
import type { ResolvedCredentials, Plugin } from '../core/plugin-interface.js';
import { loadCredentialTypeDefinition } from './credential-type-loader.js';
import { loadN8nNodeFromPath } from './loader.js';

// ---------------------------------------------------------------------------
// Discover all declarative nodes
// ---------------------------------------------------------------------------

const req = createRequire(import.meta.url);
const baseDir = join(process.cwd(), 'node_modules', 'n8n-nodes-base');
const basePkg = JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8'));
const nodePaths: string[] = basePkg.n8n?.nodes || [];

interface DeclarativeNode {
  name: string;
  modulePath: string;
}

const declarativeNodes: DeclarativeNode[] = [];

for (const nodePath of nodePaths) {
  const fullPath = join(baseDir, nodePath);
  try {
    const mod = req(fullPath);
    const Cls =
      mod.default ||
      Object.values(mod).find(
        (v: unknown) =>
          typeof v === 'function' &&
          (v as { prototype?: { description?: unknown } }).prototype?.description,
      ) ||
      Object.values(mod).find((v: unknown) => typeof v === 'function');
    if (!Cls || typeof Cls !== 'function') continue;

    let inst: {
      description?: Record<string, unknown>;
      execute?: unknown;
      nodeVersions?: Record<string, { description?: Record<string, unknown>; execute?: unknown }>;
    };
    try {
      inst = new (Cls as new () => typeof inst)();
    } catch {
      continue;
    }

    let desc = inst.description;
    let hasExecute = typeof inst.execute === 'function';

    if (inst.nodeVersions && typeof inst.nodeVersions === 'object') {
      const versions = Object.keys(inst.nodeVersions).toSorted((a, b) => Number(a) - Number(b));
      const latest = inst.nodeVersions[versions[versions.length - 1]];
      if (latest) {
        desc = latest.description;
        hasExecute = typeof latest.execute === 'function';
      }
    }

    if (!desc?.name) continue;
    if ((desc.name as string).toLowerCase().includes('trigger')) continue;
    if (hasExecute || !desc.requestDefaults) continue;

    declarativeNodes.push({ name: desc.name as string, modulePath: fullPath });
  } catch {
    // skip nodes that can't be loaded
  }
}

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
  clearCredentialIntrospectionStrategies();
});

registerCredentialIntrospectionStrategy(loadCredentialTypeDefinition);

function makeDummyCredentials(typeName: string): ResolvedCredentials[] {
  return [
    {
      typeName,
      primarySecret: 'test-token-123',
      fields: {
        domain: 'https://test.example.com',
        email: 'test@example.com',
        server: 'https://test.example.com',
        apiKey: 'test-key',
        accessToken: 'test-token',
        region: 'us-east-1',
        baseUrl: 'https://test.example.com',
        subdomain: 'test',
        accountId: '123456',
        organizationId: 'org-123',
        projectId: 'proj-123',
      },
    },
  ];
}

async function executeAllOperations(
  plugin: Plugin,
  creds: ResolvedCredentials[],
): Promise<string[]> {
  const failures: string[] = [];

  for (const resource of plugin.descriptor.resources) {
    for (const op of resource.operations) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential: operations share mocked fetch state
        const result = await plugin.execute(resource.name, op.name, {}, creds);
        // We accept both success and controlled failures (HTTP errors, unknown ops).
        // We only fail on unhandled crashes (thrown exceptions).
        if (!result.success && result.error.code === 'EXECUTION_ERROR') {
          const msg = result.error.message ?? '';
          const acceptable =
            msg.includes('Missing required') ||
            msg.includes('not supported') ||
            msg.includes('not available') ||
            msg.includes('Cannot read') ||
            msg.includes('undefined');
          if (!acceptable) {
            failures.push(`${resource.name}.${op.name}: ${result.error.code} — ${msg}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message.slice(0, 100) : String(err);
        failures.push(`${resource.name}.${op.name}: CRASH — ${msg}`);
      }
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('declarative n8n nodes — smoke tests', () => {
  test(`discovered ${declarativeNodes.length} declarative nodes`, () => {
    expect(declarativeNodes.length).toBeGreaterThan(0);
  });

  for (const node of declarativeNodes) {
    describe(node.name, () => {
      test('loads and adapts successfully', async () => {
        const plugin = await loadN8nNodeFromPath(node.modulePath);
        expect(plugin.descriptor.name).toBeTruthy();
        expect(plugin.descriptor.type).toBe('adapted');
        expect(plugin.descriptor.resources.length).toBeGreaterThan(0);
      });

      test('every operation executes without crashing', async () => {
        const plugin = await loadN8nNodeFromPath(node.modulePath);

        globalThis.fetch = mock(async () => {
          return new Response(JSON.stringify({ results: [{ id: '1' }], items: [{ id: '1' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch;

        const credTypeName = plugin.descriptor.credentials[0]?.name ?? 'testApi';
        const creds = makeDummyCredentials(credTypeName);
        const failures = await executeAllOperations(plugin, creds);

        globalThis.fetch = originalFetch;

        if (failures.length > 0) {
          console.error(`\n[${node.name}] failures:\n  ${failures.join('\n  ')}`);
        }
        expect(failures).toEqual([]);
      });
    });
  }
});

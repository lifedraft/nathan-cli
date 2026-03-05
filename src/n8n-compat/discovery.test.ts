import { describe, test, expect } from 'bun:test';
import { existsSync } from 'node:fs';

import { discoverN8nNodes, discoverCommunityN8nNodes } from './discovery.js';

describe('discoverN8nNodes', () => {
  test('discovers base n8n nodes', () => {
    const nodes = discoverN8nNodes();
    expect(nodes.length).toBeGreaterThan(0);
    const serviceNames = nodes.map((n) => n.serviceName);
    expect(serviceNames).toContain('github');
  });

  test('filters out trigger nodes', () => {
    const nodes = discoverN8nNodes();
    const hasTrigger = nodes.some((n) => n.serviceName.includes('trigger'));
    expect(hasTrigger).toBe(false);
  });

  test('filters out excluded nodes', () => {
    const nodes = discoverN8nNodes();
    const serviceNames = nodes.map((n) => n.serviceName);
    expect(serviceNames).not.toContain('if');
    expect(serviceNames).not.toContain('switch');
    expect(serviceNames).not.toContain('code');
  });
});

describe('discoverCommunityN8nNodes', () => {
  test('discovers community packages', () => {
    const packages = discoverCommunityN8nNodes();
    expect(packages.length).toBeGreaterThan(0);
  });

  test('finds n8n-nodes-confluence-cloud', () => {
    const packages = discoverCommunityN8nNodes();
    const allNodes = packages.flatMap((p) => p.nodes);
    const serviceNames = allNodes.map((n) => n.serviceName);
    expect(serviceNames).toContain('confluencecloud');
  });

  test('extracts credential paths from community packages', () => {
    const packages = discoverCommunityN8nNodes();
    const allCreds = packages.flatMap((p) => p.credentials);
    const credTypes = allCreds.map((c) => c.typeName);
    expect(credTypes).toContain('confluenceCloudApi');
  });

  test('module paths point to existing files', () => {
    const packages = discoverCommunityN8nNodes();
    for (const pkg of packages) {
      for (const node of pkg.nodes) {
        expect(existsSync(node.modulePath)).toBe(true);
      }
      for (const cred of pkg.credentials) {
        expect(existsSync(cred.modulePath)).toBe(true);
      }
    }
  });

  test('excludes n8n-nodes-base', () => {
    const packages = discoverCommunityN8nNodes();
    const allNodes = packages.flatMap((p) => p.nodes);
    // github is in n8n-nodes-base, should not appear in community discovery
    const hasGithub = allNodes.some((n) => n.modulePath.includes('n8n-nodes-base'));
    expect(hasGithub).toBe(false);
  });

  test('filters out trigger nodes from community packages', () => {
    const packages = discoverCommunityN8nNodes();
    const allNodes = packages.flatMap((p) => p.nodes);
    const hasTrigger = allNodes.some((n) => n.serviceName.includes('trigger'));
    expect(hasTrigger).toBe(false);
  });
});

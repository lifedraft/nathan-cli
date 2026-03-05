/**
 * Auto-discover n8n nodes from n8n-nodes-base and community packages.
 *
 * Reads the node list from package.json, filters out triggers and
 * workflow-internal nodes, and returns entries ready for lazy registration.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getRequire } from './require.js';

export interface DiscoveredNode {
  /** Full path to the .node.js file inside the package */
  modulePath: string;
  /** Lowercased service name for CLI usage (e.g. "github") */
  serviceName: string;
}

export interface DiscoveredCommunityPackage {
  nodes: DiscoveredNode[];
  credentials: Array<{ typeName: string; modulePath: string }>;
}

/**
 * Nodes that are workflow-internal, not external API services.
 * These make no sense as standalone CLI operations.
 */
const EXCLUDED_NODE_NAMES = new Set([
  // Triggers without "Trigger" in filename
  'Cron',
  'Interval',
  'Schedule',
  'Start',
  // Control flow
  'If',
  'Switch',
  'Filter',
  'Merge',
  'SplitInBatches',
  'CompareDatasets',
  'Wait',
  // Workflow utilities
  'NoOp',
  'StickyNote',
  'StopAndError',
  'Set',
  'RenameKeys',
  'RespondToWebhook',
  'ExecutionData',
  // Code execution
  'Code',
  'Function',
  'FunctionItem',
  'ExecuteCommand',
  'ExecuteWorkflow',
  // File/binary handling
  'ReadBinaryFile',
  'ReadBinaryFiles',
  'ReadPdf',
  'WriteBinaryFile',
  'MoveBinaryData',
  'Files',
  // Data transform
  'Crypto',
  'DateTime',
  'Compression',
  'SpreadsheetFile',
  'Xml',
  'Markdown',
  'Html',
  'HtmlExtract',
  'ItemLists',
  'Jwt',
  'Totp',
  'ICalendar',
  'Transform',
  // Internal/test
  'N8n',
  'N8nTrainingCustomerDatastore',
  'N8nTrainingCustomerMessenger',
  'E2eTest',
  'DebugHelper',
  'ErrorTrigger',
  'Evaluation',
  'TimeSaved',
  'DataTable',
  'Simulate',
  'AiTransform',
  // Infra (requires running servers)
  'Amqp',
  'Kafka',
  'RabbitMQ',
  'MQTT',
  // Other non-API
  'Ssh',
  'Ftp',
  'Ldap',
  'EditImage',
  'Form',
]);

/**
 * Extract the node name stem from a path like
 * "dist/nodes/Github/Github.node.js" → "Github"
 */
function extractNodeName(nodePath: string): string | null {
  const match = nodePath.match(/\/([^/]+)\.node\.js$/);
  return match ? match[1] : null;
}

/**
 * Convert a PascalCase node name to a lowercase service name.
 * "Github" → "github", "ActiveCampaign" → "activecampaign"
 */
function toServiceName(nodeName: string): string {
  return nodeName.toLowerCase();
}

/**
 * Discover all usable n8n nodes from the n8n-nodes-base package.
 *
 * Returns entries suitable for lazy registration — no modules are loaded.
 * This is a pure function over the package.json data.
 */
export function discoverN8nNodes(): DiscoveredNode[] {
  const req = getRequire();
  const pkg = req('n8n-nodes-base/package.json');
  const nodePaths: string[] = pkg?.n8n?.nodes ?? [];

  const results: DiscoveredNode[] = [];

  for (const nodePath of nodePaths) {
    const nodeName = extractNodeName(nodePath);
    if (!nodeName) continue;

    // Skip triggers
    if (nodeName.includes('Trigger')) continue;

    // Skip excluded workflow-internal nodes
    if (EXCLUDED_NODE_NAMES.has(nodeName)) continue;

    const serviceName = toServiceName(nodeName);
    const modulePath = join(
      req.resolve('n8n-nodes-base/package.json').replace('/package.json', ''),
      nodePath,
    );

    results.push({ modulePath, serviceName });
  }

  return results;
}

/**
 * Derive the credential type name from a credential file path.
 * E.g. "dist/credentials/ConfluenceCloudApi.credentials.js" → "confluenceCloudApi"
 */
function credentialTypeNameFromPath(credPath: string): string | null {
  const match = credPath.match(/\/([^/]+)\.credentials\.js$/);
  if (!match) return null;
  const pascal = match[1];
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Find the node_modules directory where community packages may be installed.
 * Tries the same resolution chain as getRequire().
 */
function findNodeModulesDirs(): string[] {
  const dirs: string[] = [];

  // Try resolving from import.meta.url
  try {
    const req = getRequire();
    const basePkg = req.resolve('n8n-nodes-base/package.json');
    dirs.push(dirname(dirname(basePkg)));
  } catch {
    // n8n-nodes-base not installed — try cwd
  }

  // Always try cwd/node_modules
  const cwdNm = join(process.cwd(), 'node_modules');
  if (!dirs.includes(cwdNm) && existsSync(cwdNm)) {
    dirs.push(cwdNm);
  }

  return dirs;
}

/**
 * Discover community n8n nodes from packages matching n8n-nodes-*
 * (excluding n8n-nodes-base) and scoped @org/n8n-nodes-* packages.
 *
 * Returns discovered nodes and credential paths for each package.
 */
export function discoverCommunityN8nNodes(): DiscoveredCommunityPackage[] {
  const results: DiscoveredCommunityPackage[] = [];
  const nmDirs = findNodeModulesDirs();

  for (const nmDir of nmDirs) {
    const seen = new Set<string>();

    // Scan top-level n8n-nodes-* packages
    scanDir(nmDir, seen, results);

    // Scan scoped packages @*/n8n-nodes-*
    try {
      const entries = readdirSync(nmDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('@')) {
          scanDir(join(nmDir, entry.name), seen, results);
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return results;
}

function scanDir(dir: string, seen: Set<string>, results: DiscoveredCommunityPackage[]): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('n8n-nodes-')) continue;
    if (entry.name === 'n8n-nodes-base') continue;

    const pkgDir = join(dir, entry.name);
    if (seen.has(pkgDir)) continue;
    seen.add(pkgDir);

    const pkg = readPackageJson(pkgDir);
    if (!pkg) continue;

    const result = processCommunityPackage(pkgDir, pkg);
    if (result.nodes.length > 0 || result.credentials.length > 0) {
      results.push(result);
    }
  }
}

function readPackageJson(pkgDir: string): Record<string, unknown> | null {
  const pkgJsonPath = join(pkgDir, 'package.json');
  try {
    const raw = readFileSync(pkgJsonPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function processCommunityPackage(
  pkgDir: string,
  pkg: Record<string, unknown>,
): DiscoveredCommunityPackage {
  const n8nMeta = pkg.n8n as Record<string, unknown> | undefined;
  if (!n8nMeta) return { nodes: [], credentials: [] };

  const nodePaths: string[] = (n8nMeta.nodes as string[]) ?? [];
  const credPaths: string[] = (n8nMeta.credentials as string[]) ?? [];

  const nodes: DiscoveredNode[] = [];
  for (const nodePath of nodePaths) {
    const nodeName = extractNodeName(nodePath);
    if (!nodeName) continue;
    if (nodeName.includes('Trigger')) continue;

    const serviceName = toServiceName(nodeName);
    const modulePath = join(pkgDir, nodePath);

    if (existsSync(modulePath)) {
      nodes.push({ modulePath, serviceName });
    }
  }

  const credentials: Array<{ typeName: string; modulePath: string }> = [];
  for (const credPath of credPaths) {
    const typeName = credentialTypeNameFromPath(credPath);
    if (!typeName) continue;

    const modulePath = join(pkgDir, credPath);
    if (existsSync(modulePath)) {
      credentials.push({ typeName, modulePath });
    }
  }

  return { nodes, credentials };
}

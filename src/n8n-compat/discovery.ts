/**
 * Auto-discover n8n nodes from n8n-nodes-base package.
 *
 * Reads the node list from package.json, filters out triggers and
 * workflow-internal nodes, and returns entries ready for lazy registration.
 */

import { join } from 'node:path';

import { getRequire } from './require.js';

export interface DiscoveredNode {
  /** Full path to the .node.js file inside n8n-nodes-base */
  modulePath: string;
  /** Lowercased service name for CLI usage (e.g. "github") */
  serviceName: string;
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

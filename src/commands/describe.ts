import { Command, Option } from 'clipanion';

import { getExpectedEnvVarNames, hasConfiguredCredentials } from '../core/credential-resolver.js';
import {
  findResource,
  findOperation,
  type Operation,
  type Parameter,
  type PluginDescriptor,
  type Resource,
} from '../core/plugin-interface.js';
import { registry } from '../core/registry-instance.js';
import { bold, header } from './format.js';
import { printOutput } from './output.js';

/**
 * Format a single operation as a usage line:
 *   $ nathan <service> <resource> <op> --required <type> [--optional <type>]
 */
function formatUsageLine(service: string, resource: string, op: Operation): string {
  const parts = [`nathan ${service} ${resource} ${op.name}`];
  for (const p of op.parameters) {
    if (p.required) {
      parts.push(`--${p.name} <${p.type}>`);
    } else {
      parts.push(`[--${p.name} <${p.type}>]`);
    }
  }
  return `  ${bold('$ ')}${parts.join(' ')}`;
}

function formatOperationLines(lines: string[], service: string, resourceName: string, ops: Operation[]): void {
  for (const op of ops) {
    lines.push(`  ${bold(op.name)}  ${op.description}`);
    lines.push(formatUsageLine(service, resourceName, op));
    lines.push('');
  }
}

/**
 * Build compact describe output for a full service.
 */
function formatServiceCompact(service: string, descriptor: PluginDescriptor): string {
  const lines: string[] = [];
  lines.push(header(`${descriptor.displayName} — ${descriptor.description}`));
  lines.push('');

  const authRequired = descriptor.credentials.length > 0;
  if (authRequired) {
    const configured = hasConfiguredCredentials(descriptor);
    const label = configured ? 'Auth: configured' : 'Auth: not configured';
    lines.push(`  ${label} (${getExpectedEnvVarNames(descriptor.name).join(', ')})`);
    lines.push('');
  }

  for (const res of descriptor.resources) {
    lines.push(header(res.name));
    lines.push('');
    formatOperationLines(lines, service, res.name, res.operations);
  }

  return lines.join('\n').trimEnd();
}

/**
 * Build compact describe output for a single resource.
 */
function formatResourceCompact(service: string, res: Resource): string {
  const lines: string[] = [];
  lines.push(header(`${res.displayName} — ${res.description}`));
  lines.push('');
  formatOperationLines(lines, service, res.name, res.operations);
  return lines.join('\n').trimEnd();
}

/**
 * Format a parameter line for operation detail.
 */
function formatParamLine(p: Parameter): string {
  const req = p.required ? 'required' : 'optional';
  const def = p.default !== undefined ? ` [default: ${p.default}]` : '';
  return `  ${bold(`--${p.name}`)} <${p.type}>    ${req} — ${p.description}${def}`;
}

/**
 * Build compact describe output for a single operation.
 */
function formatOperationCompact(service: string, resource: string, op: Operation): string {
  const lines: string[] = [];
  lines.push(`${op.displayName} — ${op.description}`);
  lines.push('');
  lines.push(header('Usage'));
  lines.push('');
  lines.push(formatUsageLine(service, resource, op));

  if (op.parameters.length > 0) {
    lines.push('');
    lines.push(header('Options'));
    lines.push('');
    for (const p of op.parameters) {
      lines.push(formatParamLine(p));
    }
  }

  return lines.join('\n');
}

function buildAuthInfo(descriptor: PluginDescriptor) {
  const required = descriptor.credentials.length > 0;
  return {
    required,
    configured: required ? hasConfiguredCredentials(descriptor) : false,
    env_vars: required ? getExpectedEnvVarNames(descriptor.name) : [],
  };
}

function printError(error: { code: string; message: string; [key: string]: unknown }, json: boolean): void {
  if (json) {
    printOutput({ error });
  } else {
    console.error(`Error: ${error.message}`);
    if ('suggestion' in error) console.error(String(error.suggestion));
    if ('available' in error && Array.isArray(error.available)) {
      console.error(`Available: ${error.available.join(', ')}`);
    }
  }
  process.exitCode = 1;
}

export class DescribeCommand extends Command {
  static override paths = [['describe']];

  static override usage = Command.Usage({
    description: 'Describe a specific service, resource, or operation in detail',
    examples: [
      ['Describe a service', 'nathan describe jsonplaceholder'],
      ['Describe a resource', 'nathan describe jsonplaceholder post'],
      ['Describe an operation', 'nathan describe jsonplaceholder post create'],
    ],
  });

  service = Option.String({ required: true, name: 'service' });
  resource = Option.String({ required: false, name: 'resource' });
  operation = Option.String({ required: false, name: 'operation' });

  json = Option.Boolean('--json', false, {
    description: 'Output in JSON format',
  });

  async execute(): Promise<void> {
    const plugin = await registry.getOrLoad(this.service);
    if (!plugin) {
      printError(
        {
          code: 'PLUGIN_NOT_FOUND',
          message: `Plugin "${this.service}" not found`,
          suggestion: "Run 'nathan discover' to see available plugins",
        },
        this.json,
      );
      return;
    }

    if (!this.resource) {
      if (this.json) {
        printOutput({
          name: plugin.descriptor.name,
          displayName: plugin.descriptor.displayName,
          description: plugin.descriptor.description,
          version: plugin.descriptor.version,
          auth: buildAuthInfo(plugin.descriptor),
          resources: plugin.descriptor.resources.map((r) => ({
            name: r.name,
            displayName: r.displayName,
            operations: r.operations.map((o) => o.name),
          })),
        });
      } else {
        console.log(formatServiceCompact(this.service, plugin.descriptor));
      }
      return;
    }

    const resourceName = this.resource;
    const res = findResource(plugin.descriptor, resourceName);
    if (!res) {
      printError(
        {
          code: 'RESOURCE_NOT_FOUND',
          message: `Resource "${resourceName}" not found in "${this.service}"`,
          available: plugin.descriptor.resources.map((r) => r.name),
        },
        this.json,
      );
      return;
    }

    if (!this.operation) {
      if (this.json) {
        printOutput({
          service: this.service,
          resource: res.name,
          displayName: res.displayName,
          description: res.description,
          operations: res.operations.map((o) => ({
            name: o.name,
            displayName: o.displayName,
            description: o.description,
            method: o.method,
            parameters: o.parameters.map((p) => ({
              name: p.name,
              type: p.type,
              required: p.required,
              description: p.description,
              ...(p.default !== undefined ? { default: p.default } : {}),
            })),
          })),
        });
      } else {
        console.log(formatResourceCompact(this.service, res));
      }
      return;
    }

    const operationName = this.operation;
    const op = findOperation(res, operationName);
    if (!op) {
      printError(
        {
          code: 'OPERATION_NOT_FOUND',
          message: `Operation "${operationName}" not found on "${resourceName}"`,
          available: res.operations.map((o) => o.name),
        },
        this.json,
      );
      return;
    }

    if (this.json) {
      printOutput({
        command: `nathan ${this.service} ${resourceName} ${operationName}`,
        description: op.description,
        method: op.method,
        parameters: op.parameters.map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
          description: p.description,
          default: p.default,
          location: p.location,
        })),
        auth: buildAuthInfo(plugin.descriptor),
      });
    } else {
      console.log(formatOperationCompact(this.service, res.name, op));
    }
  }
}

/**
 * nathan plugin list — List installed and available plugins.
 */

import { Command, Option } from 'clipanion';

import { registry } from '../../core/registry-instance.js';
import { bold, header } from '../format.js';
import { printOutput } from '../output.js';

export class PluginListCommand extends Command {
  static override paths = [['plugin', 'list']];

  static override usage = Command.Usage({
    description: 'List all installed plugins',
    examples: [
      ['List plugins', 'nathan plugin list'],
      ['JSON output', 'nathan plugin list --json'],
    ],
  });

  json = Option.Boolean('--json', false, {
    description: 'Output in JSON format (default: human-readable)',
  });

  async execute(): Promise<void> {
    const loadedPlugins = registry.getAll();
    const allNames = registry.getAllNames();
    const loadedNames = new Set(loadedPlugins.map((p) => p.descriptor.name));
    const lazyNames = allNames.filter((name) => !loadedNames.has(name));

    if (this.json) {
      const loaded = loadedPlugins.map((p) => ({
        name: p.descriptor.name,
        displayName: p.descriptor.displayName,
        version: p.descriptor.version,
        type: p.descriptor.type,
        resources: p.descriptor.resources.length,
        status: 'loaded' as const,
      }));

      const available = lazyNames.map((name) => ({
        name,
        displayName: null,
        version: null,
        type: null,
        resources: null,
        status: 'available' as const,
      }));

      printOutput([...loaded, ...available], { json: true });
      return;
    }

    if (loadedPlugins.length === 0 && lazyNames.length === 0) {
      console.log('No plugins found. Install a plugin with: nathan plugin install <name>');
      return;
    }

    const lines: string[] = [];

    if (loadedPlugins.length > 0) {
      lines.push(header('Loaded Plugins'));
      lines.push('');
      for (const p of loadedPlugins) {
        const d = p.descriptor;
        const resourceCount = d.resources.length;
        const operationCount = d.resources.reduce((sum, r) => sum + r.operations.length, 0);
        lines.push(`  ${bold(d.name)}  ${d.description}`);
        lines.push(`    ${resourceCount} resource(s), ${operationCount} operation(s)`);
      }
      lines.push('');
    }

    if (lazyNames.length > 0) {
      lines.push(header(`Available (${lazyNames.length} services)`));
      lines.push('');

      // Wrap names into lines of ~76 chars
      const maxWidth = 76;
      let currentLine = '';
      for (const name of lazyNames) {
        const separator = currentLine ? ', ' : '';
        if (currentLine && currentLine.length + separator.length + name.length > maxWidth) {
          lines.push(`  ${currentLine}`);
          currentLine = name;
        } else {
          currentLine += separator + name;
        }
      }
      if (currentLine) lines.push(`  ${currentLine}`);
      lines.push('');
      lines.push(`Use ${bold('nathan describe <service>')} to see available commands.`);
    }

    console.log(lines.join('\n').trimEnd());
  }
}

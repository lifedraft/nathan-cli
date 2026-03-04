import { Command, Option } from 'clipanion';

import { registry } from '../core/registry-instance.js';
import { bold, header } from './format.js';
import { printOutput } from './output.js';

export class DiscoverCommand extends Command {
  static override paths = [['discover']];

  static override usage = Command.Usage({
    description: 'Discover available services, resources, and operations',
    examples: [
      ['List all available services', 'nathan discover'],
      ['JSON output', 'nathan discover --json'],
    ],
  });

  json = Option.Boolean('--json', false, {
    description: 'Output in JSON format',
  });

  async execute(): Promise<void> {
    const loadedPlugins = registry.getAll();
    const allNames = registry.getAllNames();
    const loadedNames = new Set(loadedPlugins.map((p) => p.descriptor.name));
    const availableNames = allNames.filter((name) => !loadedNames.has(name));

    if (this.json) {
      const loaded = loadedPlugins.map((p) => ({
        name: p.descriptor.name,
        displayName: p.descriptor.displayName,
        description: p.descriptor.description,
        version: p.descriptor.version,
        resources: p.descriptor.resources.map((r) => ({
          name: r.name,
          operations: r.operations.map((o) => o.name),
        })),
        authenticated: p.descriptor.credentials.length > 0,
        loaded: true,
      }));

      const lazyEntries = availableNames.map((name) => ({ name, loaded: false }));

      printOutput({ plugins: [...loaded, ...lazyEntries] });
      return;
    }

    if (loadedPlugins.length === 0 && availableNames.length === 0) {
      console.log('No services found. Install a plugin with: nathan plugin install <name>');
      return;
    }

    const lines: string[] = [];

    if (loadedPlugins.length > 0) {
      lines.push(header('Loaded'));
      lines.push('');
      for (const p of loadedPlugins) {
        const resources = p.descriptor.resources.map((r) => r.name).join(', ');
        lines.push(`  ${bold(p.descriptor.name)}  ${p.descriptor.description}`);
        lines.push(`    resources: ${resources}`);
      }
      lines.push('');
    }

    if (availableNames.length > 0) {
      lines.push(header(`Available (${availableNames.length} services)`));
      lines.push('');

      // Wrap names into lines of ~76 chars (80 minus 2-space indent)
      const maxWidth = 76;
      let currentLine = '';
      for (const name of availableNames) {
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

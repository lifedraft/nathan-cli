import { Command, Option } from 'clipanion';

import { registry } from '../core/registry-instance.js';
import { printOutput } from './output.js';

export class DiscoverCommand extends Command {
  static override paths = [['discover']];

  static override usage = Command.Usage({
    description: 'Discover available services, resources, and operations',
    examples: [
      ['List all available services', 'nathan discover'],
      ['Human-readable output', 'nathan discover --human'],
    ],
  });

  human = Option.Boolean('--human', false, {
    description: 'Output in human-readable format instead of JSON',
  });

  async execute(): Promise<void> {
    const loadedPlugins = registry.getAll();
    const allNames = registry.getAllNames();

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

    const loadedNames = new Set(loadedPlugins.map((p) => p.descriptor.name));
    const lazyEntries = allNames
      .filter((name) => !loadedNames.has(name))
      .map((name) => ({
        name,
        loaded: false,
      }));

    const result = {
      plugins: [...loaded, ...lazyEntries],
    };

    printOutput(this.human ? result.plugins : result, { human: this.human });
  }
}

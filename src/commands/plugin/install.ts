/**
 * nathan plugin install <name> — Install a plugin.
 */

import { Command, Option } from 'clipanion';

import { printError } from '../output.js';

export class PluginInstallCommand extends Command {
  static override paths = [['plugin', 'install']];

  static override usage = Command.Usage({
    description: 'Install a plugin by name or path',
    examples: [
      ['Install from registry', 'nathan plugin install github'],
      ['Install from local path', 'nathan plugin install ./my-plugin.yaml'],
    ],
  });

  name = Option.String({ required: true, name: 'name' });

  json = Option.Boolean('--json', false, {
    description: 'Output in JSON format (default: human-readable)',
  });

  async execute(): Promise<void> {
    printError(
      {
        code: 'NOT_IMPLEMENTED',
        message: `Plugin install is not yet implemented (plugin: ${this.name})`,
      },
      {},
    );
    process.exitCode = 1;
  }
}

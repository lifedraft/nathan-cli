/**
 * nathan plugin list — List installed plugins.
 */

import { Command, Option } from 'clipanion';

import { printError } from '../output.js';

export class PluginListCommand extends Command {
  static override paths = [['plugin', 'list']];

  static override usage = Command.Usage({
    description: 'List all installed plugins',
    examples: [['List plugins', 'nathan plugin list']],
  });

  json = Option.Boolean('--json', false, {
    description: 'Output in JSON format (default: human-readable)',
  });

  async execute(): Promise<void> {
    printError(
      { code: 'NOT_IMPLEMENTED', message: 'Plugin list is not yet implemented' },
      { json: this.json },
    );
    process.exitCode = 1;
  }
}

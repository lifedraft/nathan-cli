/**
 * nathan plugin list — List installed plugins.
 */

import { Command, Option } from 'clipanion';

import { printOutput } from '../output.js';

export class PluginListCommand extends Command {
  static override paths = [['plugin', 'list']];

  static override usage = Command.Usage({
    description: 'List all installed plugins',
    examples: [['List plugins', 'nathan plugin list']],
  });

  human = Option.Boolean('--human', false, {
    description: 'Output in human-readable format instead of JSON',
  });

  async execute(): Promise<void> {
    printOutput({ status: 'not_implemented' }, { human: this.human });
  }
}

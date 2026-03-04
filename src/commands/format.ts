/**
 * Shared terminal formatting utilities for human-readable output.
 * Uses chalk to respect NO_COLOR, FORCE_COLOR, and TTY detection.
 */

import chalk from 'chalk';

const MAX_LINE_LENGTH = 80;

const richLine = Array(MAX_LINE_LENGTH).fill('━');
for (let t = 0; t <= 24; ++t) richLine[MAX_LINE_LENGTH - 1 - t] = chalk.ansi256(232 + t)('━');

export const header = (str: string): string => {
  const tail = str.length < MAX_LINE_LENGTH - 5 ? ` ${richLine.slice(str.length + 5).join('')}` : ':';
  return chalk.bold(`━━━ ${str}${tail}`);
};

export const bold = (str: string): string => chalk.bold(str);

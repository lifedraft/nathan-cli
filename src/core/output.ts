/**
 * Output formatting utilities.
 *
 * Defaults to JSON output. When --human flag is passed, uses chalk + cli-table3
 * for human-readable formatting.
 */

import chalk from "chalk";
import Table from "cli-table3";

export interface OutputOptions {
  human?: boolean;
  /** Pretty-print JSON with indentation. Defaults to true. */
  pretty?: boolean;
}

/**
 * Format and print a result object.
 */
export function formatOutput(data: unknown, options: OutputOptions = {}): string {
  if (options.human) {
    return formatHuman(data);
  }
  return formatJson(data, options.pretty ?? true);
}

/**
 * Print formatted output to stdout.
 */
export function printOutput(data: unknown, options: OutputOptions = {}): void {
  const formatted = formatOutput(data, options);
  console.log(formatted);
}

/**
 * Format data as JSON string.
 */
function formatJson(data: unknown, pretty: boolean): string {
  return JSON.stringify(data, null, pretty ? 2 : undefined);
}

/**
 * Format data as human-readable output using chalk and cli-table3.
 */
function formatHuman(data: unknown): string {
  if (data === null || data === undefined) {
    return chalk.dim("(empty)");
  }

  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return formatArray(data);
  }

  if (typeof data === "object") {
    return formatObject(data as Record<string, unknown>);
  }

  return String(data);
}

/**
 * Format an array of objects as a table.
 */
function formatArray(items: unknown[]): string {
  if (items.length === 0) {
    return chalk.dim("(no items)");
  }

  const first = items[0];
  if (typeof first !== "object" || first === null) {
    return items.map((item) => `  ${chalk.white(String(item))}`).join("\n");
  }

  const keys = Object.keys(first as Record<string, unknown>);
  const table = new Table({
    head: keys.map((k) => chalk.cyan.bold(k)),
    style: { head: [], border: [] },
  });

  for (const item of items) {
    const row = keys.map((k) => {
      const val = (item as Record<string, unknown>)[k];
      return val === null || val === undefined ? chalk.dim("—") : String(val);
    });
    table.push(row);
  }

  return table.toString();
}

/**
 * Format a single object as a key-value list.
 */
function formatObject(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  const maxKeyLen = Math.max(...Object.keys(obj).map((k) => k.length));

  for (const [key, value] of Object.entries(obj)) {
    const paddedKey = key.padEnd(maxKeyLen);
    const formattedValue =
      value === null || value === undefined
        ? chalk.dim("—")
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    lines.push(`  ${chalk.cyan(paddedKey)}  ${formattedValue}`);
  }

  return lines.join("\n");
}

/**
 * Print an error in a consistent format.
 */
export function printError(message: string, options: OutputOptions = {}): void {
  if (options.human) {
    console.error(chalk.red.bold("Error:"), chalk.red(message));
  } else {
    console.error(JSON.stringify({ error: message }));
  }
}

/**
 * Print a success message.
 */
export function printSuccess(message: string, options: OutputOptions = {}): void {
  if (options.human) {
    console.log(chalk.green.bold("OK:"), chalk.green(message));
  } else {
    console.log(JSON.stringify({ status: "ok", message }));
  }
}

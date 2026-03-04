/**
 * Output formatting utilities.
 *
 * Defaults to human-readable output using chalk + cli-table3.
 * When --json flag is passed, outputs raw JSON.
 */

import chalk from 'chalk';
import Table from 'cli-table3';

export interface OutputOptions {
  json?: boolean;
  /** Pretty-print JSON with indentation. Defaults to true. */
  pretty?: boolean;
  /** Truncate array results to this many items. */
  limit?: number;
}

/**
 * Format and print a result object.
 */
function formatOutput(data: unknown, options: OutputOptions = {}): string {
  if (options.json) {
    return formatJson(data, options.pretty ?? true);
  }
  return formatHuman(data);
}

/**
 * Print formatted output to stdout.
 */
export function printOutput(data: unknown, options: OutputOptions = {}): void {
  const output = applyLimit(data, options);
  const formatted = formatOutput(output, options);
  console.log(formatted);
}

/**
 * Print a structured error to stderr (both JSON and human mode).
 *
 * Does NOT set process.exitCode — callers are responsible for exit code management.
 */
export function printError<E extends { code: string; message: string; suggestion?: string }>(
  error: E,
  options: { json: boolean; hint?: string },
): void {
  if (options.json) {
    console.error(JSON.stringify({ error }, null, 2));
  } else {
    console.error(`Error: ${error.message}`);
    if (error.suggestion) console.error(error.suggestion);
    if (options.hint) console.error(options.hint);
  }
}

/**
 * If limit is set and data is an array larger than limit, truncate.
 * In JSON mode, wraps with _meta envelope. In human mode, slices and appends a footer.
 */
function applyLimit(data: unknown, options: OutputOptions): unknown {
  const { limit, json } = options;
  if (limit === undefined || !Array.isArray(data) || data.length <= limit) return data;
  if (json) {
    return {
      items: data.slice(0, limit),
      _meta: { total: data.length, returned: limit, truncated: true },
    };
  }
  // Human mode: return a truncated wrapper so formatHuman can show a footer
  return { __truncated: true, items: data.slice(0, limit), total: data.length, returned: limit };
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
    return chalk.dim('(empty)');
  }

  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data)) {
    return formatArray(data);
  }

  if (typeof data === 'object') {
    // Handle truncated wrapper from applyLimit (human mode)
    const obj = data as Record<string, unknown>;
    if (obj.__truncated === true && Array.isArray(obj.items)) {
      const table = formatArray(obj.items as unknown[]);
      return `${table}\n${chalk.dim(`(showing ${obj.returned} of ${obj.total} results)`)}`;
    }
    return formatObject(obj);
  }

  return String(data);
}

/**
 * Summarise a value for human display.
 * For nested objects, tries common identifier fields before falling back to
 * a field-count summary — avoids dumping raw JSON blobs in table cells.
 */
function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return chalk.dim('—');
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return chalk.dim(`[${value.length} items]`);

  const obj = value as Record<string, unknown>;
  for (const key of ['login', 'name', 'full_name', 'title', 'label', 'slug', 'id', 'email']) {
    if (
      key in obj &&
      obj[key] !== null &&
      obj[key] !== undefined &&
      obj[key] !== false &&
      obj[key] !== ''
    )
      return String(obj[key]);
  }
  const keys = Object.keys(obj);
  return chalk.dim(`{${keys.length} fields}`);
}

/**
 * Format an array of objects as a table.
 */
function formatArray(items: unknown[]): string {
  if (items.length === 0) {
    return chalk.dim('(no items)');
  }

  const first = items[0];
  if (typeof first !== 'object' || first === null) {
    return items.map((item) => `  ${chalk.white(String(item))}`).join('\n');
  }

  const keys = Object.keys(first as Record<string, unknown>);
  const table = new Table({
    head: keys.map((k) => chalk.cyan.bold(k)),
    style: { head: [], border: [] },
  });

  for (const item of items) {
    const row = keys.map((k) => {
      const val = (item as Record<string, unknown>)[k];
      return summarizeValue(val);
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
  const objKeys = Object.keys(obj);
  if (objKeys.length === 0) return chalk.dim('(empty object)');
  const maxKeyLen = Math.max(...objKeys.map((k) => k.length));

  for (const [key, value] of Object.entries(obj)) {
    const paddedKey = key.padEnd(maxKeyLen);
    lines.push(`  ${chalk.cyan(paddedKey)}  ${summarizeValue(value)}`);
  }

  return lines.join('\n');
}

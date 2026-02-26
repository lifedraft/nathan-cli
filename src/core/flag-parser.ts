/**
 * Shared flag parsing utilities for CLI commands.
 *
 * Extracts --key=value and --key value pairs from argument arrays.
 * Consolidates the previously duplicated parseFlags/coerce functions
 * from run.ts, dynamic.ts, and auth/add.ts.
 */

type FlagValue = string | number | boolean;

/**
 * Coerce a string value to its natural type.
 * "true"/"false" become booleans, strictly decimal numeric strings become numbers.
 */
function coerce(value: string): FlagValue {
  if (value === "true") return true;
  if (value === "false") return false;
  // Only coerce strictly decimal numbers (avoid hex, Infinity, whitespace, etc.)
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * Parse --key=value and --key value flag pairs from an argument array.
 * Values are coerced to booleans/numbers where appropriate.
 */
export function parseFlags(args: string[]): Record<string, FlagValue> {
  const params: Record<string, FlagValue> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const raw = arg.slice(eqIndex + 1);
        params[key] = coerce(raw);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          params[key] = coerce(next);
          i++;
        } else {
          params[key] = true;
        }
      }
    }
    i++;
  }
  return params;
}

/**
 * Parse flags as string values only (no coercion).
 * Used by auth commands where all values should remain strings.
 */
export function parseFlagsAsStrings(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        }
      }
    }
    i++;
  }
  return flags;
}

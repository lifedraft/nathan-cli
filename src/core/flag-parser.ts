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
  if (value === 'true') return true;
  if (value === 'false') return false;
  // Only coerce strictly decimal numbers (avoid hex, Infinity, whitespace, etc.)
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * Parse --key=value and --key value flag pairs from an argument array.
 * Values are coerced to booleans/numbers where appropriate.
 */
/** Property names that must never be set on param objects. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseFlags(args: string[]): Record<string, FlagValue> {
  const params: Record<string, FlagValue> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const raw = arg.slice(eqIndex + 1);
        if (!UNSAFE_KEYS.has(key)) params[key] = coerce(raw);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          if (!UNSAFE_KEYS.has(key)) params[key] = coerce(next);
          i++;
        } else {
          if (!UNSAFE_KEYS.has(key)) params[key] = true;
        }
      }
    }
    i++;
  }
  return params;
}

/**
 * Extract and validate the --limit flag from parsed params.
 * Returns a positive integer or undefined. Deletes the key from params.
 */
export function extractLimit(params: Record<string, FlagValue>): number | undefined {
  const raw = params.limit;
  delete params.limit;
  if (raw === undefined || raw === true) return undefined;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Extract the --json flag from proxy args (Option.Proxy swallows all flags).
 * Handles --json, --json=true, --json=false, and --json true/false (space-separated).
 * Returns [jsonFlag, cleanedArgs].
 */
export function extractJsonFlag(args: string[]): [boolean, string[]] {
  let json = false;
  const cleaned: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json' || a === '--json=true') {
      json = true;
    } else if (a === '--json=false') {
      // consume and leave json as false
    } else {
      cleaned.push(a);
    }
  }
  return [json, cleaned];
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
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        }
      }
    }
    i++;
  }
  return flags;
}

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';

import chalk from 'chalk';

import { printOutput, printError } from './output.js';

let logSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;
let originalLevel: typeof chalk.level;
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
  errSpy = spyOn(console, 'error').mockImplementation(() => {});
  originalLevel = chalk.level;
  chalk.level = 0 as typeof chalk.level; // strip ANSI for predictable assertions
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  chalk.level = originalLevel;
  process.exitCode = savedExitCode ?? 0;
});

function logged(): string {
  return logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
}

function stderr(): string {
  return errSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
}

// ---------------------------------------------------------------------------
// Human-readable (default)
// ---------------------------------------------------------------------------
describe('printOutput — human-readable (default)', () => {
  test('object → key-value list', () => {
    printOutput({ name: 'alice', age: 30 });
    const out = logged();
    expect(out).toContain('name');
    expect(out).toContain('alice');
    expect(out).toContain('age');
    expect(out).toContain('30');
  });

  test('string → passed through as-is', () => {
    printOutput('hello world');
    expect(logged()).toBe('hello world');
  });

  test('null → "(empty)"', () => {
    printOutput(null);
    expect(logged()).toContain('(empty)');
  });

  test('undefined → "(empty)"', () => {
    printOutput(undefined);
    expect(logged()).toContain('(empty)');
  });

  test('empty array → "(no items)"', () => {
    printOutput([]);
    expect(logged()).toContain('(no items)');
  });

  test('primitive array → each item on a line', () => {
    printOutput([1, 2, 3]);
    const out = logged();
    expect(out).toContain('1');
    expect(out).toContain('2');
    expect(out).toContain('3');
  });

  test('array of objects → table with column headers', () => {
    printOutput([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]);
    const out = logged();
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  test('nested object → summarized by identifier field', () => {
    printOutput({ owner: { name: 'alice', extra: 123 } });
    const out = logged();
    expect(out).toContain('alice');
    // Should NOT dump the raw nested JSON
    expect(out).not.toContain('"extra"');
  });

  test('nested object with id → summarized by id', () => {
    printOutput({ owner: { id: 42 } });
    expect(logged()).toContain('42');
  });

  test('empty object → "(empty object)"', () => {
    printOutput({});
    expect(logged()).toContain('(empty object)');
  });

  test('number → stringified', () => {
    printOutput(42);
    expect(logged()).toContain('42');
  });

  test('boolean → stringified', () => {
    printOutput(true);
    expect(logged()).toContain('true');
  });
});

// ---------------------------------------------------------------------------
// JSON mode
// ---------------------------------------------------------------------------
describe('printOutput — json mode', () => {
  test('produces valid parseable JSON matching input', () => {
    const input = { foo: 'bar', nums: [1, 2] };
    printOutput(input, { json: true });
    const parsed = JSON.parse(logged());
    expect(parsed).toEqual(input);
  });

  test('pretty-printed by default (has indentation)', () => {
    printOutput({ a: 1 }, { json: true });
    expect(logged()).toContain('\n');
    expect(logged()).toContain('  ');
  });

  test('compact when pretty: false', () => {
    printOutput({ a: 1 }, { json: true, pretty: false });
    expect(logged()).toBe('{"a":1}');
  });
});

// ---------------------------------------------------------------------------
// Limit
// ---------------------------------------------------------------------------
describe('printOutput — limit', () => {
  test('array longer than limit → wraps with _meta truncated', () => {
    printOutput([1, 2, 3, 4, 5], { json: true, limit: 2 });
    const parsed = JSON.parse(logged());
    expect(parsed.items).toEqual([1, 2]);
    expect(parsed._meta.truncated).toBe(true);
    expect(parsed._meta.total).toBe(5);
    expect(parsed._meta.returned).toBe(2);
  });

  test('array within limit → no wrapping', () => {
    printOutput([1, 2], { json: true, limit: 5 });
    const parsed = JSON.parse(logged());
    expect(parsed).toEqual([1, 2]);
  });

  test('non-array → limit ignored', () => {
    printOutput({ a: 1 }, { json: true, limit: 1 });
    const parsed = JSON.parse(logged());
    expect(parsed).toEqual({ a: 1 });
  });

  test('human mode → slices array and shows truncation footer', () => {
    printOutput([1, 2, 3, 4, 5], { limit: 2 });
    const out = logged();
    expect(out).toContain('1');
    expect(out).toContain('2');
    expect(out).not.toContain('3');
    expect(out).not.toContain('_meta');
    expect(out).toContain('showing 2 of 5');
  });
});

// ---------------------------------------------------------------------------
// printError
// ---------------------------------------------------------------------------
describe('printError', () => {
  test('human mode → writes message to stderr, does NOT set exitCode', () => {
    printError({ code: 'TEST', message: 'Something went wrong' }, { json: false });
    expect(stderr()).toContain('Error: Something went wrong');
    // printError no longer sets exitCode — callers are responsible
    expect(process.exitCode).toBe(0);
    // Should NOT write to stdout
    expect(logged()).toBe('');
  });

  test('json mode → writes JSON to stderr with { error } envelope', () => {
    printError({ code: 'TEST', message: 'fail' }, { json: true });
    const parsed = JSON.parse(stderr());
    expect(parsed.error.code).toBe('TEST');
    expect(parsed.error.message).toBe('fail');
    expect(process.exitCode).toBe(0);
    // Should NOT write to stdout
    expect(logged()).toBe('');
  });

  test('json mode → preserves extra fields', () => {
    printError({ code: 'NOT_FOUND', message: 'not found', available: ['a', 'b'] }, { json: true });
    const parsed = JSON.parse(stderr());
    expect(parsed.error.available).toEqual(['a', 'b']);
  });

  test('human mode → prints suggestion when present', () => {
    printError(
      { code: 'NOT_FOUND', message: 'Plugin not found', suggestion: "Run 'nathan discover'" },
      { json: false },
    );
    expect(stderr()).toContain('Plugin not found');
    expect(stderr()).toContain("Run 'nathan discover'");
  });

  test('human mode → prints hint when provided', () => {
    printError(
      { code: 'MISSING_PARAM', message: 'Missing param: owner' },
      { json: false, hint: "Run 'nathan describe github repos list' for help." },
    );
    expect(stderr()).toContain('Missing param: owner');
    expect(stderr()).toContain('nathan describe github repos list');
  });
});

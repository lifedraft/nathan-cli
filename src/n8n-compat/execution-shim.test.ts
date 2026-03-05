import { describe, test, expect } from 'bun:test';

import { nestCollectionParams, type NodePropertyDef } from './execution-shim.js';

describe('nestCollectionParams', () => {
  test('nests flat params into collection parent', () => {
    const props: NodePropertyDef[] = [
      {
        name: 'additionalFields',
        type: 'collection',
        options: [{ name: 'keyword' }, { name: 'tags' }],
      },
    ];

    const result = nestCollectionParams({ keyword: 'test', tags: 'a,b', other: 42 }, props);

    expect(result).toEqual({
      additionalFields: { keyword: 'test', tags: 'a,b' },
      other: 42,
    });
  });

  test('leaves pre-nested objects untouched', () => {
    const props: NodePropertyDef[] = [
      {
        name: 'additionalFields',
        type: 'collection',
        options: [{ name: 'keyword' }],
      },
    ];

    const result = nestCollectionParams({ additionalFields: { keyword: 'already nested' } }, props);

    expect(result).toEqual({
      additionalFields: { keyword: 'already nested' },
    });
  });

  test('handles overlapping child names across collections by leaving them at top level', () => {
    const props: NodePropertyDef[] = [
      {
        name: 'additionalFields',
        type: 'collection',
        options: [{ name: 'limit' }, { name: 'keyword' }],
      },
      {
        name: 'options',
        type: 'collection',
        options: [{ name: 'limit' }, { name: 'format' }],
      },
    ];

    const result = nestCollectionParams({ limit: 10, keyword: 'test', format: 'json' }, props);

    // 'limit' is ambiguous — stays at top level
    expect(result.limit).toBe(10);
    // 'keyword' is unique to additionalFields
    expect(result.additionalFields).toEqual({ keyword: 'test' });
    // 'format' is unique to options
    expect(result.options).toEqual({ format: 'json' });
  });

  test('wraps fixedCollection children in array under group name', () => {
    const props: NodePropertyDef[] = [
      {
        name: 'filters',
        type: 'fixedCollection',
        options: [
          {
            name: 'conditions',
            values: [{ name: 'field' }, { name: 'value' }],
          },
        ],
      },
    ];

    const result = nestCollectionParams({ field: 'name', value: 'test' }, props);

    expect(result).toEqual({
      filters: { conditions: [{ field: 'name', value: 'test' }] },
    });
  });

  test('rejects __proto__ keys', () => {
    const props: NodePropertyDef[] = [
      {
        name: '__proto__',
        type: 'collection',
        options: [{ name: 'polluted' }],
      },
    ];

    const result = nestCollectionParams({ polluted: 'yes' }, props);

    // __proto__ parent is skipped, child stays at top level
    expect(result).toEqual({ polluted: 'yes' });
    expect(result.__proto__).toBe(Object.prototype);
  });

  test('rejects __proto__ child names', () => {
    const props: NodePropertyDef[] = [
      {
        name: 'additionalFields',
        type: 'collection',
        options: [{ name: '__proto__' }, { name: 'safe' }],
      },
    ];

    const result = nestCollectionParams(
      { __proto__: { bad: true }, safe: 'ok' } as Record<string, unknown>,
      props,
    );

    expect(result.additionalFields).toEqual({ safe: 'ok' });
  });

  test('returns params unchanged when no collections in properties', () => {
    const props: NodePropertyDef[] = [{ name: 'title', type: 'string' }];

    const result = nestCollectionParams({ title: 'hi', extra: 1 }, props);
    expect(result).toEqual({ title: 'hi', extra: 1 });
  });

  test('handles empty flat params', () => {
    const props: NodePropertyDef[] = [
      {
        name: 'additionalFields',
        type: 'collection',
        options: [{ name: 'keyword' }],
      },
    ];

    const result = nestCollectionParams({}, props);
    expect(result).toEqual({});
  });

  test('handles collection with no matching flat params', () => {
    const props: NodePropertyDef[] = [
      {
        name: 'additionalFields',
        type: 'collection',
        options: [{ name: 'keyword' }],
      },
    ];

    const result = nestCollectionParams({ unrelated: 'value' }, props);
    expect(result).toEqual({ unrelated: 'value' });
  });
});

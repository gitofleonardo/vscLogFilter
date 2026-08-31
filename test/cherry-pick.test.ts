import { describe, expect, it } from 'vitest';
import { CherryPickStore } from '../src/session/CherryPickStore';
import { cherryPickKey, type CherryPickItem } from '../src/session/cherryPickTypes';

function item(
  sourceUri: string,
  lineNumber: number,
  overrides: Partial<CherryPickItem> = {},
): CherryPickItem {
  return {
    key: cherryPickKey(sourceUri, lineNumber),
    sourceUri,
    lineNumber,
    fullText: `line ${lineNumber}`,
    pickedAt: Date.now(),
    ...overrides,
  };
}

describe('cherryPickKey', () => {
  it('combines sourceUri and lineNumber', () => {
    expect(cherryPickKey('file:///a.log', 42)).toBe('file:///a.log#42');
  });
});

describe('CherryPickStore', () => {
  it('adds items and rejects duplicates', () => {
    const store = new CherryPickStore();
    const a = item('file:///a.log', 1);
    expect(store.add(a)).toBe(true);
    expect(store.add(a)).toBe(false);
    expect(store.count()).toBe(1);
  });

  it('removes by key', () => {
    const store = new CherryPickStore();
    const a = item('file:///a.log', 1);
    store.add(a);
    expect(store.remove(a.key)).toBe(true);
    expect(store.remove(a.key)).toBe(false);
    expect(store.count()).toBe(0);
  });

  it('removeMany returns removed count', () => {
    const store = new CherryPickStore();
    const a = item('file:///a.log', 1);
    const b = item('file:///a.log', 2);
    store.add(a);
    store.add(b);
    expect(store.removeMany([a.key, 'missing', b.key])).toBe(2);
    expect(store.count()).toBe(0);
  });

  it('clear removes all items', () => {
    const store = new CherryPickStore();
    store.add(item('file:///a.log', 1));
    store.add(item('file:///a.log', 2));
    store.clear();
    expect(store.count()).toBe(0);
    expect(store.pickedKeys()).toEqual([]);
  });

  it('listSorted orders by sourceUri then lineNumber', () => {
    const store = new CherryPickStore();
    store.add(item('file:///b.log', 10, { pickedAt: 3 }));
    store.add(item('file:///a.log', 99, { pickedAt: 1 }));
    store.add(item('file:///a.log', 5, { pickedAt: 2 }));
    expect(store.listSorted().map((i) => `${i.sourceUri}:${i.lineNumber}`)).toEqual([
      'file:///a.log:5',
      'file:///a.log:99',
      'file:///b.log:10',
    ]);
  });

  it('keyFor matches cherryPickKey', () => {
    const store = new CherryPickStore();
    expect(store.keyFor('file:///x', 7)).toBe('file:///x#7');
  });
});

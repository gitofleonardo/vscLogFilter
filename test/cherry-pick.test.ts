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

const TAB = 'default';

describe('CherryPickStore', () => {
  it('adds items and rejects duplicates', () => {
    const store = new CherryPickStore();
    const a = item('file:///a.log', 1);
    expect(store.add(a, TAB)).toBe(true);
    expect(store.add(a, TAB)).toBe(false);
    expect(store.count(TAB)).toBe(1);
  });

  it('removes by key', () => {
    const store = new CherryPickStore();
    const a = item('file:///a.log', 1);
    store.add(a, TAB);
    expect(store.remove(a.key, TAB)).toBe(true);
    expect(store.remove(a.key, TAB)).toBe(false);
    expect(store.count(TAB)).toBe(0);
  });

  it('removeMany returns removed count', () => {
    const store = new CherryPickStore();
    const a = item('file:///a.log', 1);
    const b = item('file:///a.log', 2);
    store.add(a, TAB);
    store.add(b, TAB);
    expect(store.removeMany([a.key, 'missing', b.key], TAB)).toBe(2);
    expect(store.count(TAB)).toBe(0);
  });

  it('clear removes all items', () => {
    const store = new CherryPickStore();
    store.add(item('file:///a.log', 1), TAB);
    store.add(item('file:///a.log', 2), TAB);
    store.clear();
    expect(store.count(TAB)).toBe(0);
    expect(store.pickedKeys(TAB)).toEqual([]);
  });

  it('listSorted orders by sourceUri then lineNumber', () => {
    const store = new CherryPickStore();
    store.add(item('file:///b.log', 10, { pickedAt: 3 }), TAB);
    store.add(item('file:///a.log', 99, { pickedAt: 1 }), TAB);
    store.add(item('file:///a.log', 5, { pickedAt: 2 }), TAB);
    expect(store.listSorted(TAB).map((i) => `${i.sourceUri}:${i.lineNumber}`)).toEqual([
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

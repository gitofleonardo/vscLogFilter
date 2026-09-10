import { describe, expect, it } from 'vitest';
import {
  arraysEqual,
  mergeFileOrder,
  normalizePreferredSelected,
  selectedUrisInFileOrder,
} from '../src/session/fileOrder';

describe('mergeFileOrder', () => {
  const open = ['file:///a.txt', 'file:///b.txt', 'file:///c.txt'];
  const primary = 'file:///a.txt';

  it('falls back to tab order when existing order is empty', () => {
    expect(mergeFileOrder([], open, primary)).toEqual(open);
  });

  it('preserves user order for still-open tabs', () => {
    const saved = ['file:///c.txt', 'file:///a.txt', 'file:///b.txt'];
    expect(mergeFileOrder(saved, open, primary)).toEqual(saved);
  });

  it('drops closed tabs and appends newly opened tabs', () => {
    const saved = ['file:///c.txt', 'file:///gone.txt', 'file:///a.txt'];
    const nextOpen = [...open, 'file:///d.txt'];
    expect(mergeFileOrder(saved, nextOpen, primary)).toEqual([
      'file:///c.txt',
      'file:///a.txt',
      'file:///b.txt',
      'file:///d.txt',
    ]);
  });

  it('appends primary when missing from saved order but still open', () => {
    const saved = ['file:///b.txt', 'file:///c.txt'];
    expect(mergeFileOrder(saved, open, primary)).toEqual([
      'file:///b.txt',
      'file:///c.txt',
      'file:///a.txt',
    ]);
  });
});

describe('selectedUrisInFileOrder', () => {
  const primary = 'file:///a.txt';
  const openSet = new Set(['file:///a.txt', 'file:///b.txt', 'file:///c.txt']);
  const fileOrder = ['file:///c.txt', 'file:///a.txt', 'file:///b.txt'];

  it('returns selected files in fileOrder sequence', () => {
    expect(
      selectedUrisInFileOrder(
        fileOrder,
        ['file:///b.txt', 'file:///a.txt', 'file:///c.txt'],
        primary,
        openSet,
      ),
    ).toEqual(['file:///c.txt', 'file:///a.txt', 'file:///b.txt']);
  });

  it('always includes primary when still open', () => {
    expect(selectedUrisInFileOrder(fileOrder, ['file:///b.txt'], primary, openSet)).toEqual([
      'file:///a.txt',
      'file:///b.txt',
    ]);
  });

  it('allows primary at any position in fileOrder', () => {
    const order = ['file:///b.txt', 'file:///a.txt', 'file:///c.txt'];
    expect(
      selectedUrisInFileOrder(order, [primary, 'file:///b.txt', 'file:///c.txt'], primary, openSet),
    ).toEqual(['file:///b.txt', 'file:///a.txt', 'file:///c.txt']);
  });

  it('ignores closed or unknown URIs', () => {
    expect(
      selectedUrisInFileOrder(
        fileOrder,
        ['file:///missing.txt', 'file:///b.txt'],
        primary,
        openSet,
      ),
    ).toEqual(['file:///a.txt', 'file:///b.txt']);
  });
});

describe('normalizePreferredSelected', () => {
  it('keeps extras in order and excludes primary', () => {
    expect(
      normalizePreferredSelected('file:///a.txt', [
        'file:///c.txt',
        'file:///a.txt',
        'file:///b.txt',
        'file:///c.txt',
      ]),
    ).toEqual(['file:///c.txt', 'file:///b.txt']);
  });
});

describe('arraysEqual', () => {
  it('compares string arrays by value and order', () => {
    expect(arraysEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(arraysEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(arraysEqual(['a'], ['a', 'b'])).toBe(false);
  });
});

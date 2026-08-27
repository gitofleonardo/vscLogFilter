import { describe, expect, it } from 'vitest';
import {
  computeNextFindIndex,
  computePrevFindIndex,
  findMatchIndexAtOrAfter,
  findMatchIndexBefore,
  resolveMatchFromAnchor,
  type FindMatch,
} from '../src/session/findNavigation';

const sampleMatches: FindMatch[] = [
  { rowIndex: 10, start: 5, end: 8 },
  { rowIndex: 10, start: 20, end: 23 },
  { rowIndex: 50, start: 0, end: 3 },
  { rowIndex: 100, start: 10, end: 13 },
];

describe('findMatchIndexAtOrAfter', () => {
  it('finds first match at or after anchor row', () => {
    expect(findMatchIndexAtOrAfter(sampleMatches, 10, 0)).toBe(0);
    expect(findMatchIndexAtOrAfter(sampleMatches, 10, 6)).toBe(1);
    expect(findMatchIndexAtOrAfter(sampleMatches, 11, 0)).toBe(2);
    expect(findMatchIndexAtOrAfter(sampleMatches, 200, 0)).toBe(-1);
  });
});

describe('findMatchIndexBefore', () => {
  it('finds last match before anchor', () => {
    expect(findMatchIndexBefore(sampleMatches, 10, 25)).toBe(1);
    expect(findMatchIndexBefore(sampleMatches, 10, 20)).toBe(0);
    expect(findMatchIndexBefore(sampleMatches, 10, 0)).toBe(-1);
    expect(findMatchIndexBefore(sampleMatches, 100, 10)).toBe(2);
  });
});

describe('resolveMatchFromAnchor', () => {
  it('resolves forward from anchor with wrap', () => {
    expect(resolveMatchFromAnchor(sampleMatches, { rowIndex: 50, offset: 0 }, 1)).toBe(2);
    expect(resolveMatchFromAnchor(sampleMatches, { rowIndex: 200, offset: 0 }, 1)).toBe(0);
  });

  it('resolves backward from anchor with wrap', () => {
    expect(resolveMatchFromAnchor(sampleMatches, { rowIndex: 50, offset: 0 }, -1)).toBe(1);
    expect(resolveMatchFromAnchor(sampleMatches, { rowIndex: 0, offset: 0 }, -1)).toBe(3);
  });
});

describe('computeNextFindIndex', () => {
  it('starts from anchor when selection is on a different row', () => {
    const idx = computeNextFindIndex(
      sampleMatches,
      { rowIndex: 100, offset: 0 },
      sampleMatches[2],
      100,
      false,
    );
    expect(idx).toBe(3);
  });

  it('does not stick on the same match when find navigation synced', () => {
    const first = computeNextFindIndex(
      sampleMatches,
      { rowIndex: 10, offset: 0 },
      sampleMatches[0],
      10,
      true,
    );
    expect(first).toBe(1);

    const second = computeNextFindIndex(
      sampleMatches,
      { rowIndex: 10, offset: 0 },
      sampleMatches[1],
      10,
      true,
    );
    expect(second).toBe(2);
  });

  it('hits same-row first match when anchor is before it and not synced', () => {
    const idx = computeNextFindIndex(
      sampleMatches,
      { rowIndex: 10, offset: 0 },
      sampleMatches[1],
      10,
      false,
    );
    expect(idx).toBe(0);
  });

  it('wraps forward at end', () => {
    const idx = computeNextFindIndex(
      sampleMatches,
      { rowIndex: 100, offset: 0 },
      sampleMatches[3],
      100,
      true,
    );
    expect(idx).toBe(0);
  });
});

describe('computePrevFindIndex', () => {
  it('finds previous match on same row when synced', () => {
    const idx = computePrevFindIndex(
      sampleMatches,
      { rowIndex: 10, offset: 0 },
      sampleMatches[1],
      10,
      true,
    );
    expect(idx).toBe(0);
  });

  it('uses anchor when user moved to another row', () => {
    const idx = computePrevFindIndex(
      sampleMatches,
      { rowIndex: 100, offset: 0 },
      sampleMatches[0],
      100,
      false,
    );
    expect(idx).toBe(2);
  });

  it('wraps backward at start', () => {
    const idx = computePrevFindIndex(
      sampleMatches,
      { rowIndex: 10, offset: 0 },
      sampleMatches[0],
      10,
      true,
    );
    expect(idx).toBe(3);
  });
});

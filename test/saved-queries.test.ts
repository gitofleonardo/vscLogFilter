import { describe, expect, it } from 'vitest';
import {
  addSavedQuery,
  filterSavedQueries,
  normalizeSavedQuery,
  parseSavedQueries,
  removeSavedQuery,
} from '../src/session/savedQueries';

describe('normalizeSavedQuery', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeSavedQuery('  tag:foo  ')).toBe('tag:foo');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeSavedQuery('   \t')).toBe('');
  });
});

describe('parseSavedQueries', () => {
  it('returns empty array for non-arrays', () => {
    expect(parseSavedQueries(undefined)).toEqual([]);
    expect(parseSavedQueries('tag:foo')).toEqual([]);
    expect(parseSavedQueries({ query: 'tag:foo' })).toEqual([]);
  });

  it('skips non-strings, blanks, and duplicates', () => {
    expect(parseSavedQueries(['  tag:a  ', '', 'tag:a', 12, 'level:E', null, '  '])).toEqual([
      'tag:a',
      'level:E',
    ]);
  });

  it('caps the list at max', () => {
    expect(parseSavedQueries(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });
});

describe('addSavedQuery', () => {
  it('ignores empty or whitespace-only queries', () => {
    expect(addSavedQuery(['tag:a'], '   ')).toEqual(['tag:a']);
  });

  it('prepends a new query', () => {
    expect(addSavedQuery(['tag:a'], 'level:E')).toEqual(['level:E', 'tag:a']);
  });

  it('moves a duplicate to the top', () => {
    expect(addSavedQuery(['tag:a', 'level:E', 'is:crash'], '  level:E  ')).toEqual([
      'level:E',
      'tag:a',
      'is:crash',
    ]);
  });

  it('drops the oldest when over the max', () => {
    expect(addSavedQuery(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});

describe('removeSavedQuery', () => {
  it('removes a matching query after trim', () => {
    expect(removeSavedQuery(['tag:a', 'level:E'], '  tag:a  ')).toEqual(['level:E']);
  });

  it('is a no-op when the query is missing', () => {
    expect(removeSavedQuery(['tag:a'], 'level:E')).toEqual(['tag:a']);
  });
});

describe('filterSavedQueries', () => {
  const list = ['tag:AlarmManager', 'level:E', 'is:crash'];

  it('returns a copy of the full list when the needle is empty', () => {
    const filtered = filterSavedQueries(list, '  ');
    expect(filtered).toEqual(list);
    expect(filtered).not.toBe(list);
  });

  it('matches substrings case-insensitively', () => {
    expect(filterSavedQueries(list, 'ALARM')).toEqual(['tag:AlarmManager']);
    expect(filterSavedQueries(list, ' LEVEL ')).toEqual(['level:E']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterSavedQueries(list, 'pid:')).toEqual([]);
  });
});

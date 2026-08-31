import { describe, expect, it } from 'vitest';
import { truncateDisplayFileName } from '../src/uriUtils';

describe('truncateDisplayFileName', () => {
  it('returns short names unchanged', () => {
    expect(truncateDisplayFileName('test.txt')).toBe('test.txt');
    expect(truncateDisplayFileName('123456789012')).toBe('123456789012');
  });

  it('keeps original when omitted middle is at most ellipsis length (3)', () => {
    expect(truncateDisplayFileName('1234567890123')).toBe('1234567890123');
    expect(truncateDisplayFileName('123456789012345')).toBe('123456789012345');
  });

  it('truncates when omitted middle exceeds ellipsis length', () => {
    expect(truncateDisplayFileName('1234567890123456')).toBe('123456...123456');
    expect(truncateDisplayFileName('test-this-is-a-very-long-log-file-name.txt')).toBe(
      'test-t...me.txt',
    );
  });

  it('handles empty input', () => {
    expect(truncateDisplayFileName('')).toBe('');
  });
});

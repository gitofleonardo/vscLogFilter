import { describe, expect, it } from 'vitest';
import { chooseParseSource } from '../src/session/parseSource';

describe('chooseParseSource', () => {
  it('uses document for readable in-memory file buffers', () => {
    expect(
      chooseParseSource('file', { lineCount: 100, lineAt: (line) => ({ text: `line ${line}` }) }, 1024),
    ).toBe('document');
  });

  it('uses disk when local file has no open document', () => {
    expect(chooseParseSource('file', undefined, 1024)).toBe('disk');
  });

  it('uses disk when document reports zero lines but file is non-empty', () => {
    expect(chooseParseSource('file', { lineCount: 0 }, 1024)).toBe('disk');
  });

  it('uses disk when lineAt throws', () => {
    expect(
      chooseParseSource('file', {
        lineCount: 10,
        lineAt: () => {
          throw new Error('unavailable');
        },
      }, 1024),
    ).toBe('disk');
  });

  it('uses document for non-file schemes', () => {
    expect(chooseParseSource('untitled', { lineCount: 10 }, 0)).toBe('document');
  });
});

import { describe, expect, it } from 'vitest';
import { isDocumentReadable } from '../src/documentAccess';
import { uriMatches } from '../src/uriUtils';

describe('uriMatches', () => {
  it('matches file URIs by fsPath', () => {
    const a = { scheme: 'file', fsPath: '/tmp/test.log', toString: () => 'file:///tmp/test.log' };
    const b = { scheme: 'file', fsPath: '/tmp/test.log', toString: () => 'file:///tmp/test.log' };
    expect(uriMatches(a, b)).toBe(true);
  });

  it('does not match different files', () => {
    const a = { scheme: 'file', fsPath: '/tmp/a.log', toString: () => 'file:///tmp/a.log' };
    const b = { scheme: 'file', fsPath: '/tmp/b.log', toString: () => 'file:///tmp/b.log' };
    expect(uriMatches(a, b)).toBe(false);
  });
});

describe('isDocumentReadable', () => {
  it('treats lineCount 0 as unreadable', () => {
    expect(
      isDocumentReadable({
        lineCount: 0,
        lineAt: () => {
          throw new Error('unavailable');
        },
      }),
    ).toBe(false);
  });

  it('treats readable documents as readable', () => {
    expect(
      isDocumentReadable({
        lineCount: 10,
        lineAt: () => ({ text: 'hello' }),
      }),
    ).toBe(true);
  });
});

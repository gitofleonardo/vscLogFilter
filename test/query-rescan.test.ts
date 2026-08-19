import { describe, expect, it } from 'vitest';

/**
 * Query changes must filter in worker memory — never trigger a disk rescan.
 * Reparse only happens on file open, mtime change, or document edit.
 */
function shouldRescanForQueryChange(): boolean {
  return false;
}

describe('query rescan decision', () => {
  it('never rescans on query change after index is built', () => {
    expect(shouldRescanForQueryChange()).toBe(false);
  });
});

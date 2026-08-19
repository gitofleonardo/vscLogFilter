import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { parseLogDocument } from '../src/log/parser';
import { forEachLineChunk } from '../src/log/fileLineStream';

const sampleLog = path.join(__dirname, 'fixtures', 'sample.log');

describe('fileLineStream', () => {
  it('reads file chunks matching single-pass parse', async () => {
    const chunks: string[][] = [];
    await forEachLineChunk(sampleLog, 3, {
      fileSize: 0,
      shouldContinue: () => true,
      onChunk: async (lines) => {
        chunks.push(lines);
      },
    });

    const merged = chunks.flat();
    const fromFile = parseLogDocument(merged);
    expect(fromFile.entries.length).toBeGreaterThan(0);
    expect(fromFile.format).not.toBe('unknown');
  });
});

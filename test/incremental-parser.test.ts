import { describe, expect, it } from 'vitest';
import {
  createParseAccumulator,
  finalizeParseAccumulator,
  parseLogDocument,
  parseLogLinesChunk,
} from '../src/log/parser';

const LINE1 =
  '05-26 11:02:40.200 5689 5689 E AndroidRuntime: FATAL EXCEPTION: main';
const LINE2 = '05-26 11:02:40.201 5689 5689 E AndroidRuntime: Caused by: NPE';
const CONT1 = '05-26 11:02:40.202 5689 5689 E AndroidRuntime: java.lang.RuntimeException';
const CONT2 = '    at com.example.MainActivity.onCreate(MainActivity.java:42)';

describe('IncrementalParser', () => {
  it('chunked parse matches single-pass parse', () => {
    const lines = [LINE1, CONT2, LINE2];
    const single = parseLogDocument(lines);

    const acc = createParseAccumulator();
    parseLogLinesChunk(acc, lines.slice(0, 1), 0);
    parseLogLinesChunk(acc, lines.slice(1, 2), 1);
    parseLogLinesChunk(acc, lines.slice(2), 2);
    const chunked = finalizeParseAccumulator(acc);

    expect(chunked.entries.length).toBe(single.entries.length);
    expect(chunked.entries[0].fullText).toBe(single.entries[0].fullText);
    expect(chunked.entries[0].lineNumber).toBe(0);
  });

  it('merges continuation split across chunk boundary', () => {
    const acc = createParseAccumulator();
    parseLogLinesChunk(acc, [CONT1], 0);
    parseLogLinesChunk(acc, [CONT2], 1);
    const result = finalizeParseAccumulator(acc);

    expect(result.entries.length).toBe(1);
    expect(result.entries[0].fullText).toContain('MainActivity.java:42');
  });

  it('preserves line numbers with offset chunks', () => {
    const acc = createParseAccumulator();
    parseLogLinesChunk(acc, [LINE1], 100);
    parseLogLinesChunk(acc, [LINE2], 101);
    const result = finalizeParseAccumulator(acc);

    expect(result.entries[0].lineNumber).toBe(100);
    expect(result.entries[1].lineNumber).toBe(101);
  });
});

describe('Large file thresholds', () => {
  it('parses many lines via chunked accumulator', () => {
    const lines = Array.from(
      { length: 20000 },
      (_, i) =>
        `05-26 11:02:${String(i % 60).padStart(2, '0')}.000 1000 1000 I Tag${i % 10}: message ${i}`,
    );
    const acc = createParseAccumulator();
    const chunkSize = 5000;
    for (let offset = 0; offset < lines.length; offset += chunkSize) {
      parseLogLinesChunk(acc, lines.slice(offset, offset + chunkSize), offset);
    }
    const result = finalizeParseAccumulator(acc);
    expect(result.entries.length).toBe(20000);
  });
});

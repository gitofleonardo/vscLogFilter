import { describe, expect, it } from 'vitest';
import {
  findMessageRangeInLine,
  findTagRangeInLine,
  parseLogText,
} from '../src/log/parser';
import type { LogEntry } from '../src/types';
import { collectHighlightRanges, extractHighlightTerms } from '../src/query/highlights';

const threadLine =
  '08-18 10:44:46.772  2917  3786 I AlarmManager: Alarm deliverLocked';
const timeLine = '08-18 10:44:46.772 I/dalvikvm(  236): GC_CONCURRENT freed 123K';

function rowMeta(line: string) {
  const tag = findTagRangeInLine(line);
  const message = findMessageRangeInLine(line);
  return {
    tagStart: tag?.start,
    tagEnd: tag?.end,
    messageStart: message?.start,
    messageEnd: message?.end,
  };
}

function rowMetaFromEntry(entry: LogEntry) {
  return {
    tagStart: entry.tagStart,
    tagEnd: entry.tagEnd,
    messageStart: entry.messageStart,
    messageEnd: entry.messageEnd,
  };
}

describe('findTagRangeInLine', () => {
  it('locates tag in threadtime format', () => {
    const range = findTagRangeInLine(threadLine);
    expect(range?.text).toBe('AlarmManager');
    expect(threadLine.slice(range!.start, range!.end)).toBe('AlarmManager');
  });

  it('locates tag in time format', () => {
    const range = findTagRangeInLine(timeLine);
    expect(range?.text).toBe('dalvikvm');
    expect(timeLine.slice(range!.start, range!.end)).toBe('dalvikvm');
  });

  it('uses first line when text contains continuations', () => {
    const multi = `${threadLine}\n    at com.example.Foo.run`;
    const range = findTagRangeInLine(multi);
    expect(range?.text).toBe('AlarmManager');
    expect(multi.slice(range!.start, range!.end)).toBe('AlarmManager');
  });

  it('returns undefined for non-logcat lines', () => {
    expect(findTagRangeInLine('plain text')).toBeUndefined();
  });
});

describe('findMessageRangeInLine', () => {
  it('locates message on threadtime lines', () => {
    const range = findMessageRangeInLine(threadLine);
    expect(range?.text).toBe('Alarm deliverLocked');
    expect(threadLine.slice(range!.start, range!.end)).toBe('Alarm deliverLocked');
  });
});

describe('extractHighlightTerms', () => {
  it('marks tag=: as exact tag field', () => {
    expect(extractHighlightTerms('tag=:AlarmManager')).toEqual([
      { text: 'AlarmManager', field: 'tag', exact: true },
    ]);
  });

  it('omits negated tag=:', () => {
    expect(extractHighlightTerms('-tag=:Ignore')).toEqual([]);
  });

  it('supports multiple tag=: terms', () => {
    expect(extractHighlightTerms('tag=:Foo tag=:Bar')).toEqual([
      { text: 'Foo', field: 'tag', exact: true },
      { text: 'Bar', field: 'tag', exact: true },
    ]);
  });

  it('maps process: to tag field', () => {
    expect(extractHighlightTerms('process=:AlarmManager')).toEqual([
      { text: 'AlarmManager', field: 'tag', exact: true },
    ]);
  });
});

describe('collectHighlightRanges', () => {
  it('highlights exact tag match in threadtime lines', () => {
    const terms = extractHighlightTerms('tag=:AlarmManager');
    const ranges = collectHighlightRanges(threadLine, terms, rowMeta(threadLine));
    expect(ranges).toEqual([{ start: 33, end: 45 }]);
  });

  it('highlights exact tag match in time format lines', () => {
    const terms = extractHighlightTerms('tag=:dalvikvm');
    const meta = rowMeta(timeLine);
    const ranges = collectHighlightRanges(timeLine, terms, meta);
    expect(ranges).toEqual([{ start: meta.tagStart, end: meta.tagEnd }]);
  });

  it('does not highlight substring tag with tag=:', () => {
    const line =
      '08-18 12:58:34.621 1 1 I FooBar: message mentions Foo elsewhere';
    const terms = extractHighlightTerms('tag=:Foo');
    const ranges = collectHighlightRanges(line, terms, rowMeta(line));
    expect(ranges).toEqual([]);
  });

  it('exact tag highlight is case-sensitive like filter', () => {
    const terms = extractHighlightTerms('tag=:alarmmanager');
    const ranges = collectHighlightRanges(threadLine, terms, rowMeta(threadLine));
    expect(ranges).toEqual([]);
  });

  it('highlights substring tag only inside tag field', () => {
    const line =
      '08-18 12:58:34.621 1 1 I AlarmManager: message also has AlarmManager word';
    const terms = extractHighlightTerms('tag:Alarm');
    const meta = rowMeta(line);
    const ranges = collectHighlightRanges(line, terms, meta);
    expect(ranges).toEqual([{ start: meta.tagStart, end: meta.tagStart! + 5 }]);
    expect(line.slice(ranges[0].start, ranges[0].end)).toBe('Alarm');
  });

  it('highlights message=: inside message span only', () => {
    const line = '08-18 12:58:34.621 1 1 I T: deliverLocked';
    const terms = extractHighlightTerms('message=:deliverLocked');
    const ranges = collectHighlightRanges(line, terms, rowMeta(line));
    expect(ranges).toHaveLength(1);
    expect(line.slice(ranges[0].start, ranges[0].end)).toBe('deliverLocked');
  });

  it('does not highlight message=: when value differs by case', () => {
    const line = '08-18 12:58:34.621 1 1 I T: Hello World';
    const terms = extractHighlightTerms('message=:hello');
    expect(terms).toEqual([{ text: 'hello', field: 'message', exact: true }]);
    const ranges = collectHighlightRanges(line, terms, rowMeta(line));
    expect(ranges).toEqual([]);
  });

  it('keeps tag span on continuation entries from parse', () => {
    const lines = [
      '08-18 10:44:46.772  2917  3786 I AlarmManager: first',
      '    at com.example.Foo.run',
    ].join('\n');
    const { entries } = parseLogText(lines);
    const entry = entries[0];
    expect(entry.tagStart).toBeDefined();
    expect(entry.fullText.slice(entry.tagStart!, entry.tagEnd!)).toBe('AlarmManager');
    expect(entry.messageEnd).toBe(entry.fullText.length);

    const terms = extractHighlightTerms('tag=:AlarmManager');
    const ranges = collectHighlightRanges(entry.fullText, terms, rowMetaFromEntry(entry));
    expect(ranges).toEqual([{ start: entry.tagStart, end: entry.tagEnd }]);
  });

  it('extends message span through stack continuations', () => {
    const lines = [
      '08-18 10:44:46.772  2917  3786 I T: head',
      '    Caused by: tail',
    ].join('\n');
    const { entries } = parseLogText(lines);
    const entry = entries[0];
    expect(entry.message).toBe('head\n    Caused by: tail');
    expect(entry.messageEnd).toBe(entry.fullText.length);

    const terms = extractHighlightTerms('message:Caused');
    const ranges = collectHighlightRanges(entry.fullText, terms, rowMetaFromEntry(entry));
    expect(ranges).toHaveLength(1);
    expect(entry.fullText.slice(ranges[0].start, ranges[0].end)).toBe('Caused');
  });

  it('works with parsed log entries end-to-end', () => {
    const lines = [
      '08-18 12:58:34.621 1 1 I Foo: a',
      '08-18 12:58:34.621 1 1 I FooBar: b',
      '08-18 10:44:46.772 I/dalvikvm(  236): GC',
    ].join('\n');
    const { entries } = parseLogText(lines);

    const fooEntry = entries.find((e) => e.tag === 'Foo')!;
    expect(
      collectHighlightRanges(fooEntry.fullText, extractHighlightTerms('tag=:Foo tag=:dalvikvm'), {
        tagStart: fooEntry.tagStart,
        tagEnd: fooEntry.tagEnd,
      }),
    ).toEqual([{ start: fooEntry.tagStart, end: fooEntry.tagEnd }]);

    const barEntry = entries.find((e) => e.tag === 'FooBar')!;
    expect(
      collectHighlightRanges(barEntry.fullText, extractHighlightTerms('tag=:Foo tag=:dalvikvm'), {
        tagStart: barEntry.tagStart,
        tagEnd: barEntry.tagEnd,
      }),
    ).toEqual([]);
  });
});

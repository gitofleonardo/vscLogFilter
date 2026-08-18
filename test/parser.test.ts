import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLogText } from '../src/log/parser';
import { parseAndFilter, parseQuery } from '../src/query';

const samplePath = path.join(__dirname, 'fixtures/sample.log');
const sampleText = fs.readFileSync(samplePath, 'utf8');

describe('LogParser', () => {
  it('parses threadtime entries and merges continuations', () => {
    const result = parseLogText(sampleText);
    expect(result.entries.length).toBeGreaterThan(5);
    const crash = result.entries.find((e) => e.tag === 'AndroidRuntime' && e.level === 'E');
    expect(crash).toBeDefined();
    expect(crash!.message).toContain('FATAL EXCEPTION');
    const stackEntry = result.entries.find((e) => e.fullText.includes('Caused by'));
    expect(stackEntry).toBeDefined();
  });

  it('parses time format entry', () => {
    const result = parseLogText(sampleText);
    const dalvik = result.entries.find((e) => e.message.includes('GC_CONCURRENT') && e.pid === 236);
    expect(dalvik).toBeDefined();
  });
});

describe('QueryEngine', () => {
  const { entries, fileMaxTime } = parseLogText(sampleText);

  it('filters by tag', () => {
    const { matched } = parseAndFilter('tag:Runtime', entries, fileMaxTime);
    expect(matched.every((e) => (e.tag ?? '').includes('Runtime'))).toBe(true);
    expect(matched.length).toBeGreaterThan(0);
  });

  it('implicit OR for same key', () => {
    const { matched } = parseAndFilter('tag:Runtime tag:Firebase', entries, fileMaxTime);
    expect(matched.some((e) => e.tag === 'FirebaseApp')).toBe(true);
    expect(matched.some((e) => e.tag === 'AndroidRuntime')).toBe(true);
  });

  it('filters by level upward', () => {
    const { matched } = parseAndFilter('level:W', entries, fileMaxTime);
    expect(matched.every((e) => ['W', 'E', 'F', 'A'].includes(e.level ?? ''))).toBe(true);
  });

  it('filters by pid', () => {
    const { matched } = parseAndFilter('pid:5689', entries, fileMaxTime);
    expect(matched.every((e) => e.pid === 5689)).toBe(true);
    expect(matched.length).toBeGreaterThan(0);
  });

  it('rejects invalid pid suffixes', () => {
    const line = parseLogText(
      '08-18 12:58:34.621 2917 3786 I AlarmManager: com.tencent.mm setAlarm foo',
    );
    const { matched } = parseAndFilter('pid:2917aaa', line.entries, line.fileMaxTime);
    expect(matched.length).toBe(0);
  });

  it('ANDs separate bare words on the full line', () => {
    const line = parseLogText(
      '08-18 12:58:34.621 2917 3786 I AlarmManager: com.tencent.mm setAlarm foo',
    );
    const { matched } = parseAndFilter(
      'tag:AlarmManager tencent setAlarm pid:2917',
      line.entries,
      line.fileMaxTime,
    );
    expect(matched.length).toBe(1);
    expect(matched[0].pid).toBe(2917);

    const otherPid = parseAndFilter(
      'tag:AlarmManager tencent setAlarm pid:1615',
      line.entries,
      line.fileMaxTime,
    );
    expect(otherPid.matched.length).toBe(0);
  });

  it('OR only applies to bare text; field keys stay global AND', () => {
    const lines = [
      '08-18 12:58:34.621 2917 3786 I AlarmManager: com.tencent.mm foo',
      '08-18 12:58:34.621 2917 5472 I AlarmManager: wakeup alarm',
      '08-18 12:58:34.621 1615 1615 I AlarmManager: com.tencent.mm bar',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);

    const { matched } = parseAndFilter(
      'tag:AlarmManager tencent | wakeup pid:2917',
      entries,
      fileMaxTime,
    );
    expect(matched.length).toBe(2);
    expect(matched.every((e) => e.pid === 2917)).toBe(true);

    const wrongPid = parseAndFilter(
      'tag:AlarmManager tencent | wakeup pid:29199',
      entries,
      fileMaxTime,
    );
    expect(wrongPid.matched.length).toBe(0);
  });

  it('text OR groups still AND with each other inside a segment', () => {
    const line = parseLogText('08-18 12:58:34.621 2917 3786 I AlarmManager: foo bar baz');
    const { matched } = parseAndFilter('foo bar | baz', line.entries, line.fileMaxTime);
    expect(matched.length).toBe(1);
  });

  it('filters by after/before with date and time value', () => {
    const lines = [
      '08-18 10:44:55.033 2917 3786 I AlarmManager: com.tencent.mm wakeup',
      '08-18 11:59:43.000 2917 3786 I AlarmManager: com.tencent.mm wakeup',
      '08-19 10:44:55.033 2917 3786 I AlarmManager: com.tencent.mm wakeup',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);

    const { matched } = parseAndFilter(
      'tag:AlarmManager before:08-18 11:59:42 after:08-18 10:44:50',
      entries,
      fileMaxTime,
    );
    expect(matched.length).toBe(1);
    expect(matched[0].fullText).toContain('08-18 10:44:55');

    const { ast } = parseQuery('before:08-18 11:59:42');
    const beforeNode =
      ast?.kind === 'key'
        ? ast
        : ast?.kind === 'and'
          ? ast.children.find((n) => n.kind === 'key' && n.field === 'before')
          : undefined;
    expect(beforeNode?.kind).toBe('key');
    expect(beforeNode?.kind === 'key' ? beforeNode.value : '').toBe('08-18 11:59:42');
  });

  it('filters by after/before time-of-day on the log line date', () => {
    const lines = [
      '08-18 10:44:55.033 2917 3786 I AlarmManager: com.tencent.mm wakeup',
      '08-18 11:59:43.000 2917 3786 I AlarmManager: com.tencent.mm wakeup',
      '08-18 10:44:49.000 2917 3786 I AlarmManager: com.tencent.mm wakeup',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);

    const inRange = parseAndFilter(
      'tag:AlarmManager before:11:59:42 after:10:44:50',
      entries,
      fileMaxTime,
    );
    expect(inRange.matched.length).toBe(1);
    expect(inRange.matched[0].fullText).toContain('10:44:55');

    const fullQuery = parseAndFilter(
      'tag:AlarmManager tencent | wakeup pid:2917 before:11:59:42 after:10:44:50',
      entries,
      fileMaxTime,
    );
    expect(fullQuery.matched.length).toBe(1);
  });

  it('bare phrase matches fullText', () => {
    const { matched } = parseAndFilter('FATAL EXCEPTION', entries, fileMaxTime);
    expect(matched.length).toBeGreaterThan(0);
  });

  it('is:crash matches crash entries', () => {
    const { matched } = parseAndFilter('is:crash', entries, fileMaxTime);
    expect(matched.some((e) => e.fullText.includes('FATAL EXCEPTION'))).toBe(true);
  });

  it('warns on regex and package', () => {
    const { warnings } = parseAndFilter('tag~:Foo package:com.example', entries, fileMaxTime);
    expect(warnings.some((w) => w.includes('Regex'))).toBe(true);
    expect(warnings.some((w) => w.includes('package'))).toBe(true);
  });

  it('implicit OR for tag list', () => {
    const { matched } = parseAndFilter('tag:Runtime tag:Firebase', entries, fileMaxTime);
    expect(matched.length).toBeGreaterThan(1);
  });
});

describe('QueryParser', () => {
  const { entries, fileMaxTime } = parseLogText(sampleText);

  it('parses explicit grouping', () => {
    const { ast } = parseQuery('(tag:foo | level:ERROR) & pid:5689');
    expect(ast?.kind).toBe('and');
  });

  it('ignores trailing incomplete OR while typing', () => {
    const full = parseAndFilter('tag:Runtime', entries, fileMaxTime);
    const partial = parseAndFilter('tag:Runtime |', entries, fileMaxTime);
    expect(partial.matched.map((e) => e.id)).toEqual(full.matched.map((e) => e.id));
  });

  it('ignores trailing incomplete AND while typing', () => {
    const full = parseAndFilter('tag:Runtime', entries, fileMaxTime);
    const partial = parseAndFilter('tag:Runtime &', entries, fileMaxTime);
    expect(partial.matched.map((e) => e.id)).toEqual(full.matched.map((e) => e.id));
  });
});

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

  it('space-separated keys AND with text OR segments', () => {
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

  it('explicit OR includes keys and bare text', () => {
    const lines = [
      '08-18 12:58:34.621 2917 3786 I SurfaceControl: alpha change',
      '08-18 12:58:34.621 2917 3786 I OtherTag: transition started',
      '08-18 12:58:34.621 2917 3786 I OtherTag: launcher resume',
      '08-18 12:58:34.621 2917 3786 I OtherTag: unrelated',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);

    const { ast } = parseQuery('tag:SurfaceControl | transition | launcher');
    expect(ast?.kind).toBe('or');

    const { matched } = parseAndFilter(
      'tag:SurfaceControl | transition | launcher',
      entries,
      fileMaxTime,
    );
    expect(matched.length).toBe(3);
    expect(matched.some((e) => e.tag === 'SurfaceControl')).toBe(true);
    expect(matched.some((e) => e.fullText.includes('transition'))).toBe(true);
    expect(matched.some((e) => e.fullText.includes('launcher'))).toBe(true);
    expect(matched.every((e) => !e.fullText.includes('unrelated'))).toBe(true);
  });

  it('foo bar | baz is foo AND (bar OR baz)', () => {
    const lines = [
      '08-18 12:58:34.621 2917 3786 I AlarmManager: foo bar baz',
      '08-18 12:58:34.621 2917 3786 I AlarmManager: only baz here',
      '08-18 12:58:34.621 2917 3786 I AlarmManager: foo and baz',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);

    const { matched } = parseAndFilter('foo bar | baz', entries, fileMaxTime);
    expect(matched.length).toBe(2);
    expect(matched.every((e) => e.fullText.includes('foo'))).toBe(true);
    expect(matched.some((e) => e.fullText.includes('only baz'))).toBe(false);
  });

  it('exact tag joins same-key implicit OR', () => {
    const lines = [
      '08-18 12:58:34.621 2917 3786 I Runtime: a',
      '08-18 12:58:34.621 2917 3786 I Firebase: b',
      '08-18 12:58:34.621 2917 3786 I Other: c',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);

    const { ast } = parseQuery('tag:Runtime tag=:Firebase');
    expect(ast?.kind).toBe('or');

    const { matched } = parseAndFilter('tag:Runtime tag=:Firebase', entries, fileMaxTime);
    expect(matched.length).toBe(2);
    expect(matched.some((e) => e.tag === 'Runtime')).toBe(true);
    expect(matched.some((e) => e.tag === 'Firebase')).toBe(true);
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

  it('empty query yields null ast', () => {
    expect(parseQuery('').ast).toBeNull();
    expect(parseQuery('   ').ast).toBeNull();
  });

  it('parse_or: tag | text | key is pure OR (AS golden)', () => {
    const { ast } = parseQuery('tag:bar | foo | message:foobar');
    expect(ast).toEqual({
      kind: 'or',
      children: [
        { kind: 'key', field: 'tag', value: 'bar', negated: false, mode: 'contains' },
        { kind: 'phrase', text: 'foo' },
        { kind: 'key', field: 'message', value: 'foobar', negated: false, mode: 'contains' },
      ],
    });
  });

  it('parse_and: explicit & connects keys and text', () => {
    const { ast } = parseQuery('tag:bar & foo & pid:1');
    expect(ast?.kind).toBe('and');
    if (ast?.kind !== 'and') {
      return;
    }
    expect(ast.children).toEqual(
      expect.arrayContaining([
        { kind: 'key', field: 'tag', value: 'bar', negated: false, mode: 'contains' },
        { kind: 'phrase', text: 'foo' },
        { kind: 'key', field: 'pid', value: '1', negated: false, mode: 'contains' },
      ]),
    );
    expect(ast.children).toHaveLength(3);
  });

  it('operator precedence: & binds tighter than |', () => {
    const { ast } = parseQuery('f1 & f2 | f3 & f4');
    expect(ast).toEqual({
      kind: 'or',
      children: [
        {
          kind: 'and',
          children: [
            { kind: 'phrase', text: 'f1' },
            { kind: 'phrase', text: 'f2' },
          ],
        },
        {
          kind: 'and',
          children: [
            { kind: 'phrase', text: 'f3' },
            { kind: 'phrase', text: 'f4' },
          ],
        },
      ],
    });
  });

  it('parens override precedence', () => {
    const { ast } = parseQuery('f1 & (tag:foo | tag:bar) & f4');
    expect(ast?.kind).toBe('and');
    if (ast?.kind !== 'and') {
      return;
    }
    expect(ast.children).toHaveLength(3);
    expect(ast.children).toContainEqual({ kind: 'phrase', text: 'f1' });
    expect(ast.children).toContainEqual({ kind: 'phrase', text: 'f4' });
    expect(ast.children).toContainEqual({
      kind: 'or',
      children: [
        { kind: 'key', field: 'tag', value: 'foo', negated: false, mode: 'contains' },
        { kind: 'key', field: 'tag', value: 'bar', negated: false, mode: 'contains' },
      ],
    });
  });

  it('space-separated bare words stay AND (not joined phrase)', () => {
    const { ast } = parseQuery('foo bar');
    expect(ast).toEqual({
      kind: 'and',
      children: [
        { kind: 'phrase', text: 'foo' },
        { kind: 'phrase', text: 'bar' },
      ],
    });
  });

  it('space-separated same key becomes implicit OR', () => {
    const { ast } = parseQuery('tag:a tag:b');
    expect(ast).toEqual({
      kind: 'or',
      children: [
        { kind: 'key', field: 'tag', value: 'a', negated: false, mode: 'contains' },
        { kind: 'key', field: 'tag', value: 'b', negated: false, mode: 'contains' },
      ],
    });
  });

  it('negated tag does not join same-key OR', () => {
    const { ast } = parseQuery('tag:a -tag:b');
    expect(ast?.kind).toBe('and');
    if (ast?.kind !== 'and') {
      return;
    }
    expect(ast.children).toEqual(
      expect.arrayContaining([
        { kind: 'key', field: 'tag', value: 'a', negated: false, mode: 'contains' },
        { kind: 'key', field: 'tag', value: 'b', negated: true, mode: 'contains' },
      ]),
    );
  });

  it('exact and contains tags join same-key OR', () => {
    const { ast } = parseQuery('tag:a tag=:b');
    expect(ast).toEqual({
      kind: 'or',
      children: [
        { kind: 'key', field: 'tag', value: 'a', negated: false, mode: 'contains' },
        { kind: 'key', field: 'tag', value: 'b', negated: false, mode: 'exact' },
      ],
    });
  });

  it('different keys stay AND when space-separated', () => {
    const { ast } = parseQuery('tag:a pid:1 level:W');
    expect(ast?.kind).toBe('and');
    if (ast?.kind !== 'and') {
      return;
    }
    expect(ast.children).toEqual(
      expect.arrayContaining([
        { kind: 'key', field: 'tag', value: 'a', negated: false, mode: 'contains' },
        { kind: 'key', field: 'pid', value: '1', negated: false, mode: 'contains' },
        { kind: 'key', field: 'level', value: 'W', negated: false, mode: 'contains' },
      ]),
    );
    expect(ast.children).toHaveLength(3);
  });

  it('top-level mix: key, text OR segment, key', () => {
    const { ast } = parseQuery('tag:AlarmManager tencent | wakeup pid:2917');
    expect(ast?.kind).toBe('and');
    if (ast?.kind !== 'and') {
      return;
    }
    expect(ast.children).toContainEqual({
      kind: 'key',
      field: 'tag',
      value: 'AlarmManager',
      negated: false,
      mode: 'contains',
    });
    expect(ast.children).toContainEqual({
      kind: 'key',
      field: 'pid',
      value: '2917',
      negated: false,
      mode: 'contains',
    });
    expect(ast.children).toContainEqual({
      kind: 'or',
      children: [
        { kind: 'phrase', text: 'tencent' },
        { kind: 'phrase', text: 'wakeup' },
      ],
    });
  });

  it('foo bar | baz parses as foo AND (bar OR baz)', () => {
    const { ast } = parseQuery('foo bar | baz');
    expect(ast).toEqual({
      kind: 'and',
      children: [
        { kind: 'phrase', text: 'foo' },
        {
          kind: 'or',
          children: [
            { kind: 'phrase', text: 'bar' },
            { kind: 'phrase', text: 'baz' },
          ],
        },
      ],
    });
  });

  it('tag | text | tag is pure OR across fields', () => {
    const { ast } = parseQuery('tag:SurfaceControl | transition | launcher');
    expect(ast).toEqual({
      kind: 'or',
      children: [
        { kind: 'key', field: 'tag', value: 'SurfaceControl', negated: false, mode: 'contains' },
        { kind: 'phrase', text: 'transition' },
        { kind: 'phrase', text: 'launcher' },
      ],
    });
  });

  it('explicit OR between two tags', () => {
    const { ast } = parseQuery('tag:foo | tag:bar');
    expect(ast).toEqual({
      kind: 'or',
      children: [
        { kind: 'key', field: 'tag', value: 'foo', negated: false, mode: 'contains' },
        { kind: 'key', field: 'tag', value: 'bar', negated: false, mode: 'contains' },
      ],
    });
  });

  it('after/before stay independent AND terms', () => {
    const { ast } = parseQuery('after:10:00:00 before:11:00:00 tag:x');
    expect(ast?.kind).toBe('and');
    if (ast?.kind !== 'and') {
      return;
    }
    expect(ast.children).toEqual(
      expect.arrayContaining([
        { kind: 'key', field: 'after', value: '10:00:00', negated: false, mode: 'contains' },
        { kind: 'key', field: 'before', value: '11:00:00', negated: false, mode: 'contains' },
        { kind: 'key', field: 'tag', value: 'x', negated: false, mode: 'contains' },
      ]),
    );
  });

  it('quoted values and escapes', () => {
    const { ast } = parseQuery(`tag:'foo bar' message:"a\\nb"`);
    expect(ast?.kind).toBe('and');
    if (ast?.kind !== 'and') {
      return;
    }
    expect(ast.children).toContainEqual({
      kind: 'key',
      field: 'tag',
      value: 'foo bar',
      negated: false,
      mode: 'contains',
    });
    expect(ast.children).toContainEqual({
      kind: 'key',
      field: 'message',
      value: 'anb',
      negated: false,
      mode: 'contains',
    });
  });

  it('warns and ignores regex / package in AST path', () => {
    const { warnings, ast } = parseQuery('tag~:Foo package:com.example tag:Ok');
    expect(warnings.some((w) => w.includes('Regex'))).toBe(true);
    expect(warnings.some((w) => w.includes('package'))).toBe(true);
    // ignored terms become empty line keys; real tag remains
    expect(JSON.stringify(ast)).toContain('"field":"tag"');
    expect(JSON.stringify(ast)).toContain('"value":"Ok"');
  });
});

describe('QueryEngine OR semantics', () => {
  it('tag | message | text matches any branch', () => {
    const lines = [
      '08-18 12:58:34.621 1 1 I Alpha: hello',
      '08-18 12:58:34.621 1 1 I Other: need beta here',
      '08-18 12:58:34.621 1 1 I Other: gamma only',
      '08-18 12:58:34.621 1 1 I Other: none',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    const { matched } = parseAndFilter('tag:Alpha | message:beta | gamma', entries, fileMaxTime);
    expect(matched.map((e) => e.fullText)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('beta'),
      expect.stringContaining('gamma'),
    ]);
  });

  it('f1 & f2 | f3 & f4 matches either AND pair', () => {
    const lines = [
      '08-18 12:58:34.621 1 1 I T: f1 f2 xx',
      '08-18 12:58:34.621 1 1 I T: f3 f4 yy',
      '08-18 12:58:34.621 1 1 I T: f1 f3 zz',
      '08-18 12:58:34.621 1 1 I T: f2 f4 ww',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    const { matched } = parseAndFilter('f1 & f2 | f3 & f4', entries, fileMaxTime);
    expect(matched).toHaveLength(2);
    expect(matched.every((e) => e.fullText.includes('f1 f2') || e.fullText.includes('f3 f4'))).toBe(
      true,
    );
  });

  it('parens: (tag:a | tag:b) & level:E', () => {
    const lines = [
      '08-18 12:58:34.621 1 1 E TagA: err',
      '08-18 12:58:34.621 1 1 E TagB: err',
      '08-18 12:58:34.621 1 1 I TagA: info',
      '08-18 12:58:34.621 1 1 E Other: err',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    const { matched } = parseAndFilter('(tag:TagA | tag:TagB) & level:E', entries, fileMaxTime);
    expect(matched).toHaveLength(2);
    expect(matched.every((e) => e.level === 'E')).toBe(true);
    expect(matched.every((e) => e.tag === 'TagA' || e.tag === 'TagB')).toBe(true);
  });

  it('negation ANDs with positive same key', () => {
    const lines = [
      '08-18 12:58:34.621 1 1 I KeepMe: ok',
      '08-18 12:58:34.621 1 1 I DropMe: no',
      '08-18 12:58:34.621 1 1 I KeepMeExtra: yes',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    const { matched } = parseAndFilter('tag:Keep -tag:Drop', entries, fileMaxTime);
    expect(matched).toHaveLength(2);
    expect(matched.every((e) => !(e.tag ?? '').includes('Drop'))).toBe(true);
  });

  it('exact match does not substring', () => {
    const lines = [
      '08-18 12:58:34.621 1 1 I Foo: a',
      '08-18 12:58:34.621 1 1 I FooBar: b',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    expect(parseAndFilter('tag=:Foo', entries, fileMaxTime).matched).toHaveLength(1);
    expect(parseAndFilter('tag:Foo', entries, fileMaxTime).matched).toHaveLength(2);
  });

  it('message: field OR with tag:', () => {
    const lines = [
      '08-18 12:58:34.621 1 1 I Wanted: x',
      '08-18 12:58:34.621 1 1 I Other: needle in message',
      '08-18 12:58:34.621 1 1 I Other: miss',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    const { matched } = parseAndFilter('tag:Wanted | message:needle', entries, fileMaxTime);
    expect(matched).toHaveLength(2);
  });

  it('pid same-key implicit OR', () => {
    const lines = [
      '08-18 12:58:34.621 10 1 I T: a',
      '08-18 12:58:34.621 20 1 I T: b',
      '08-18 12:58:34.621 30 1 I T: c',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    const { matched } = parseAndFilter('pid:10 pid:20', entries, fileMaxTime);
    expect(matched.map((e) => e.pid).sort()).toEqual([10, 20]);
  });

  it('level same-key implicit OR uses minimum-or semantics per term', () => {
    const lines = [
      '08-18 12:58:34.621 1 1 D T: d',
      '08-18 12:58:34.621 1 1 W T: w',
      '08-18 12:58:34.621 1 1 E T: e',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    // level:W | level:E via space → OR of (W+) and (E+) → still W and E
    const { matched } = parseAndFilter('level:W level:E', entries, fileMaxTime);
    expect(matched.map((e) => e.level).sort()).toEqual(['E', 'W']);
  });

  it('complex: (tag:a | phrase) & pid with after', () => {
    const lines = [
      '08-18 10:00:00.000 5 1 I TagA: early',
      '08-18 11:00:00.000 5 1 I TagA: late',
      '08-18 11:00:00.000 5 1 I Other: hitphrase late',
      '08-18 11:00:00.000 9 1 I TagA: wrong pid',
    ].join('\n');
    const { entries, fileMaxTime } = parseLogText(lines);
    const { matched } = parseAndFilter(
      '(tag:TagA | hitphrase) & pid:5 after:10:30:00',
      entries,
      fileMaxTime,
    );
    expect(matched).toHaveLength(2);
    expect(matched.every((e) => e.pid === 5)).toBe(true);
    expect(matched.every((e) => e.fullText.includes('11:00:00'))).toBe(true);
  });
});

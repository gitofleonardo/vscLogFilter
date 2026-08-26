import type { LogEntry, ParseResult } from '../types';
import { LOGCAT_DETECT_SAMPLE_LINES } from '../constants';
import { inferBaseYear, parseThreadtimeTimestamp } from './timestamp';

const THREADTIME_LINE =
  /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})(?:\s+[0-9A-Za-z]+)?\s+(\d+)\s+(\d+)\s+([A-Z])\s+(.+?)\s*: (.*)$/;

const TIME_LINE =
  /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+([A-Z])\/(.+?)\(\s*(\d+)\):\s*(.*)$/;

export interface FieldRange {
  start: number;
  end: number;
  text: string;
}

interface LogFieldSpans {
  tagStart: number;
  tagEnd: number;
  messageStart: number;
  messageEnd: number;
}

function spansFromThreadtimeMatch(line: string, thread: RegExpExecArray): LogFieldSpans | undefined {
  const tag = thread[5];
  const message = thread[6];
  const matchEnd = thread.index + thread[0].length;
  const tagEnd = matchEnd - message.length - 2;
  const tagStart = tagEnd - tag.length;
  if (tagStart < 0 || line.slice(tagStart, tagEnd) !== tag) {
    return undefined;
  }
  return {
    tagStart,
    tagEnd,
    messageStart: tagEnd + 2,
    messageEnd: matchEnd,
  };
}

function spansFromTimeMatch(line: string, timeFmt: RegExpExecArray): LogFieldSpans | undefined {
  const tag = timeFmt[3];
  const message = timeFmt[5];
  const levelSlash = `${timeFmt[2]}/`;
  const slashPos = line.indexOf(levelSlash, timeFmt.index);
  if (slashPos < 0) {
    return undefined;
  }
  const tagStart = slashPos + levelSlash.length;
  const tagEnd = tagStart + tag.length;
  if (line.slice(tagStart, tagEnd) !== tag) {
    return undefined;
  }
  const matchEnd = timeFmt.index + timeFmt[0].length;
  const messageStart = matchEnd - message.length;
  return {
    tagStart,
    tagEnd,
    messageStart,
    messageEnd: matchEnd,
  };
}

/** Tag span in a parsed logcat line (first line only when text contains continuations). */
export function findTagRangeInLine(line: string): FieldRange | undefined {
  const firstLine = line.split('\n')[0] ?? line;
  const thread = THREADTIME_LINE.exec(firstLine);
  if (thread) {
    const spans = spansFromThreadtimeMatch(firstLine, thread);
    if (!spans) {
      return undefined;
    }
    return { start: spans.tagStart, end: spans.tagEnd, text: thread[5] };
  }

  const timeFmt = TIME_LINE.exec(firstLine);
  if (timeFmt) {
    const spans = spansFromTimeMatch(firstLine, timeFmt);
    if (!spans) {
      return undefined;
    }
    return { start: spans.tagStart, end: spans.tagEnd, text: timeFmt[3] };
  }

  return undefined;
}

/** Message span on the first log line (continuations extend messageEnd on the entry). */
export function findMessageRangeInLine(line: string): FieldRange | undefined {
  const firstLine = line.split('\n')[0] ?? line;
  const thread = THREADTIME_LINE.exec(firstLine);
  if (thread) {
    const spans = spansFromThreadtimeMatch(firstLine, thread);
    if (!spans) {
      return undefined;
    }
    return {
      start: spans.messageStart,
      end: spans.messageEnd,
      text: thread[6],
    };
  }

  const timeFmt = TIME_LINE.exec(firstLine);
  if (timeFmt) {
    const spans = spansFromTimeMatch(firstLine, timeFmt);
    if (!spans) {
      return undefined;
    }
    return {
      start: spans.messageStart,
      end: spans.messageEnd,
      text: timeFmt[5],
    };
  }

  return undefined;
}

const THREADTIME_HEURISTIC = /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s+\d+/;

type RawEntry = Omit<LogEntry, 'id' | 'parsedTime'>;

export interface LogParseAccumulator {
  rawEntries: RawEntry[];
  timestamps: string[];
  format: ParseResult['format'];
}

export function createParseAccumulator(): LogParseAccumulator {
  return { rawEntries: [], timestamps: [], format: 'unknown' };
}

export function isLogcatLine(line: string): boolean {
  return THREADTIME_LINE.test(line) || TIME_LINE.test(line);
}

export function isLogcatDocumentContent(text: string): boolean {
  const lines = text.split('\n').slice(0, LOGCAT_DETECT_SAMPLE_LINES);
  for (const line of lines) {
    if (THREADTIME_HEURISTIC.test(line)) {
      return true;
    }
  }
  return false;
}

function parseLine(
  acc: LogParseAccumulator,
  line: string,
  lineNumber: number,
  sourceUri?: string,
): void {
  const thread = THREADTIME_LINE.exec(line);
  if (thread) {
    acc.format = acc.format === 'time' ? 'mixed' : acc.format === 'unknown' ? 'threadtime' : acc.format;
    acc.timestamps.push(thread[1]);
    const spans = spansFromThreadtimeMatch(line, thread);
    acc.rawEntries.push({
      timestamp: thread[1],
      pid: parseInt(thread[2], 10),
      tid: parseInt(thread[3], 10),
      level: thread[4],
      tag: thread[5],
      message: thread[6],
      rawLine: line,
      fullText: line,
      lineNumber,
      sourceUri,
      tagStart: spans?.tagStart,
      tagEnd: spans?.tagEnd,
      messageStart: spans?.messageStart,
      messageEnd: spans?.messageEnd,
    });
    return;
  }

  const timeFmt = TIME_LINE.exec(line);
  if (timeFmt) {
    acc.format = acc.format === 'threadtime' ? 'mixed' : acc.format === 'unknown' ? 'time' : acc.format;
    acc.timestamps.push(timeFmt[1]);
    const spans = spansFromTimeMatch(line, timeFmt);
    acc.rawEntries.push({
      timestamp: timeFmt[1],
      level: timeFmt[2],
      tag: timeFmt[3],
      pid: parseInt(timeFmt[4], 10),
      message: timeFmt[5],
      rawLine: line,
      fullText: line,
      lineNumber,
      sourceUri,
      tagStart: spans?.tagStart,
      tagEnd: spans?.tagEnd,
      messageStart: spans?.messageStart,
      messageEnd: spans?.messageEnd,
    });
    return;
  }

  if (acc.rawEntries.length > 0) {
    const last = acc.rawEntries[acc.rawEntries.length - 1];
    if (sourceUri && last.sourceUri && last.sourceUri !== sourceUri) {
      return;
    }
    last.message += '\n' + line;
    last.fullText += '\n' + line;
    if (last.messageStart !== undefined) {
      last.messageEnd = last.fullText.length;
    }
  }
}

export function parseLogLinesChunk(
  acc: LogParseAccumulator,
  lines: string[],
  lineOffset: number,
  sourceUri?: string,
): void {
  for (let i = 0; i < lines.length; i++) {
    parseLine(acc, lines[i], lineOffset + i, sourceUri);
  }
}

export function materializeRawSlice(
  rawSlice: RawEntry[],
  startId: number,
  baseYear: number,
): LogEntry[] {
  return rawSlice.map((e, i) => ({
    ...e,
    id: startId + i,
    parsedTime: e.timestamp ? parseThreadtimeTimestamp(e.timestamp, baseYear) : undefined,
  }));
}

export function finalizeParseAccumulator(
  acc: LogParseAccumulator,
  fileMtimeMs: number = Date.now(),
): ParseResult {
  const baseYear = inferBaseYear(acc.timestamps, fileMtimeMs);
  let fileMaxTime: number | undefined;
  const entries: LogEntry[] = acc.rawEntries.map((e, idx) => {
    const parsedTime = e.timestamp
      ? parseThreadtimeTimestamp(e.timestamp, baseYear)
      : undefined;
    if (parsedTime !== undefined) {
      fileMaxTime = fileMaxTime === undefined ? parsedTime : Math.max(fileMaxTime, parsedTime);
    }
    return { ...e, id: idx, parsedTime };
  });
  return { entries, fileMaxTime, format: acc.format };
}

export function parseLogDocument(
  lines: string[],
  fileMtimeMs: number = Date.now(),
): ParseResult {
  const acc = createParseAccumulator();
  parseLogLinesChunk(acc, lines, 0);
  return finalizeParseAccumulator(acc, fileMtimeMs);
}

export function parseLogText(text: string, fileMtimeMs?: number): ParseResult {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return parseLogDocument(lines, fileMtimeMs);
}

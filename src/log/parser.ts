import type { LogEntry, ParseResult } from '../types';
import { LOGCAT_DETECT_SAMPLE_LINES } from '../constants';
import { inferBaseYear, parseThreadtimeTimestamp } from './timestamp';

const THREADTIME_LINE =
  /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})(?:\s+[0-9A-Za-z]+)?\s+(\d+)\s+(\d+)\s+([A-Z])\s+(.+?)\s*: (.*)$/;

const TIME_LINE =
  /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+([A-Z])\/(.+?)\(\s*(\d+)\):\s*(.*)$/;

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
    });
    return;
  }

  const timeFmt = TIME_LINE.exec(line);
  if (timeFmt) {
    acc.format = acc.format === 'threadtime' ? 'mixed' : acc.format === 'unknown' ? 'time' : acc.format;
    acc.timestamps.push(timeFmt[1]);
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

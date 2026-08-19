export interface LogEntry {
  id: number;
  timestamp?: string;
  parsedTime?: number;
  pid?: number;
  tid?: number;
  level?: string;
  tag?: string;
  process?: string;
  message: string;
  rawLine: string;
  fullText: string;
  lineNumber: number;
}

export interface ParseResult {
  entries: LogEntry[];
  /** Total log entries when `entries` is omitted or filtered subset. */
  totalEntries?: number;
  fileMaxTime?: number;
  format: 'threadtime' | 'time' | 'mixed' | 'unknown';
  tags?: string[];
  filterWarnings?: string[];
}

export type ParseState = 'idle' | 'parsing' | 'ready' | 'error';

export interface FilterStats {
  total: number;
  matched: number;
}

export interface SerializedLogEntry {
  id: number;
  fullText: string;
  lineNumber: number;
}

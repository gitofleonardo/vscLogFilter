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
  fileMaxTime?: number;
  format: 'threadtime' | 'time' | 'mixed' | 'unknown';
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

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
  /** Source document URI when indexing multiple files in one panel. */
  sourceUri?: string;
  /** Inclusive start index of tag within fullText (first log line). */
  tagStart?: number;
  /** Exclusive end index of tag within fullText. */
  tagEnd?: number;
  /** Inclusive start index of message within fullText (includes continuations). */
  messageStart?: number;
  /** Exclusive end index of message within fullText. */
  messageEnd?: number;
}

export interface ParseResult {
  entries: LogEntry[];
  /** Total log entries when `entries` is omitted or filtered subset. */
  totalEntries?: number;
  /** True match count (same as matched index list length after filter). */
  matchedCount?: number;
  /** Compact rows from filter (preferred over full LogEntry clones). */
  rows?: SerializedLogEntry[];
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
  sourceUri?: string;
  fileName?: string;
  /** Parsed tag text; used for field-aware row highlighting. */
  tag?: string;
  /** Inclusive start index of tag within fullText. */
  tagStart?: number;
  /** Exclusive end index of tag within fullText. */
  tagEnd?: number;
  /** Inclusive start index of message within fullText. */
  messageStart?: number;
  /** Exclusive end index of message within fullText. */
  messageEnd?: number;
}

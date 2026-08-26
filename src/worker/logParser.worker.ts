import { parentPort } from 'worker_threads';
import {
  createParseAccumulator,
  finalizeParseAccumulator,
  parseLogLinesChunk,
  type LogParseAccumulator,
} from '../log/parser';
import { parseQuery } from '../query/parser';
import { buildFilterContext, evaluateFilter } from '../query/evaluator';
import type { LogEntry, ParseResult, SerializedLogEntry } from '../types';
import { MAX_FIND_MATCHES, TAG_SUGGESTION_LIMIT, FILTER_PROGRESS_CHECK_EVERY } from '../constants';
import { shortFileNameFromUriString } from '../uriUtils';
import { shouldEmitFilterProgress } from './filterProgress';

interface ParseAccumulatorState {
  acc: LogParseAccumulator;
  fileMtimeMs: number;
  version: number;
}

interface FilterMeta {
  entries: [];
  totalEntries: number;
  matchedCount: number;
  maxLineNumber: number;
  fileMaxTime?: number;
  format: ParseResult['format'];
  filterWarnings?: string[];
}

let accumulating: ParseAccumulatorState | null = null;
let parsedResult: ParseResult | null = null;
/** Indices into parsedResult.entries for the latest filter. */
let matchedIndices: number[] = [];

function collectTags(entries: ParseResult['entries']): string[] {
  const tagSet = new Set<string>();
  for (const e of entries) {
    if (e.tag) {
      tagSet.add(e.tag);
    }
  }
  return [...tagSet].sort().slice(0, TAG_SUGGESTION_LIMIT);
}

function buildMeta(full: ParseResult) {
  return {
    totalEntries: full.entries.length,
    fileMaxTime: full.fileMaxTime,
    format: full.format,
    tags: collectTags(full.entries),
  };
}

function toSerializedRow(entry: LogEntry, displayId: number): SerializedLogEntry {
  return {
    id: displayId,
    fullText: entry.fullText,
    lineNumber: entry.lineNumber,
    sourceUri: entry.sourceUri,
    fileName: entry.sourceUri ? shortFileNameFromUriString(entry.sourceUri) : undefined,
    tag: entry.tag,
    tagStart: entry.tagStart,
    tagEnd: entry.tagEnd,
    messageStart: entry.messageStart,
    messageEnd: entry.messageEnd,
  };
}

/**
 * Build matched index list only — no fullText payload on the filter path.
 */
function filterParsed(query: string, full: ParseResult, version: number): FilterMeta {
  matchedIndices = [];
  if (!query.trim()) {
    return {
      entries: [],
      totalEntries: full.entries.length,
      matchedCount: 0,
      maxLineNumber: 1,
      fileMaxTime: full.fileMaxTime,
      format: full.format,
    };
  }
  const { ast, warnings } = parseQuery(query);
  const ctx = buildFilterContext(full.entries, full.fileMaxTime);
  let maxLineNumber = 1;
  const total = full.entries.length;
  let lastEmitMs = Date.now();

  for (let i = 0; i < total; i++) {
    const entry = full.entries[i];
    if (evaluateFilter(ast, entry, ctx)) {
      matchedIndices.push(i);
      maxLineNumber = Math.max(maxLineNumber, entry.lineNumber + 1);
    }
    if ((i + 1) % FILTER_PROGRESS_CHECK_EVERY === 0) {
      const now = Date.now();
      if (shouldEmitFilterProgress(i, now, lastEmitMs)) {
        lastEmitMs = now;
        parentPort?.postMessage({
          type: 'filterProgress',
          version,
          processed: i + 1,
          total,
        });
      }
    }
  }

  return {
    entries: [],
    totalEntries: full.entries.length,
    matchedCount: matchedIndices.length,
    maxLineNumber,
    fileMaxTime: full.fileMaxTime,
    format: full.format,
    filterWarnings: warnings,
  };
}

function getRows(start: number, end: number): SerializedLogEntry[] {
  if (!parsedResult) {
    return [];
  }
  const lo = Math.max(0, Math.floor(start));
  const hi = Math.min(matchedIndices.length, Math.floor(end));
  const rows: SerializedLogEntry[] = [];
  for (let displayId = lo; displayId < hi; displayId++) {
    const entryIndex = matchedIndices[displayId];
    const entry = parsedResult.entries[entryIndex];
    if (entry) {
      rows.push(toSerializedRow(entry, displayId));
    }
  }
  return rows;
}

function findInMatches(needle: string): Array<{ rowIndex: number; start: number; end: number }> {
  if (!parsedResult || !needle) {
    return [];
  }
  const lower = needle.toLowerCase();
  const matches: Array<{ rowIndex: number; start: number; end: number }> = [];
  for (let rowIndex = 0; rowIndex < matchedIndices.length; rowIndex++) {
    const entry = parsedResult.entries[matchedIndices[rowIndex]];
    if (!entry) {
      continue;
    }
    const hay = entry.fullText.toLowerCase();
    let idx = 0;
    while (idx < hay.length) {
      const found = hay.indexOf(lower, idx);
      if (found === -1) {
        break;
      }
      matches.push({ rowIndex, start: found, end: found + needle.length });
      if (matches.length >= MAX_FIND_MATCHES) {
        return matches;
      }
      idx = found + 1;
    }
  }
  return matches;
}

parentPort?.on('message', (msg: {
  type: string;
  lines?: string[];
  lineOffset?: number;
  fileMtimeMs?: number;
  version?: number;
  query?: string;
  sourceUri?: string;
  start?: number;
  end?: number;
  requestId?: number;
  needle?: string;
}) => {
  try {
    switch (msg.type) {
      case 'init':
        accumulating = {
          acc: createParseAccumulator(),
          fileMtimeMs: msg.fileMtimeMs ?? Date.now(),
          version: msg.version ?? 0,
        };
        parsedResult = null;
        matchedIndices = [];
        parentPort?.postMessage({ type: 'ready', version: accumulating.version });
        break;
      case 'chunk': {
        if (!accumulating || msg.version !== accumulating.version) {
          parentPort?.postMessage({ type: 'chunkAck', stale: true });
          return;
        }
        parseLogLinesChunk(
          accumulating.acc,
          msg.lines ?? [],
          msg.lineOffset ?? 0,
          msg.sourceUri,
        );
        const linesProcessed = (msg.lineOffset ?? 0) + (msg.lines?.length ?? 0);
        parentPort?.postMessage({
          type: 'progress',
          version: accumulating.version,
          linesProcessed,
          entryCount: accumulating.acc.rawEntries.length,
        });
        parentPort?.postMessage({ type: 'chunkAck', version: accumulating.version });
        break;
      }
      case 'finish': {
        if (!accumulating || msg.version !== accumulating.version) {
          parentPort?.postMessage({ type: 'cancelled', version: msg.version });
          return;
        }
        parsedResult = finalizeParseAccumulator(accumulating.acc, accumulating.fileMtimeMs);
        matchedIndices = [];
        accumulating = null;
        const version = msg.version ?? 0;
        parentPort?.postMessage({
          type: 'parsed',
          meta: buildMeta(parsedResult),
          version,
        });
        break;
      }
      case 'filter': {
        if (!parsedResult) {
          parentPort?.postMessage({ type: 'error', error: 'Log index not ready' });
          return;
        }
        const version = msg.version ?? 0;
        const result = filterParsed(msg.query ?? '', parsedResult, version);
        parentPort?.postMessage({ type: 'filtered', result, version });
        break;
      }
      case 'getRows': {
        const requestId = msg.requestId ?? 0;
        const rows = getRows(msg.start ?? 0, msg.end ?? 0);
        parentPort?.postMessage({
          type: 'rows',
          requestId,
          start: msg.start ?? 0,
          end: msg.end ?? 0,
          rows,
        });
        break;
      }
      case 'findInResults': {
        const requestId = msg.requestId ?? 0;
        const matches = findInMatches(msg.needle ?? '');
        parentPort?.postMessage({
          type: 'findMatches',
          requestId,
          matches,
          capped: matches.length >= MAX_FIND_MATCHES,
        });
        break;
      }
      case 'cancel':
        accumulating = null;
        parsedResult = null;
        matchedIndices = [];
        parentPort?.postMessage({ type: 'cancelled', version: msg.version });
        break;
    }
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) });
  }
});

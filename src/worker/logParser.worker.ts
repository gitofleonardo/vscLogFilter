import { parentPort } from 'worker_threads';
import {
  createParseAccumulator,
  finalizeParseAccumulator,
  parseLogLinesChunk,
  type LogParseAccumulator,
} from '../log/parser';
import { parseQuery } from '../query/parser';
import { buildFilterContext, filterEntries } from '../query/evaluator';
import type { ParseResult } from '../types';
import { TAG_SUGGESTION_LIMIT } from '../constants';

interface ParseAccumulatorState {
  acc: LogParseAccumulator;
  fileMtimeMs: number;
  version: number;
}

let accumulating: ParseAccumulatorState | null = null;
let parsedResult: ParseResult | null = null;

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

function filterParsed(query: string, full: ParseResult): ParseResult {
  if (!query.trim()) {
    return {
      entries: [],
      totalEntries: full.entries.length,
      fileMaxTime: full.fileMaxTime,
      format: full.format,
    };
  }
  const { ast, warnings } = parseQuery(query);
  const ctx = buildFilterContext(full.entries, full.fileMaxTime);
  const matched = filterEntries(full.entries, ast, ctx).map((e, i) => ({
    ...e,
    id: i,
  }));
  return {
    entries: matched,
    totalEntries: full.entries.length,
    fileMaxTime: full.fileMaxTime,
    format: full.format,
    filterWarnings: warnings,
  };
}

parentPort?.on('message', (msg: {
  type: string;
  lines?: string[];
  lineOffset?: number;
  fileMtimeMs?: number;
  version?: number;
  query?: string;
  sourceUri?: string;
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
        const result = filterParsed(msg.query ?? '', parsedResult);
        parentPort?.postMessage({ type: 'filtered', result, version });
        break;
      }
      case 'cancel':
        accumulating = null;
        parsedResult = null;
        parentPort?.postMessage({ type: 'cancelled', version: msg.version });
        break;
    }
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) });
  }
});

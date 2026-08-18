import type { LogEntry } from '../types';
import { levelEquals, levelMeetsMinimum } from '../log/level';
import { parseAgeDuration, parseTimeQuery } from '../log/timestamp';
import type { FilterContext, FilterNode, KeyFilterNode } from './ast';

const CRASH_PATTERNS = [
  /FATAL EXCEPTION/,
  /AndroidRuntime.*FATAL/,
  /Process: .* has died/,
  /Force finishing activity/,
];

const STACKTRACE_PATTERNS = [
  /^\s+at [\w.$]+\([\w.]+:\d+\)/m,
  /^\s+at [\w.$]+\([\w.]+\)/m,
  /Caused by:/,
];

const FIREBASE_PATTERNS = [/FirebaseApp/, /FirebaseCrashlytics/, /FirebaseAnalytics/];

export function evaluateFilter(
  node: FilterNode | null,
  entry: LogEntry,
  ctx: FilterContext,
): boolean {
  if (!node) {
    return true;
  }
  switch (node.kind) {
    case 'phrase':
      return entry.fullText.toLowerCase().includes(node.text.toLowerCase());
    case 'and':
      return node.children.every((c) => evaluateFilter(c, entry, ctx));
    case 'or':
      return node.children.some((c) => evaluateFilter(c, entry, ctx));
    case 'key':
      return evaluateKeyFilter(node, entry, ctx);
    default:
      return true;
  }
}

function evaluateKeyFilter(node: KeyFilterNode, entry: LogEntry, ctx: FilterContext): boolean {
  if (node.field === 'name') {
    return true;
  }

  let matched = false;
  switch (node.field) {
    case 'tag':
      matched = matchStringField(entry.tag ?? '', node);
      break;
    case 'message':
      matched = matchStringField(entry.message, node);
      break;
    case 'line':
      matched = matchStringField(entry.fullText, node);
      break;
    case 'level':
      matched = levelMeetsMinimum(entry.level, node.value);
      break;
    case 'process':
      matched = matchContains(entry.process ?? entry.tag ?? '', node.value);
      break;
    case 'pid':
      matched = matchPid(entry.pid, node);
      break;
    case 'age':
      matched = matchAge(entry, node.value, ctx);
      break;
    case 'after':
      matched = matchAfter(entry, node.value, ctx);
      break;
    case 'before':
      matched = matchBefore(entry, node.value, ctx);
      break;
    case 'is':
      matched = matchIsFilter(entry, node.value);
      break;
    default:
      matched = true;
  }

  return node.negated ? !matched : matched;
}

function matchStringField(value: string, node: KeyFilterNode): boolean {
  if (node.mode === 'exact') {
    return value === node.value;
  }
  return matchContains(value, node.value);
}

function matchContains(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}

function matchPid(pid: number | undefined, node: KeyFilterNode): boolean {
  if (pid === undefined) {
    return false;
  }
  const value = node.value.trim();
  if (!/^\d+$/.test(value)) {
    return false;
  }
  const n = Number(value);
  if (node.mode === 'exact') {
    return pid === n;
  }
  return String(pid).startsWith(value);
}

function matchAge(entry: LogEntry, value: string, ctx: FilterContext): boolean {
  if (entry.parsedTime === undefined || ctx.fileMaxTime === undefined) {
    return false;
  }
  const duration = parseAgeDuration(value);
  if (duration === undefined) {
    return false;
  }
  return entry.parsedTime >= ctx.fileMaxTime - duration;
}

function matchAfter(entry: LogEntry, value: string, ctx: FilterContext): boolean {
  if (entry.parsedTime === undefined) {
    return false;
  }
  const bound = parseTimeQuery(value, ctx.baseYear, entry.parsedTime);
  if (bound === undefined) {
    return false;
  }
  return entry.parsedTime >= bound;
}

function matchBefore(entry: LogEntry, value: string, ctx: FilterContext): boolean {
  if (entry.parsedTime === undefined) {
    return false;
  }
  const bound = parseTimeQuery(value, ctx.baseYear, entry.parsedTime);
  if (bound === undefined) {
    return false;
  }
  return entry.parsedTime <= bound;
}

function matchIsFilter(entry: LogEntry, value: string): boolean {
  const v = value.toLowerCase();
  if (v === 'crash') {
    return CRASH_PATTERNS.some((p) => p.test(entry.fullText));
  }
  if (v === 'stacktrace') {
    return STACKTRACE_PATTERNS.some((p) => p.test(entry.fullText));
  }
  if (v === 'firebase') {
    return FIREBASE_PATTERNS.some((p) => p.test(entry.fullText));
  }
  if (['verbose', 'debug', 'info', 'warn', 'warning', 'error', 'fatal', 'assert'].includes(v)) {
    return levelEquals(entry.level, v);
  }
  if (['v', 'd', 'i', 'w', 'e', 'f', 'a'].includes(v)) {
    return levelEquals(entry.level, v);
  }
  return false;
}

export function filterEntries(
  entries: LogEntry[],
  ast: FilterNode | null,
  ctx: FilterContext,
): LogEntry[] {
  if (!ast) {
    return entries;
  }
  return entries.filter((e) => evaluateFilter(ast, e, ctx));
}

export function buildFilterContext(entries: LogEntry[], fileMaxTime?: number): FilterContext {
  let max = fileMaxTime;
  if (max === undefined) {
    for (const e of entries) {
      if (e.parsedTime !== undefined) {
        max = max === undefined ? e.parsedTime : Math.max(max, e.parsedTime);
      }
    }
  }
  const baseYear = new Date(max ?? Date.now()).getFullYear();
  return { fileMaxTime: max, baseYear };
}

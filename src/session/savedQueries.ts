import * as vscode from 'vscode';
import { MAX_SAVED_QUERIES, SAVED_QUERIES_KEY } from '../constants';

export function normalizeSavedQuery(query: string): string {
  return query.trim();
}

export function parseSavedQueries(raw: unknown, max = MAX_SAVED_QUERIES): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const query = normalizeSavedQuery(item);
    if (!query || seen.has(query)) {
      continue;
    }
    seen.add(query);
    out.push(query);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

export function addSavedQuery(list: string[], query: string, max = MAX_SAVED_QUERIES): string[] {
  const normalized = normalizeSavedQuery(query);
  if (!normalized) {
    return list.slice(0, max);
  }
  return [normalized, ...list.filter((item) => item !== normalized)].slice(0, max);
}

export function removeSavedQuery(list: string[], query: string): string[] {
  const normalized = normalizeSavedQuery(query);
  return list.filter((item) => item !== normalized);
}

export function filterSavedQueries(list: string[], needle: string): string[] {
  const n = needle.trim().toLowerCase();
  if (!n) {
    return list.slice();
  }
  return list.filter((item) => item.toLowerCase().includes(n));
}

export type SavedQueriesAccess = {
  list: () => string[];
  add: (query: string) => string[];
  remove: (query: string) => string[];
};

export class SavedQueriesStore implements SavedQueriesAccess {
  constructor(private readonly context: vscode.ExtensionContext) {
    this.context.globalState.setKeysForSync([SAVED_QUERIES_KEY]);
  }

  list(): string[] {
    return parseSavedQueries(this.context.globalState.get(SAVED_QUERIES_KEY));
  }

  add(query: string): string[] {
    const next = addSavedQuery(this.list(), query);
    void this.context.globalState.update(SAVED_QUERIES_KEY, next);
    return next;
  }

  remove(query: string): string[] {
    const next = removeSavedQuery(this.list(), query);
    void this.context.globalState.update(SAVED_QUERIES_KEY, next);
    return next;
  }
}

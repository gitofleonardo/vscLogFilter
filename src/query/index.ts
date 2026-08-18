export { parseQuery } from './parser';
export * from './extensions';
export { tokenize } from './lexer';
export { evaluateFilter, filterEntries, buildFilterContext } from './evaluator';
export {
  extractHighlightTerms,
  tokenizeQueryForDisplay,
  renderQueryHighlightHtml,
} from './highlights';
export type { HighlightTerm, QueryTokenSpan } from './highlights';
export type { FilterNode, ParseQueryResult, FilterContext } from './ast';

import type { LogEntry } from '../types';
import { parseQuery } from './parser';
import { buildFilterContext, filterEntries } from './evaluator';

export interface FilterResult {
  matched: LogEntry[];
  warnings: string[];
}

export function parseAndFilter(
  query: string,
  entries: LogEntry[],
  fileMaxTime?: number,
): FilterResult {
  const { ast, warnings } = parseQuery(query);
  const ctx = buildFilterContext(entries, fileMaxTime);
  const matched = filterEntries(entries, ast, ctx);
  return { matched, warnings };
}

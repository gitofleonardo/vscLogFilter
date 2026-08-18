import type { FieldKey, FilterNode } from './ast';
import { parseQuery } from './parser';
import { keyFieldFromRawKey, readKeyValueText } from './lexer';

export interface HighlightTerm {
  text: string;
  field: 'tag' | 'message' | 'line' | 'pid' | 'any';
  exact?: boolean;
}

const FIELD_MAP: Partial<Record<FieldKey, HighlightTerm['field']>> = {
  tag: 'tag',
  message: 'message',
  line: 'line',
  pid: 'pid',
  process: 'tag',
};

export function extractHighlightTerms(query: string): HighlightTerm[] {
  const { ast } = parseQuery(query);
  if (!ast) {
    return [];
  }
  const raw: HighlightTerm[] = [];
  collectTerms(ast, raw);
  return dedupeTerms(raw);
}

function collectTerms(node: FilterNode, out: HighlightTerm[]): void {
  switch (node.kind) {
    case 'phrase':
      if (node.text.trim()) {
        out.push({ text: node.text.trim(), field: 'any' });
      }
      break;
    case 'key':
      if (node.negated || !node.value || node.mode === 'regex') {
        break;
      }
      {
        const field = FIELD_MAP[node.field];
        if (field) {
          out.push({
            text: node.value,
            field,
            exact: node.mode === 'exact',
          });
        }
      }
      break;
    case 'and':
    case 'or':
      node.children.forEach((c) => collectTerms(c, out));
      break;
  }
}

function dedupeTerms(terms: HighlightTerm[]): HighlightTerm[] {
  const seen = new Set<string>();
  const result: HighlightTerm[] = [];
  for (const t of terms) {
    const key = `${t.field}\0${t.text}\0${t.exact ?? false}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }
  return result;
}

const KEY_NAMES =
  'tag|message|line|level|age|is|name|process|pid|after|before|package';

const KEY_PATTERN = new RegExp(`^-?(?:${KEY_NAMES})(?:~|=)?:`, 'i');

export interface QueryTokenSpan {
  type: 'key' | 'value' | 'op' | 'paren' | 'phrase' | 'space' | 'quote';
  text: string;
  negated?: boolean;
}

export function tokenizeQueryForDisplay(input: string): QueryTokenSpan[] {
  const spans: QueryTokenSpan[] = [];
  let i = 0;

  const KEY_NAMES =
    'tag|message|line|level|age|is|name|process|pid|after|before|package';
  const KEY_PATTERN = new RegExp(`^-?(?:${KEY_NAMES})(?:~|=)?:`, 'i');

  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      let j = i;
      while (j < input.length && /\s/.test(input[j])) {
        j++;
      }
      spans.push({ type: 'space', text: input.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '&' || ch === '|') {
      spans.push({ type: 'op', text: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      spans.push({ type: 'paren', text: ch });
      i++;
      continue;
    }

    const keyMatch = input.slice(i).match(new RegExp(`^(${KEY_PATTERN.source})`, 'i'));
    if (keyMatch) {
      const rawKey = keyMatch[1];
      const negated = rawKey.startsWith('-');
      i += rawKey.length;
      const field = keyFieldFromRawKey(rawKey);
      const value = readKeyValueText(input, i, field);
      spans.push({ type: 'key', text: rawKey, negated });
      i = value.end;
      if (value.text) {
        spans.push({ type: 'value', text: value.text, negated });
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quoted = readDisplayQuoted(input, i);
      spans.push({ type: 'quote', text: quoted.text });
      i = quoted.end;
      continue;
    }

    const word = readDisplayWord(input, i, KEY_PATTERN);
    spans.push({ type: 'phrase', text: word.text });
    i = word.end;
  }

  return spans;
}

function readDisplayValue(input: string, start: number, field?: string): { text: string; end: number } {
  return readKeyValueText(input, start, field);
}

function readDisplayQuoted(input: string, start: number): { text: string; end: number } {
  const quote = input[start];
  let i = start + 1;
  let text = quote;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      text += input.slice(i, i + 2);
      i += 2;
      continue;
    }
    text += ch;
    i++;
    if (ch === quote) {
      break;
    }
  }
  return { text, end: i };
}

function readDisplayWord(
  input: string,
  start: number,
  keyPattern: RegExp,
): { text: string; end: number } {
  let i = start;
  let text = '';
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch) || ch === '&' || ch === '|' || ch === '(' || ch === ')') {
      break;
    }
    if (ch === '\\' && i + 1 < input.length) {
      text += input.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (keyPattern.test(input.slice(i))) {
      break;
    }
    text += ch;
    i++;
  }
  return { text, end: i };
}

export function renderQueryHighlightHtml(query: string): string {
  const spans = tokenizeQueryForDisplay(query);
  let html = '';
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.type === 'key') {
      const next = spans[i + 1];
      const chipClass = span.negated ? 'hl-chip hl-chip-neg' : 'hl-chip';
      let inner = span.negated
        ? '-' + escapeHtml(span.text.slice(1))
        : escapeHtml(span.text);
      if (next && (next.type === 'value' || next.type === 'quote')) {
        inner += escapeHtml(next.text);
        i++;
      }
      html += `<span class="${chipClass}">${inner}</span>`;
      continue;
    }
    const escaped = escapeHtml(span.text);
    switch (span.type) {
      case 'op':
      case 'paren':
        html += `<span class="hl-${span.type}">${escaped}</span>`;
        break;
      case 'phrase':
      case 'quote':
        html += `<span class="hl-phrase">${escaped}</span>`;
        break;
      default:
        html += escaped;
    }
  }
  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

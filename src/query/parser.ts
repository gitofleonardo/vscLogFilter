import type { FieldKey, FilterNode, KeyFilterNode, ParseQueryResult } from './ast';
import { tokenize, type Token } from './lexer';

export function parseQuery(input: string): ParseQueryResult {
  const warnings: string[] = [];
  const trimmed = input.trim();
  if (!trimmed) {
    return { ast: null, warnings };
  }

  try {
    const tokens = tokenize(trimmed);
    const { node, index } = parseTopLevel(tokens, 0, warnings);
    const end = skipTrailingOperators(tokens, index);
    if (end !== tokens.length - 1) {
      throw new Error('Unexpected tokens');
    }
    const top = normalizeTopLevel(node);
    return { ast: top, warnings };
  } catch {
    return {
      ast: { kind: 'phrase', text: trimmed },
      warnings,
      fallbackLineSearch: trimmed,
    };
  }
}

function skipTrailingOperators(tokens: Token[], start: number): number {
  let index = start;
  while (tokens[index]?.type === 'OR' || tokens[index]?.type === 'AND') {
    index++;
  }
  return index;
}

/** AS-style: root is a list of space-separated expressions; combine with same-key OR then AND. */
function parseTopLevel(
  tokens: Token[],
  start: number,
  warnings: string[],
): { node: FilterNode; index: number } {
  const exprs: FilterNode[] = [];
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || token.type === 'EOF' || token.type === 'RPAREN') {
      break;
    }

    if (token.type === 'OR' || token.type === 'AND') {
      index++;
      continue;
    }

    if (!isPrimaryStart(token)) {
      break;
    }

    const next = parseOrExpr(tokens, index, warnings);
    exprs.push(next.node);
    index = next.index;
  }

  if (exprs.length === 0) {
    throw new Error('Empty query');
  }

  return { node: combineNodes('and', exprs)!, index };
}

function combineNodes(kind: 'and' | 'or', nodes: FilterNode[]): FilterNode | null {
  const flat =
    kind === 'and'
      ? nodes.flatMap((node) => (node.kind === 'and' ? node.children : [node]))
      : nodes.flatMap((node) => (node.kind === 'or' ? node.children : [node]));

  if (flat.length === 0) {
    return null;
  }
  if (flat.length === 1) {
    return flat[0];
  }
  return { kind, children: flat };
}

function parseOrExpr(tokens: Token[], start: number, warnings: string[]): { node: FilterNode; index: number } {
  let { node, index } = parseAndExpr(tokens, start, warnings);
  const parts: FilterNode[] = [node];
  while (tokens[index]?.type === 'OR') {
    const nextToken = tokens[index + 1];
    if (!nextToken || nextToken.type === 'EOF' || !isPrimaryStart(nextToken)) {
      break;
    }
    index++;
    const next = parseAndExpr(tokens, index, warnings);
    parts.push(next.node);
    index = next.index;
  }
  if (parts.length === 1) {
    return { node: parts[0], index };
  }
  return { node: { kind: 'or', children: parts }, index };
}

/** Explicit `&` only — juxtaposition is a new top-level expression (AS-compatible). */
function parseAndExpr(tokens: Token[], start: number, warnings: string[]): { node: FilterNode; index: number } {
  let { node, index } = parsePrimary(tokens, start, warnings);
  const parts: FilterNode[] = [node];
  while (tokens[index]?.type === 'AND') {
    const nextToken = tokens[index + 1];
    if (!nextToken || nextToken.type === 'EOF' || !isPrimaryStart(nextToken)) {
      break;
    }
    index++;
    const next = parsePrimary(tokens, index, warnings);
    parts.push(next.node);
    index = next.index;
  }
  if (parts.length === 1) {
    return { node: parts[0], index };
  }
  return { node: { kind: 'and', children: parts }, index };
}

function isPrimaryStart(token: Token): boolean {
  return token.type === 'LPAREN' || token.type === 'KEY' || token.type === 'WORD';
}

function parsePrimary(tokens: Token[], start: number, warnings: string[]): { node: FilterNode; index: number } {
  const t = tokens[start];
  if (!t) {
    throw new Error('Unexpected end');
  }
  if (t.type === 'LPAREN') {
    const inner = parseOrExpr(tokens, start + 1, warnings);
    if (tokens[inner.index]?.type !== 'RPAREN') {
      throw new Error('Missing )');
    }
    return { node: inner.node, index: inner.index + 1 };
  }
  if (t.type === 'KEY') {
    return { node: keyTokenToNode(t, warnings), index: start + 1 };
  }
  if (t.type === 'WORD') {
    return { node: { kind: 'phrase', text: t.value }, index: start + 1 };
  }
  throw new Error(`Unexpected token ${t.type}`);
}

function keyTokenToNode(t: Token, warnings: string[]): KeyFilterNode {
  const field = (t.field ?? 'line') as FieldKey;
  const mode = t.mode ?? 'contains';
  if (mode === 'regex') {
    warnings.push(`Regex filter (${field}~) is not supported; term ignored.`);
    return {
      kind: 'key',
      field: 'line',
      value: '',
      negated: false,
      mode: 'contains',
    };
  }
  if (field === 'package') {
    warnings.push('package: is not supported for offline logs; use pid: instead.');
    return {
      kind: 'key',
      field: 'line',
      value: '',
      negated: false,
      mode: 'contains',
    };
  }
  return {
    kind: 'key',
    field,
    value: t.keyValue ?? '',
    negated: t.negated ?? false,
    mode,
  };
}

function normalizeTopLevel(node: FilterNode): FilterNode {
  const flat = flattenTopLevelNodes(node);
  if (flat.length <= 1) {
    return node;
  }

  const phrases: string[] = [];
  const others: FilterNode[] = [];
  for (const n of flat) {
    if (n.kind === 'phrase') {
      phrases.push(n.text);
    } else {
      others.push(n);
    }
  }

  const groups: FilterNode[] = [];
  for (const text of phrases) {
    groups.push({ kind: 'phrase', text });
  }

  const buckets = new Map<string, KeyFilterNode[]>();
  let uniqueIdx = 0;
  for (const n of others) {
    if (n.kind !== 'key') {
      groups.push(n);
      continue;
    }
    const bucketKey = groupKeyFor(n, uniqueIdx++);
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(n);
  }

  for (const [, nodes] of buckets) {
    if (nodes.length === 1) {
      groups.push(nodes[0]);
    } else if (nodes.every((n) => !n.negated && sameOrGroupField(n.field))) {
      groups.push({ kind: 'or', children: nodes });
    } else {
      groups.push({ kind: 'and', children: nodes });
    }
  }

  if (groups.length === 1) {
    return groups[0];
  }
  return { kind: 'and', children: groups };
}

function sameOrGroupField(field: FieldKey): boolean {
  return (
    field === 'tag' ||
    field === 'message' ||
    field === 'line' ||
    field === 'level' ||
    field === 'age' ||
    field === 'pid' ||
    field === 'process'
  );
}

function groupKeyFor(n: KeyFilterNode, idx: number): string {
  if (n.negated) {
    return `u${idx}`;
  }
  if (n.field === 'is' || n.field === 'name' || n.field === 'after' || n.field === 'before') {
    return `u${idx}`;
  }
  if (sameOrGroupField(n.field)) {
    return n.field;
  }
  return `u${idx}`;
}

function flattenTopLevelNodes(node: FilterNode): FilterNode[] {
  if (node.kind === 'and') {
    return node.children.flatMap(flattenTopLevelNodes);
  }
  return [node];
}

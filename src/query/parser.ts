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
    const { node, index } = parseAsLogcatTopLevel(tokens, 0, warnings);
    const end = skipTrailingOperators(tokens, index);
    if (end !== tokens.length - 1) {
      throw new Error('Unexpected tokens');
    }
    const top = normalizeTopLevel(node, warnings);
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

function parseAsLogcatTopLevel(
  tokens: Token[],
  start: number,
  warnings: string[],
): { node: FilterNode; index: number } {
  const globalKeys: KeyFilterNode[] = [];
  const textSegments: FilterNode[] = [];
  let segmentParts: FilterNode[] = [];

  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || token.type === 'EOF' || token.type === 'RPAREN') {
      break;
    }

    if (token.type === 'OR') {
      if (segmentParts.length > 0) {
        textSegments.push(combineNodes('and', segmentParts)!);
        segmentParts = [];
      }
      index++;
      continue;
    }

    if (token.type === 'AND') {
      index++;
      continue;
    }

    if (token.type === 'LPAREN') {
      const inner = parseOrExpr(tokens, index + 1, warnings);
      if (tokens[inner.index]?.type !== 'RPAREN') {
        throw new Error('Missing )');
      }
      segmentParts.push(inner.node);
      index = inner.index + 1;
      continue;
    }

    if (token.type === 'KEY') {
      globalKeys.push(keyTokenToNode(token, warnings));
      index++;
      continue;
    }

    if (token.type === 'WORD') {
      segmentParts.push({ kind: 'phrase', text: token.value });
      index++;
      continue;
    }

    throw new Error(`Unexpected token ${token.type}`);
  }

  if (segmentParts.length > 0) {
    textSegments.push(combineNodes('and', segmentParts)!);
  }

  const parts: FilterNode[] = [];

  if (globalKeys.length > 0) {
    parts.push(...groupGlobalKeys(globalKeys));
  }

  if (textSegments.length === 1) {
    parts.push(textSegments[0]);
  } else if (textSegments.length > 1) {
    parts.push(combineNodes('or', textSegments)!);
  }

  if (parts.length === 0) {
    throw new Error('Empty query');
  }

  return { node: combineNodes('and', parts)!, index };
}

function groupGlobalKeys(keys: KeyFilterNode[]): FilterNode[] {
  const buckets = new Map<string, KeyFilterNode[]>();
  let uniqueIdx = 0;
  for (const key of keys) {
    const bucketKey = groupKeyFor(key, uniqueIdx++);
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(key);
  }

  const groups: FilterNode[] = [];
  for (const [, nodes] of buckets) {
    if (nodes.length === 1) {
      groups.push(nodes[0]);
    } else if (nodes.every((n) => !n.negated && sameOrGroupField(n.field))) {
      groups.push({ kind: 'or', children: nodes });
    } else {
      groups.push(combineNodes('and', nodes)!);
    }
  }
  return groups;
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

function parseAndExpr(tokens: Token[], start: number, warnings: string[]): { node: FilterNode; index: number } {
  let { node, index } = parsePrimary(tokens, start, warnings);
  const parts: FilterNode[] = [node];
  while (
    tokens[index]?.type === 'AND' ||
    (tokens[index]?.type !== 'OR' &&
      tokens[index]?.type !== 'RPAREN' &&
      tokens[index]?.type !== 'EOF' &&
      tokens[index]?.type !== undefined &&
      isPrimaryStart(tokens[index]))
  ) {
    if (tokens[index]?.type === 'AND') {
      const nextToken = tokens[index + 1];
      if (!nextToken || nextToken.type === 'EOF' || !isPrimaryStart(nextToken)) {
        break;
      }
      index++;
    }
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

function normalizeTopLevel(node: FilterNode, _warnings: string[]): FilterNode {
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
  if (n.negated || n.mode === 'exact') {
    return `u${idx}`;
  }
  if (n.field === 'is' || n.field === 'name') {
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

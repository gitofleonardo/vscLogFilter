export type FieldKey =
  | 'tag'
  | 'message'
  | 'line'
  | 'level'
  | 'age'
  | 'is'
  | 'name'
  | 'process'
  | 'pid'
  | 'after'
  | 'before'
  | 'package';

export type MatchMode = 'contains' | 'exact' | 'regex';

export interface KeyFilterNode {
  kind: 'key';
  field: FieldKey;
  value: string;
  negated: boolean;
  mode: MatchMode;
}

export interface PhraseNode {
  kind: 'phrase';
  text: string;
}

export interface AndNode {
  kind: 'and';
  children: FilterNode[];
}

export interface OrNode {
  kind: 'or';
  children: FilterNode[];
}

export type FilterNode = KeyFilterNode | PhraseNode | AndNode | OrNode;

export interface ParseQueryResult {
  ast: FilterNode | null;
  warnings: string[];
  fallbackLineSearch?: string;
}

export interface FilterContext {
  fileMaxTime?: number;
  baseYear: number;
}

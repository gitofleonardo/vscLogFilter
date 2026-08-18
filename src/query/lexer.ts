export type TokenType =
  | 'WORD'
  | 'AND'
  | 'OR'
  | 'LPAREN'
  | 'RPAREN'
  | 'KEY'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  field?: string;
  keyValue?: string;
  negated?: boolean;
  mode?: 'contains' | 'exact' | 'regex';
}

const KEY_NAMES =
  'tag|message|line|level|age|is|name|process|pid|after|before|package';

const KEY_PATTERN = new RegExp(
  `^-?(?:${KEY_NAMES})(?:~|=)?:`,
  'i',
);

const TIME_VALUE_TAIL = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/;

export function keyFieldFromRawKey(rawKey: string): string {
  const withoutNeg = rawKey.startsWith('-') ? rawKey.slice(1) : rawKey;
  let fieldPart = withoutNeg;
  if (withoutNeg.includes('~:')) {
    fieldPart = withoutNeg.replace('~:', ':');
  } else if (withoutNeg.includes('=:')) {
    fieldPart = withoutNeg.replace('=:', ':');
  }
  return fieldPart.slice(0, fieldPart.indexOf(':')).toLowerCase();
}

export function readKeyValueText(
  input: string,
  start: number,
  field?: string,
): { text: string; end: number } {
  if (start >= input.length) {
    return { text: '', end: start };
  }
  const ch = input[start];
  if (ch === '"' || ch === "'") {
    return readQuoted(input, start);
  }
  return readUnquotedValue(input, start, field);
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '&') {
      tokens.push({ type: 'AND', value: '&', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '|') {
      tokens.push({ type: 'OR', value: '|', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', start: i, end: i + 1 });
      i++;
      continue;
    }

    const keyMatch = input.slice(i).match(new RegExp(`^(${KEY_PATTERN.source})`, 'i'));
    if (keyMatch) {
      const rawKey = keyMatch[1];
      const negated = rawKey.startsWith('-');
      const withoutNeg = negated ? rawKey.slice(1) : rawKey;
      let mode: 'contains' | 'exact' | 'regex' = 'contains';
      let fieldPart = withoutNeg;
      if (withoutNeg.includes('~:')) {
        mode = 'regex';
        fieldPart = withoutNeg.replace('~:', ':');
      } else if (withoutNeg.includes('=:')) {
        mode = 'exact';
        fieldPart = withoutNeg.replace('=:', ':');
      }
      const colon = fieldPart.indexOf(':');
      const field = fieldPart.slice(0, colon).toLowerCase();
      i += rawKey.length;
      const value = readKeyValueText(input, i, field);
      i = value.end;
      tokens.push({
        type: 'KEY',
        value: rawKey + value.text,
        start: i - rawKey.length - value.text.length,
        end: i,
        field,
        keyValue: value.text,
        negated,
        mode,
      });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quoted = readQuoted(input, i);
      tokens.push({
        type: 'WORD',
        value: quoted.text,
        start: i,
        end: quoted.end,
      });
      i = quoted.end;
      continue;
    }

    const word = readBareWord(input, i);
    tokens.push({ type: 'WORD', value: word.text, start: i, end: word.end });
    i = word.end;
  }

  tokens.push({ type: 'EOF', value: '', start: i, end: i });
  return tokens;
}

function continuesDatetimeValue(
  field: string | undefined,
  textSoFar: string,
  input: string,
  spaceIndex: number,
): boolean {
  if (field !== 'after' && field !== 'before') {
    return false;
  }
  if (!/^\d{2}-\d{2}$/.test(textSoFar)) {
    return false;
  }
  if (input[spaceIndex] !== ' ') {
    return false;
  }
  return TIME_VALUE_TAIL.test(input.slice(spaceIndex + 1));
}

function readUnquotedValue(
  input: string,
  start: number,
  field?: string,
): { text: string; end: number } {
  let i = start;
  let text = '';
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      if (continuesDatetimeValue(field, text, input, i)) {
        text += ch;
        i++;
        continue;
      }
      break;
    }
    if (ch === '&' || ch === '|' || ch === '(' || ch === ')') {
      break;
    }
    if (ch === '\\' && i + 1 < input.length) {
      text += input[i + 1];
      i += 2;
      continue;
    }
    const rest = input.slice(i);
    if (KEY_PATTERN.test(rest)) {
      break;
    }
    text += ch;
    i++;
  }
  return { text, end: i };
}

function readQuoted(input: string, start: number): { text: string; end: number } {
  const quote = input[start];
  let i = start + 1;
  let text = '';
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      text += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { text, end: i + 1 };
    }
    text += ch;
    i++;
  }
  return { text, end: input.length };
}

function readBareWord(input: string, start: number): { text: string; end: number } {
  let i = start;
  let text = '';
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      break;
    }
    if (ch === '&' || ch === '|' || ch === '(' || ch === ')') {
      break;
    }
    if (ch === '\\' && i + 1 < input.length) {
      text += ' ';
      i += 2;
      continue;
    }
    const rest = input.slice(i);
    if (KEY_PATTERN.test(rest)) {
      break;
    }
    text += ch;
    i++;
  }
  return { text, end: i };
}

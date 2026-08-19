export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): Record<string, unknown> | undefined;
  setState(state: Record<string, unknown>): void;
}

export interface QueryUiElements {
  queryEl: HTMLInputElement;
  queryHighlightEl: HTMLElement;
  suggestionsEl: HTMLElement;
  statsEl: HTMLElement;
  emptyStateEl: HTMLElement;
  editorContainerEl: HTMLElement;
  progressEl: HTMLElement;
  progressFillEl: HTMLElement;
  progressTextEl: HTMLElement;
  filenameEl: HTMLElement;
  warningsEl: HTMLElement;
}

export interface QueryUiCallbacks {
  onQueryChange: (query: string) => void;
}

const SYNTAX_SUGGESTIONS = [
  { key: 'tag:', desc: 'Tag substring match' },
  { key: '-tag:', desc: 'Exclude tag' },
  { key: 'tag=:', desc: 'Tag exact match' },
  { key: 'message:', desc: 'Message substring match' },
  { key: '-message:', desc: 'Exclude message' },
  { key: 'line:', desc: 'Full line substring match' },
  { key: 'level:', desc: 'Level and above (V/D/I/W/E)' },
  { key: 'pid:', desc: 'Process ID match' },
  { key: '-pid:', desc: 'Exclude PID' },
  { key: 'process:', desc: 'Process name substring match' },
  { key: 'age:', desc: 'Relative time (e.g. age:5m age:1h)' },
  { key: 'after:', desc: 'Time lower bound (e.g. after:11:02:00 or after:08-18 11:02:00)' },
  { key: 'before:', desc: 'Time upper bound (e.g. before:11:59:42 or before:08-18 11:59:42)' },
  { key: 'is:crash', desc: 'Crash logs' },
  { key: 'is:stacktrace', desc: 'Stack traces' },
  { key: 'is:firebase', desc: 'Firebase related' },
  { key: 'is:debug', desc: 'DEBUG level only' },
  { key: 'is:error', desc: 'ERROR level only' },
  { key: '&', desc: 'Explicit AND' },
  { key: '|', desc: 'Explicit OR' },
];

const KEY_NAMES =
  'tag|message|line|level|age|is|name|process|pid|after|before|package';
const KEY_PATTERN = new RegExp(`^-?(?:${KEY_NAMES})(?:~|=)?:`, 'i');
const TIME_VALUE_TAIL = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/;

export function initQueryUi(
  vscode: VsCodeApi,
  el: QueryUiElements,
  callbacks: QueryUiCallbacks,
): {
  isQueryEmpty: () => boolean;
  isParsing: () => boolean;
  applyPanelUpdate: (msg: PanelUpdateMessage) => void;
} {
  let knownTags: string[] = [];
  let queryDebounce: ReturnType<typeof setTimeout> | undefined;
  let suggestionActive = -1;

  el.queryEl.addEventListener('input', () => {
    syncQueryOverlay();
    updateQuerySyntaxHighlight();
    updateSuggestions();
    updateEmptyStatePreview();
    clearTimeout(queryDebounce);
    queryDebounce = setTimeout(() => {
      callbacks.onQueryChange(el.queryEl.value);
      const state = vscode.getState();
      if (state?.sourceUri) {
        vscode.setState({ ...state, query: el.queryEl.value });
      }
    }, 150);
  });

  function isQueryEmpty(): boolean {
    return !el.queryEl.value.trim();
  }

  function isParsing(): boolean {
    return !el.progressEl.classList.contains('hidden');
  }

  function updateEmptyStatePreview(): void {
    const showEmpty = isQueryEmpty() && !isParsing();
    el.emptyStateEl.classList.toggle('hidden', !showEmpty);
    el.editorContainerEl.classList.toggle('hidden', showEmpty);
  }

  el.queryEl.addEventListener('scroll', syncQueryOverlay);
  el.queryEl.addEventListener('select', syncQueryOverlay);
  el.queryEl.addEventListener('keyup', syncQueryOverlay);
  el.queryEl.addEventListener('click', syncQueryOverlay);

  function syncQueryOverlay(): void {
    el.queryHighlightEl.scrollLeft = el.queryEl.scrollLeft;
  }

  el.queryEl.addEventListener('focus', updateSuggestions);
  el.queryEl.addEventListener('blur', () => {
    setTimeout(() => hideSuggestions(), 150);
  });

  el.queryEl.addEventListener('keydown', (e) => {
    if (!el.suggestionsEl.classList.contains('hidden')) {
      const items = el.suggestionsEl.querySelectorAll('.suggestion-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        suggestionActive = Math.min(suggestionActive + 1, items.length - 1);
        highlightSuggestion(items);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        suggestionActive = Math.max(suggestionActive - 1, 0);
        highlightSuggestion(items);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestionActive >= 0)) {
        if (suggestionActive >= 0 && items[suggestionActive]) {
          e.preventDefault();
          applySuggestion((items[suggestionActive] as HTMLElement).dataset.value ?? '');
          return;
        }
      }
      if (e.key === 'Escape') {
        hideSuggestions();
        return;
      }
    }
  });

  el.suggestionsEl.addEventListener('mousedown', (e) => {
    const item = (e.target as HTMLElement).closest('.suggestion-item');
    if (item) {
      e.preventDefault();
      applySuggestion((item as HTMLElement).dataset.value ?? '');
    }
  });

  function getCurrentToken(): string {
    const val = el.queryEl.value;
    const pos = el.queryEl.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const tokenMatch = before.match(/(?:^|[\s&(|-])([^\s&|()]*)$/);
    return tokenMatch ? tokenMatch[1] : before.trim();
  }

  function updateSuggestions(): void {
    const token = getCurrentToken().toLowerCase();
    let items: { key: string; desc: string }[] = [];

    if (!token || /^-?\w*$/.test(token)) {
      items = SYNTAX_SUGGESTIONS.filter(
        (s) => !token || s.key.toLowerCase().startsWith(token),
      );
    }

    const tagPrefix = token.match(/^(-?)tag:(.*)$/i);
    if (tagPrefix && knownTags.length > 0) {
      const partial = tagPrefix[2].toLowerCase();
      items = knownTags
        .filter((t) => !partial || t.toLowerCase().includes(partial))
        .slice(0, 15)
        .map((t) => ({
          key: `${tagPrefix[1] ? '-' : ''}tag:${t}`,
          desc: 'Tag',
        }));
    }

    const levelPrefix = token.match(/^level:(.*)$/i);
    if (levelPrefix) {
      const partial = levelPrefix[1].toLowerCase();
      ['V', 'D', 'I', 'W', 'E', 'VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR']
        .filter((l) => !partial || l.toLowerCase().startsWith(partial))
        .forEach((l) => items.push({ key: `level:${l}`, desc: 'Log level' }));
    }

    if (items.length === 0) {
      hideSuggestions();
      return;
    }

    el.suggestionsEl.innerHTML = '';
    items.slice(0, 20).forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'suggestion-item' + (idx === 0 ? ' active' : '');
      row.dataset.value = item.key;
      row.innerHTML =
        `<span class="suggestion-key">${escapeHtml(item.key)}</span>` +
        `<span class="suggestion-desc">${escapeHtml(item.desc)}</span>`;
      el.suggestionsEl.appendChild(row);
    });
    suggestionActive = 0;
    el.suggestionsEl.classList.remove('hidden');
  }

  function highlightSuggestion(items: NodeListOf<Element>): void {
    items.forEach((node, idx) => {
      node.classList.toggle('active', idx === suggestionActive);
    });
    items[suggestionActive]?.scrollIntoView({ block: 'nearest' });
  }

  function applySuggestion(value: string): void {
    const val = el.queryEl.value;
    const pos = el.queryEl.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const replaced = before.replace(/(?:^|[\s&(|-])([^\s&|()]*)$/, (m, token) =>
      m.slice(0, m.length - token.length) + value,
    );
    el.queryEl.value = replaced + after;
    const newPos = replaced.length;
    el.queryEl.setSelectionRange(newPos, newPos);
    hideSuggestions();
    el.queryEl.focus();
    updateQuerySyntaxHighlight();
    callbacks.onQueryChange(el.queryEl.value);
  }

  function hideSuggestions(): void {
    el.suggestionsEl.classList.add('hidden');
    suggestionActive = -1;
  }

  function updateQuerySyntaxHighlight(): void {
    el.queryHighlightEl.innerHTML = renderQuerySyntaxHtml(el.queryEl.value);
    syncQueryOverlay();
  }

  updateQuerySyntaxHighlight();

  return {
    isQueryEmpty,
    isParsing,
    applyPanelUpdate(msg: PanelUpdateMessage): void {
      if (msg.query !== undefined && document.activeElement !== el.queryEl) {
        el.queryEl.value = msg.query;
      }
      knownTags = msg.tags ?? knownTags;
      updateQuerySyntaxHighlight();

      const matched = msg.stats?.matched ?? 0;
      const total = msg.stats?.total ?? 0;
      const queryEmpty = !(msg.query ?? el.queryEl.value).trim();
      el.statsEl.textContent = queryEmpty ? `— / ${total}` : `${matched} / ${total}`;

      const parsing = msg.parseState === 'parsing';
      const showEmpty = queryEmpty && !parsing;
      el.emptyStateEl.classList.toggle('hidden', !showEmpty);
      el.editorContainerEl.classList.toggle('hidden', showEmpty);

      el.filenameEl.textContent = `${msg.fileName || ''} (${msg.format || 'unknown'})`;

      if (msg.warnings && msg.warnings.length) {
        el.warningsEl.textContent = msg.warnings.join('; ');
      } else {
        el.warningsEl.textContent = '';
      }

      if (msg.parseState === 'parsing') {
        el.progressEl.classList.remove('hidden');
        el.progressEl.classList.add('indeterminate');
        el.progressFillEl.style.width = '0%';
        const scan = msg.scanStats;
        el.progressTextEl.textContent = scan
          ? formatScanStatus(scan)
          : 'Scanning…';
      } else {
        el.progressEl.classList.add('hidden');
        el.progressEl.classList.remove('indeterminate');
        el.progressFillEl.style.width = '0%';
      }

      if (msg.sourceUri) {
        vscode.setState({
          sourceUri: msg.sourceUri,
          sourceViewColumn: msg.sourceViewColumn,
          query: msg.query ?? el.queryEl.value,
        });
      }
    },
  };
}

export interface PanelUpdateMessage {
  sourceUri?: string;
  sourceViewColumn?: number;
  query?: string;
  stats?: { matched: number; total: number };
  fileName?: string;
  format?: string;
  warnings?: string[];
  parseState?: string;
  scanStats?: { linesProcessed: number; entryCount: number };
  tags?: string[];
  highlightTerms?: { text: string; exact?: boolean }[];
  rows?: { id: number; fullText: string; lineNumber: number }[];
}

function formatCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${Math.round(n / 1000)}k`;
  }
  return String(n);
}

function formatScanStatus(scan: { linesProcessed: number; entryCount: number }): string {
  return `Scanning… ${formatCount(scan.linesProcessed)} lines · ${formatCount(scan.entryCount)} entries`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function keyFieldFromRawKey(rawKey: string): string {
  const withoutNeg = rawKey.startsWith('-') ? rawKey.slice(1) : rawKey;
  let fieldPart = withoutNeg;
  if (withoutNeg.includes('~:')) {
    fieldPart = withoutNeg.replace('~:', ':');
  } else if (withoutNeg.includes('=:')) {
    fieldPart = withoutNeg.replace('=:', ':');
  }
  return fieldPart.slice(0, fieldPart.indexOf(':')).toLowerCase();
}

function continuesDatetimeValue(field: string, textSoFar: string, input: string, spaceIndex: number): boolean {
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

function renderQuerySyntaxHtml(text: string): string {
  const spans = tokenizeQueryForDisplay(text);
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

type DisplaySpan = {
  type: string;
  text: string;
  negated?: boolean;
};

function tokenizeQueryForDisplay(input: string): DisplaySpan[] {
  const spans: DisplaySpan[] = [];
  let i = 0;
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
      const value = readDisplayValue(input, i, field);
      spans.push({ type: 'key', text: rawKey, negated });
      i = value.end;
      if (value.text) {
        spans.push({ type: 'value', text: value.text });
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quoted = readDisplayQuoted(input, i);
      spans.push({ type: 'quote', text: quoted.text });
      i = quoted.end;
      continue;
    }
    const word = readDisplayWord(input, i);
    spans.push({ type: 'phrase', text: word.text });
    i = word.end;
  }
  return spans;
}

function readDisplayValue(input: string, start: number, field: string): { text: string; end: number } {
  if (start >= input.length) {
    return { text: '', end: start };
  }
  const ch = input[start];
  if (ch === '"' || ch === "'") {
    return readDisplayQuoted(input, start);
  }
  return readDisplayUnquoted(input, start, field);
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

function readDisplayUnquoted(input: string, start: number, field: string): { text: string; end: number } {
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
    if (ch === '\\' && i + 1 < input.length) {
      text += input.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (KEY_PATTERN.test(input.slice(i))) {
      break;
    }
    text += ch;
    i++;
  }
  return { text, end: i };
}

function readDisplayWord(input: string, start: number): { text: string; end: number } {
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
    if (KEY_PATTERN.test(input.slice(i))) {
      break;
    }
    text += ch;
    i++;
  }
  return { text, end: i };
}

export type QueryUiController = ReturnType<typeof initQueryUi>;

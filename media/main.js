(function () {
  const vscode = acquireVsCodeApi();

  const queryEl = document.getElementById('query');
  const queryHighlightEl = document.getElementById('query-highlight');
  const suggestionsEl = document.getElementById('suggestions');
  const statsEl = document.getElementById('stats');
  const listEl = document.getElementById('list');
  const scrollContentEl = document.getElementById('scroll-content');
  const emptyStateEl = document.getElementById('empty-state');
  const rowsEl = document.getElementById('rows');
  const filenameEl = document.getElementById('filename');
  const warningsEl = document.getElementById('warnings');
  const progressEl = document.getElementById('progress');
  const progressFillEl = document.getElementById('progress-fill');
  const progressTextEl = document.getElementById('progress-text');

  const ROW_HEIGHT = 19;
  const BUFFER = 20;

  let prefixOffsets = [0];
  let lastScrollTop = -1;
  let lastRenderedStart = -1;
  let lastRenderedEnd = -1;
  let lastFilteredKey = '';

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

  let filteredIds = [];
  let rowCache = new Map();
  let knownTags = [];
  let highlightTerms = [];
  let maxLineNumber = 1;
  let selectedIndex = -1;
  let windowStart = 0;
  let windowEnd = 0;
  let queryDebounce;
  let suggestionActive = -1;

  queryEl.addEventListener('input', () => {
    syncQueryOverlay();
    updateQuerySyntaxHighlight();
    updateSuggestions();
    updateEmptyStatePreview();
    clearTimeout(queryDebounce);
    queryDebounce = setTimeout(() => {
      vscode.postMessage({ type: 'queryChange', query: queryEl.value });
      const state = vscode.getState();
      if (state?.sourceUri) {
        vscode.setState({ ...state, query: queryEl.value });
      }
    }, 150);
  });

  function isQueryEmpty() {
    return !queryEl.value.trim();
  }

  function updateEmptyStatePreview() {
    const parsing = !progressEl.classList.contains('hidden');
    const showEmpty = isQueryEmpty() && !parsing;
    emptyStateEl.classList.toggle('hidden', !showEmpty);
    scrollContentEl.classList.toggle('hidden', showEmpty);
  }

  queryEl.addEventListener('scroll', syncQueryOverlay);
  queryEl.addEventListener('select', syncQueryOverlay);
  queryEl.addEventListener('keyup', syncQueryOverlay);
  queryEl.addEventListener('click', syncQueryOverlay);

  function syncQueryOverlay() {
    queryHighlightEl.scrollLeft = queryEl.scrollLeft;
  }

  queryEl.addEventListener('focus', updateSuggestions);
  queryEl.addEventListener('blur', () => {
    setTimeout(() => hideSuggestions(), 150);
  });

  queryEl.addEventListener('keydown', (e) => {
    if (!suggestionsEl.classList.contains('hidden')) {
      const items = suggestionsEl.querySelectorAll('.suggestion-item');
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
          applySuggestion(items[suggestionActive].dataset.value);
          return;
        }
      }
      if (e.key === 'Escape') {
        hideSuggestions();
        return;
      }
    }
    if (e.key === 'Enter' && selectedIndex >= 0) {
      goToSelected();
    }
  });

  suggestionsEl.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (item) {
      e.preventDefault();
      applySuggestion(item.dataset.value);
    }
  });

  listEl.addEventListener('scroll', onScroll);
  listEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      goToSelected();
    } else if (e.key === 'ArrowDown') {
      selectIndex(Math.min(selectedIndex + 1, filteredIds.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selectIndex(Math.max(selectedIndex - 1, 0));
      e.preventDefault();
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      handleUpdate(msg);
    } else if (msg.type === 'windowData') {
      handleWindowData(msg);
    }
  });

  function getCurrentToken() {
    const val = queryEl.value;
    const pos = queryEl.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const tokenMatch = before.match(/(?:^|[\s&(|-])([^\s&|()]*)$/);
    return tokenMatch ? tokenMatch[1] : before.trim();
  }

  function updateSuggestions() {
    const token = getCurrentToken().toLowerCase();
    let items = [];

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

    suggestionsEl.innerHTML = '';
    items.slice(0, 20).forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'suggestion-item' + (idx === 0 ? ' active' : '');
      el.dataset.value = item.key;
      el.innerHTML =
        `<span class="suggestion-key">${escapeHtml(item.key)}</span>` +
        `<span class="suggestion-desc">${escapeHtml(item.desc)}</span>`;
      suggestionsEl.appendChild(el);
    });
    suggestionActive = 0;
    suggestionsEl.classList.remove('hidden');
  }

  function highlightSuggestion(items) {
    items.forEach((el, idx) => {
      el.classList.toggle('active', idx === suggestionActive);
    });
    items[suggestionActive]?.scrollIntoView({ block: 'nearest' });
  }

  function applySuggestion(value) {
    const val = queryEl.value;
    const pos = queryEl.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const replaced = before.replace(/(?:^|[\s&(|-])([^\s&|()]*)$/, (m, token) =>
      m.slice(0, m.length - token.length) + value,
    );
    queryEl.value = replaced + after;
    const newPos = replaced.length;
    queryEl.setSelectionRange(newPos, newPos);
    hideSuggestions();
    queryEl.focus();
    updateQuerySyntaxHighlight();
    vscode.postMessage({ type: 'queryChange', query: queryEl.value });
  }

  function hideSuggestions() {
    suggestionsEl.classList.add('hidden');
    suggestionActive = -1;
  }

  function persistPanelState(msg) {
    if (!msg?.sourceUri) {
      return;
    }
    vscode.setState({
      sourceUri: msg.sourceUri,
      sourceViewColumn: msg.sourceViewColumn,
      query: msg.query ?? queryEl.value,
    });
  }

  function handleUpdate(msg) {
    if (msg.query !== undefined && document.activeElement !== queryEl) {
      queryEl.value = msg.query;
    }

    const filteredKey = `${msg.query ?? ''}|${(msg.filteredIds || []).length}|${msg.filteredIds?.[0] ?? ''}|${msg.filteredIds?.[msg.filteredIds.length - 1] ?? ''}`;
    const filterChanged = filteredKey !== lastFilteredKey;
    if (filterChanged) {
      lastFilteredKey = filteredKey;
      rowCache.clear();
      lastScrollTop = -1;
      lastRenderedStart = -1;
      lastRenderedEnd = -1;
      listEl.scrollTop = 0;
      listEl.scrollLeft = 0;
    }

    filteredIds = msg.filteredIds || [];
    knownTags = msg.tags || [];
    highlightTerms = msg.highlightTerms || [];
    maxLineNumber = msg.maxLineNumber || 1;
    selectedIndex = filteredIds.length > 0 ? 0 : -1;
    updateQuerySyntaxHighlight();

    const matched = msg.stats?.matched ?? 0;
    const total = msg.stats?.total ?? 0;
    const queryEmpty = !(msg.query ?? queryEl.value).trim();
    statsEl.textContent = queryEmpty ? `— / ${total}` : `${matched} / ${total}`;

    const parsing = msg.parseState === 'parsing';
    const showEmpty = queryEmpty && !parsing;
    emptyStateEl.classList.toggle('hidden', !showEmpty);
    scrollContentEl.classList.toggle('hidden', showEmpty);

    filenameEl.textContent = `${msg.fileName || ''} (${msg.format || 'unknown'})`;

    if (msg.warnings && msg.warnings.length) {
      warningsEl.textContent = msg.warnings.join('; ');
    } else {
      warningsEl.textContent = '';
    }

    if (msg.parseState === 'parsing') {
      progressEl.classList.remove('hidden');
      const pct = msg.parseProgress ?? 0;
      progressFillEl.style.width = `${pct}%`;
      progressTextEl.textContent = msg.parseProgress !== undefined
        ? `Parsing… ${pct}%`
        : 'Parsing…';
    } else {
      progressEl.classList.add('hidden');
      progressFillEl.style.width = '0%';
    }

    updateGutterWidth();
    rebuildLayout();
    if (!showEmpty) {
      requestWindow(0, estimateVisibleRows());
      renderVisibleRows(true);
    } else {
      rowsEl.innerHTML = '';
    }
    renderSelection();
    persistPanelState(msg);
  }

  function handleWindowData(msg) {
    windowStart = msg.start;
    windowEnd = msg.end;
    for (const row of msg.rows || []) {
      rowCache.set(row.id, row);
    }
    rebuildLayout();
    renderVisibleRows(true);
  }

  function rowLineCount(row) {
    if (!row || !row.fullText) {
      return 1;
    }
    return Math.max(1, row.fullText.split('\n').length);
  }

  function rowHeightAt(index) {
    const id = filteredIds[index];
    return rowLineCount(rowCache.get(id)) * ROW_HEIGHT;
  }

  function rebuildLayout() {
    prefixOffsets = [0];
    for (let i = 0; i < filteredIds.length; i++) {
      prefixOffsets.push(prefixOffsets[i] + rowHeightAt(i));
    }
    const total = prefixOffsets[filteredIds.length] || 0;
    scrollContentEl.style.height = `${Math.max(total, listEl.clientHeight)}px`;
  }

  function updateGutterWidth() {
    const digits = String(maxLineNumber).length;
    const width = Math.max(48, digits * 9 + 28);
    document.documentElement.style.setProperty('--gutter-width', `${width}px`);
  }

  function findRowAtOffset(offset) {
    if (filteredIds.length === 0) {
      return 0;
    }
    let lo = 0;
    let hi = filteredIds.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (prefixOffsets[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  function estimateVisibleRows() {
    return Math.ceil(listEl.clientHeight / ROW_HEIGHT) + BUFFER * 2;
  }

  function onScroll() {
    const scrollTop = listEl.scrollTop;
    if (lastScrollTop >= 0 && Math.abs(scrollTop - lastScrollTop) < 0.5) {
      return;
    }
    lastScrollTop = scrollTop;

    const start = Math.max(0, findRowAtOffset(scrollTop) - BUFFER);
    const viewEnd = scrollTop + listEl.clientHeight + BUFFER * ROW_HEIGHT;
    let end = start;
    while (end < filteredIds.length && prefixOffsets[end] < viewEnd) {
      end++;
    }
    end = Math.min(filteredIds.length, end + BUFFER);

    renderVisibleRows(false, start, end);

    if (start < windowStart || end > windowEnd) {
      requestWindow(start, end);
    }
  }

  function requestWindow(start, end) {
    vscode.postMessage({ type: 'requestWindow', start, end });
  }

  function renderVisibleRows(force, rangeStart, rangeEnd) {
    if (filteredIds.length === 0) {
      rowsEl.innerHTML = '';
      return;
    }

    const scrollTop = listEl.scrollTop;
    const scrollLeft = listEl.scrollLeft;
    const viewBottom = scrollTop + listEl.clientHeight;
    let start = rangeStart ?? Math.max(0, findRowAtOffset(Math.max(0, scrollTop - BUFFER * ROW_HEIGHT)) - BUFFER);
    let end = rangeEnd ?? start;

    if (rangeEnd === undefined) {
      while (end < filteredIds.length && prefixOffsets[end] < viewBottom + BUFFER * ROW_HEIGHT) {
        end++;
      }
      end = Math.min(filteredIds.length, end + 1);
    }

    if (!force && start === lastRenderedStart && end === lastRenderedEnd && rowsEl.childElementCount > 0) {
      return;
    }
    lastRenderedStart = start;
    lastRenderedEnd = end;

    rowsEl.innerHTML = '';
    rowsEl.style.transform = `translateY(${prefixOffsets[start]}px)`;

    for (let i = start; i < end; i++) {
      const id = filteredIds[i];
      const row = rowCache.get(id);
      if (!row) {
        continue;
      }

      const el = document.createElement('div');
      el.className = 'row' + (i === selectedIndex ? ' selected' : '');
      el.dataset.index = String(i);
      el.dataset.line = String(row.lineNumber);
      el.style.height = `${rowHeightAt(i)}px`;

      const lineNo = row.lineNumber + 1;
      const text = row.fullText || '';

      el.innerHTML =
        `<span class="gutter">${lineNo}</span>` +
        `<pre class="line-text">${highlightFullText(text)}</pre>`;

      el.addEventListener('click', () => selectIndex(i));
      el.addEventListener('dblclick', () => {
        selectIndex(i);
        goToSelected();
      });

      rowsEl.appendChild(el);
    }

    listEl.scrollTop = scrollTop;
    listEl.scrollLeft = scrollLeft;
  }

  function selectIndex(index) {
    selectedIndex = index;
    renderSelection();
    if (index >= 0 && filteredIds[index] !== undefined) {
      vscode.postMessage({ type: 'selectEntry', id: filteredIds[index] });
    }
  }

  function renderSelection() {
    const rows = rowsEl.querySelectorAll('.row');
    rows.forEach((el) => {
      const idx = parseInt(el.dataset.index || '-1', 10);
      el.classList.toggle('selected', idx === selectedIndex);
    });
  }

  function goToSelected() {
    if (selectedIndex < 0) {
      return;
    }
    const id = filteredIds[selectedIndex];
    const row = rowCache.get(id);
    if (row) {
      vscode.postMessage({ type: 'goToSource', line: row.lineNumber });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const KEY_NAMES =
    'tag|message|line|level|age|is|name|process|pid|after|before|package';
  const KEY_PATTERN = new RegExp(`^-?(?:${KEY_NAMES})(?:~|=)?:`, 'i');
  const TIME_VALUE_TAIL = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/;

  function keyFieldFromRawKey(rawKey) {
    const withoutNeg = rawKey.startsWith('-') ? rawKey.slice(1) : rawKey;
    let fieldPart = withoutNeg;
    if (withoutNeg.includes('~:')) {
      fieldPart = withoutNeg.replace('~:', ':');
    } else if (withoutNeg.includes('=:')) {
      fieldPart = withoutNeg.replace('=:', ':');
    }
    return fieldPart.slice(0, fieldPart.indexOf(':')).toLowerCase();
  }

  function continuesDatetimeValue(field, textSoFar, input, spaceIndex) {
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

  function updateQuerySyntaxHighlight() {
    queryHighlightEl.textContent = '';
    queryHighlightEl.innerHTML = renderQuerySyntaxHtml(queryEl.value);
    syncQueryOverlay();
  }

  function renderQuerySyntaxHtml(text) {
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

  function tokenizeQueryForDisplay(input) {
    const spans = [];
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

  function readDisplayValue(input, start, field) {
    if (start >= input.length) {
      return { text: '', end: start };
    }
    const ch = input[start];
    if (ch === '"' || ch === "'") {
      return readDisplayQuoted(input, start);
    }
    return readDisplayUnquoted(input, start, field);
  }

  function readDisplayQuoted(input, start) {
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

  function readDisplayUnquoted(input, start, field) {
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

  function readDisplayWord(input, start) {
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

  function highlightFullText(text) {
    if (!text || !highlightTerms.length) {
      return escapeHtml(text);
    }

    const ranges = [];
    const hay = text.toLowerCase();
    for (const term of highlightTerms) {
      if (!term.text) {
        continue;
      }
      const needle = term.text.toLowerCase();
      if (term.exact) {
        let idx = 0;
        while (idx <= hay.length) {
          if (hay.slice(idx, idx + needle.length) === needle) {
            const before = idx === 0 || /\s/.test(hay[idx - 1]);
            const after = idx + needle.length === hay.length || /\s/.test(hay[idx + needle.length]);
            if (before && after) {
              ranges.push({ start: idx, end: idx + needle.length });
            }
            idx += needle.length;
          } else {
            idx++;
          }
        }
        continue;
      }
      let idx = 0;
      while (idx < hay.length) {
        const found = hay.indexOf(needle, idx);
        if (found === -1) {
          break;
        }
        ranges.push({ start: found, end: found + needle.length });
        idx = found + 1;
      }
    }

    if (!ranges.length) {
      return escapeHtml(text);
    }

    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) {
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push({ start: r.start, end: r.end });
      }
    }

    let html = '';
    let pos = 0;
    for (const r of merged) {
      html += escapeHtml(text.slice(pos, r.start));
      html += '<mark class="match-hl">' + escapeHtml(text.slice(r.start, r.end)) + '</mark>';
      pos = r.end;
    }
    html += escapeHtml(text.slice(pos));
    return html;
  }

  updateQuerySyntaxHighlight();
})();

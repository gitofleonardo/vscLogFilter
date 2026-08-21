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
  const findBarEl = document.getElementById('find-bar');
  const findInputEl = document.getElementById('find-input');
  const findStatusEl = document.getElementById('find-status');
  const findPrevEl = document.getElementById('find-prev');
  const findNextEl = document.getElementById('find-next');
  const findCloseEl = document.getElementById('find-close');
  const filesBtnEl = document.getElementById('files-btn');
  const filesCountEl = document.getElementById('files-count');
  const filesMenuEl = document.getElementById('files-menu');
  const filesDropdownEl = document.getElementById('files-dropdown');

  const ROW_HEIGHT = 19;
  const BUFFER = 40;

  function decodeUriBasename(uri) {
    const withoutQuery = String(uri || '').split(/[?#]/, 1)[0];
    const slash = Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'));
    const raw = slash >= 0 ? withoutQuery.slice(slash + 1) : withoutQuery;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

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

  let matchCount = 0;
  let rowCache = new Map();
  let knownTags = [];
  let highlightTerms = [];
  let maxLineNumber = 1;
  let selectedIndex = -1;
  let queryDebounce;
  let suggestionActive = -1;
  let findActive = false;
  let findQuery = '';
  let findMatches = [];
  let currentMatchIndex = -1;
  let findDebounce;
  let primaryUri = '';
  let selectedUris = [];
  let openFiles = [];
  let selectedFileCount = 1;
  let filesMenuOpen = false;
  let rowRequestId = 0;
  let pendingRowRequest = null;
  let findRequestId = 0;
  let filterEpoch = 0;
  let pendingGoToIndex = -1;

  function formatCount(n) {
    if (n >= 1_000_000) {
      return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 10_000) {
      return `${Math.round(n / 1000)}k`;
    }
    return String(n);
  }

  function formatScanStatus(scan) {
    return `Scanning… ${formatCount(scan.linesProcessed)} lines · ${formatCount(scan.entryCount)} entries`;
  }

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
      selectIndex(Math.min(selectedIndex + 1, matchCount - 1));
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
    } else if (msg.type === 'rows') {
      handleRows(msg);
    } else if (msg.type === 'findMatches') {
      handleFindMatches(msg);
    } else if (msg.type === 'filesState') {
      handleFilesState(msg);
    } else if (msg.type === 'showFind') {
      showFindBar();
    } else if (msg.type === 'findNext') {
      advanceFind(1);
    } else if (msg.type === 'findPrevious') {
      advanceFind(-1);
    }
  });

  function setFilesMenuOpen(open) {
    filesMenuOpen = open;
    filesMenuEl.classList.toggle('hidden', !open);
    filesBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function toggleFilesMenu() {
    setFilesMenuOpen(!filesMenuOpen);
  }

  function handleFilesState(msg) {
    primaryUri = msg.primaryUri || '';
    selectedUris = Array.isArray(msg.selectedUris) ? msg.selectedUris.slice() : [];
    openFiles = Array.isArray(msg.openFiles) ? msg.openFiles.slice() : [];
    selectedFileCount = selectedUris.length || 1;
    filesCountEl.textContent = `(${selectedFileCount})`;
    renderFilesMenu();
    const prev = vscode.getState() || {};
    if (prev.sourceUri || primaryUri) {
      vscode.setState({
        ...prev,
        sourceUri: prev.sourceUri || primaryUri,
        selectedUris,
      });
    }
  }

  function renderFilesMenu() {
    const fragment = document.createDocumentFragment();
    const selectedSet = new Set(selectedUris);

    // Keep primary first in the menu when present.
    const ordered = [];
    const seen = new Set();
    if (primaryUri) {
      const primary = openFiles.find((f) => f.uri === primaryUri) || {
        uri: primaryUri,
        fileName: decodeUriBasename(primaryUri),
      };
      ordered.push(primary);
      seen.add(primaryUri);
    }
    for (const file of openFiles) {
      if (!seen.has(file.uri)) {
        ordered.push(file);
        seen.add(file.uri);
      }
    }

    for (const file of ordered) {
      const locked = file.uri === primaryUri;
      const item = document.createElement('label');
      item.className = 'files-item' + (locked ? ' locked' : '');
      item.title = file.uri;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedSet.has(file.uri) || locked;
      checkbox.disabled = locked;
      checkbox.dataset.uri = file.uri;

      if (!locked) {
        checkbox.addEventListener('change', () => {
          const next = new Set(selectedUris);
          if (checkbox.checked) {
            next.add(file.uri);
          } else {
            next.delete(file.uri);
          }
          if (primaryUri) {
            next.add(primaryUri);
          }
          vscode.postMessage({ type: 'filesSelectionChange', uris: [...next] });
        });
      }

      const label = document.createElement('span');
      label.className = 'files-item-label';
      label.textContent = file.fileName || file.uri;

      item.appendChild(checkbox);
      item.appendChild(label);
      fragment.appendChild(item);
    }

    if (ordered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'files-item';
      empty.textContent = 'No open text files';
      fragment.appendChild(empty);
    }

    filesMenuEl.replaceChildren(fragment);
  }

  filesBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFilesMenu();
  });

  document.addEventListener('click', (e) => {
    if (!filesMenuOpen) {
      return;
    }
    if (!filesDropdownEl.contains(e.target)) {
      setFilesMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && filesMenuOpen) {
      setFilesMenuOpen(false);
    }
  });

  findInputEl.addEventListener('input', () => {
    clearTimeout(findDebounce);
    findDebounce = setTimeout(() => {
      findQuery = findInputEl.value;
      currentMatchIndex = findQuery ? 0 : -1;
      rebuildFindMatches();
      scrollToCurrentMatch();
    }, 100);
  });

  findInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      advanceFind(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideFindBar();
    }
  });

  findPrevEl.addEventListener('click', () => advanceFind(-1));
  findNextEl.addEventListener('click', () => advanceFind(1));
  findCloseEl.addEventListener('click', () => hideFindBar());

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      showFindBar();
      return;
    }
    if (findActive && e.key === 'Escape' && document.activeElement !== findInputEl) {
      hideFindBar();
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
    const prev = vscode.getState() || {};
    vscode.setState({
      ...prev,
      sourceUri: msg.sourceUri,
      sourceViewColumn: msg.sourceViewColumn,
      query: msg.query ?? queryEl.value,
      selectedUris: msg.selectedUris ?? prev.selectedUris,
    });
  }

  function handleUpdate(msg) {
    if (msg.query !== undefined && document.activeElement !== queryEl) {
      queryEl.value = msg.query;
    }

    const nextMatchCount = msg.matchCount ?? msg.stats?.matched ?? 0;
    const filteredKey = `${msg.query ?? ''}|${nextMatchCount}|${msg.parseState ?? ''}`;
    const filterChanged = filteredKey !== lastFilteredKey;
    if (filterChanged) {
      lastFilteredKey = filteredKey;
      lastScrollTop = -1;
      lastRenderedStart = -1;
      lastRenderedEnd = -1;
      filterEpoch++;
      rowCache.clear();
      pendingRowRequest = null;
      listEl.scrollTop = 0;
      listEl.scrollLeft = 0;
    }

    matchCount = nextMatchCount;
    knownTags = msg.tags || [];
    highlightTerms = msg.highlightTerms || [];
    maxLineNumber = msg.maxLineNumber || 1;
    selectedIndex = matchCount > 0 ? 0 : -1;
    updateQuerySyntaxHighlight();

    const matched = msg.stats?.matched ?? 0;
    const total = msg.stats?.total ?? 0;
    const queryEmpty = !(msg.query ?? queryEl.value).trim();
    statsEl.textContent = queryEmpty ? `— / ${total}` : `${matched} / ${total}`;

    const parsing = msg.parseState === 'parsing';
    const filtering = msg.parseState === 'filtering';
    const showEmpty = queryEmpty && !parsing && !filtering;
    emptyStateEl.classList.toggle('hidden', !showEmpty);
    scrollContentEl.classList.toggle('hidden', showEmpty);

    filenameEl.textContent = `${msg.fileName || ''} (${msg.format || 'unknown'})`;
    if (typeof msg.selectedFileCount === 'number') {
      selectedFileCount = msg.selectedFileCount;
      filesCountEl.textContent = `(${selectedFileCount})`;
    }

    if (msg.warnings && msg.warnings.length) {
      warningsEl.textContent = msg.warnings.join('; ');
    } else {
      warningsEl.textContent = '';
    }

    if (msg.parseState === 'parsing' || filtering) {
      progressEl.classList.remove('hidden');
      const scan = msg.scanStats;
      const percent = scan?.percent;
      if (msg.parseState === 'parsing' && (typeof percent !== 'number' || percent <= 0)) {
        progressFillEl.style.width = '0%';
      }
      if (!filtering && typeof percent === 'number' && percent >= 0) {
        progressEl.classList.remove('indeterminate');
        progressFillEl.style.width = `${Math.min(100, percent)}%`;
      } else if (filtering) {
        progressEl.classList.add('indeterminate');
        progressFillEl.style.removeProperty('width');
      } else {
        progressEl.classList.add('indeterminate');
      }
      progressTextEl.textContent = filtering
        ? 'Filtering…'
        : scan
          ? formatScanStatus(scan)
          : 'Scanning…';
    } else {
      progressEl.classList.add('hidden');
      progressEl.classList.remove('indeterminate');
    }

    updateGutterWidth();
    rebuildLayout();
    if (!showEmpty) {
      renderVisibleRows(true);
    } else {
      rowsEl.replaceChildren();
    }
    renderSelection();
    persistPanelState(msg);
    if (findActive && findQuery) {
      rebuildFindMatches();
    }
  }

  function handleRows(msg) {
    // Prefetch from extension uses requestId -1; accept it without a pending request.
    const isPrefetch = msg && msg.requestId === -1;
    if (!isPrefetch && (!msg || msg.requestId !== pendingRowRequest?.id)) {
      return;
    }
    if (!isPrefetch && pendingRowRequest && pendingRowRequest.epoch !== filterEpoch) {
      pendingRowRequest = null;
      return;
    }
    const req = isPrefetch
      ? { start: msg.start ?? 0, end: msg.end ?? 0 }
      : pendingRowRequest;
    if (!isPrefetch) {
      pendingRowRequest = null;
    }
    let heightChanged = false;
    for (const row of msg.rows || []) {
      const prev = rowCache.get(row.id);
      if (!prev || rowLineCount(prev) !== rowLineCount(row)) {
        heightChanged = true;
      }
      rowCache.set(row.id, row);
    }
    trimRowCache(req.start, msg.end ?? req.end);
    if (heightChanged) {
      rebuildLayout();
    }
    renderVisibleRows(true);
    if (pendingGoToIndex >= 0) {
      const row = rowCache.get(pendingGoToIndex);
      if (row) {
        const index = pendingGoToIndex;
        pendingGoToIndex = -1;
        vscode.postMessage({
          type: 'goToSource',
          line: row.lineNumber,
          sourceUri: row.sourceUri || primaryUri,
        });
        selectIndex(index);
      }
    }
  }

  const ROW_CACHE_MAX = 2500;

  function trimRowCache(keepStart, keepEnd) {
    if (rowCache.size <= ROW_CACHE_MAX) {
      return;
    }
    const pad = BUFFER * 4;
    const lo = Math.max(0, keepStart - pad);
    const hi = Math.min(matchCount, keepEnd + pad);
    for (const id of rowCache.keys()) {
      if (id < lo || id >= hi) {
        rowCache.delete(id);
      }
    }
  }

  function ensureRows(start, end) {
    const lo = Math.max(0, start);
    const hi = Math.min(matchCount, end);
    if (lo >= hi) {
      return;
    }
    let missing = false;
    for (let i = lo; i < hi; i++) {
      if (!rowCache.has(i)) {
        missing = true;
        break;
      }
    }
    if (!missing) {
      return;
    }
    if (
      pendingRowRequest &&
      pendingRowRequest.start <= lo &&
      pendingRowRequest.end >= hi &&
      pendingRowRequest.epoch === filterEpoch
    ) {
      return;
    }
    const requestId = ++rowRequestId;
    pendingRowRequest = { id: requestId, start: lo, end: hi, epoch: filterEpoch };
    vscode.postMessage({ type: 'requestRows', start: lo, end: hi, requestId });
  }

  function showFindBar() {
    findBarEl.classList.remove('hidden');
    findActive = true;
    findInputEl.focus();
    findInputEl.select();
    if (findQuery) {
      rebuildFindMatches();
      scrollToCurrentMatch();
    }
  }

  function hideFindBar() {
    findBarEl.classList.add('hidden');
    findActive = false;
    findMatches = [];
    currentMatchIndex = -1;
    updateFindStatus();
    renderVisibleRows(true);
    listEl.focus();
  }

  function rebuildFindMatches() {
    findMatches = [];
    if (!findQuery) {
      updateFindStatus();
      return;
    }
    const requestId = ++findRequestId;
    findStatusEl.textContent = 'Searching…';
    vscode.postMessage({ type: 'findInResults', needle: findQuery, requestId });
  }

  function handleFindMatches(msg) {
    if (!msg || msg.requestId !== findRequestId) {
      return;
    }
    findMatches = msg.matches || [];
    if (findMatches.length === 0) {
      currentMatchIndex = -1;
    } else if (currentMatchIndex < 0 || currentMatchIndex >= findMatches.length) {
      currentMatchIndex = 0;
    }
    updateFindStatus();
    if (msg.capped && findMatches.length) {
      findStatusEl.textContent = `${currentMatchIndex + 1} of ${findMatches.length}+`;
    }
    scrollToCurrentMatch();
  }

  function updateFindStatus() {
    if (!findQuery) {
      findStatusEl.textContent = '';
      return;
    }
    if (findMatches.length === 0) {
      findStatusEl.textContent = 'No results';
      return;
    }
    findStatusEl.textContent = `${currentMatchIndex + 1} of ${findMatches.length}`;
  }

  function advanceFind(delta) {
    if (!findActive) {
      showFindBar();
      return;
    }
    if (!findQuery) {
      findInputEl.focus();
      return;
    }
    if (!findMatches.length) {
      rebuildFindMatches();
    }
    if (!findMatches.length) {
      return;
    }
    currentMatchIndex = (currentMatchIndex + delta + findMatches.length) % findMatches.length;
    updateFindStatus();
    scrollToCurrentMatch();
  }

  function scrollToCurrentMatch() {
    if (currentMatchIndex < 0 || !findMatches.length) {
      renderVisibleRows(true);
      return;
    }

    const { rowIndex } = findMatches[currentMatchIndex];
    const rowTop = prefixOffsets[rowIndex];
    const height = rowHeightAt(rowIndex);
    const viewTop = listEl.scrollTop;
    const viewBottom = viewTop + listEl.clientHeight;
    if (rowTop < viewTop || rowTop + height > viewBottom) {
      listEl.scrollTop = Math.max(0, rowTop - Math.floor(listEl.clientHeight / 3));
    }
    renderVisibleRows(true);
  }

  function rowLineCount(row) {
    if (!row || !row.fullText) {
      return 1;
    }
    return Math.max(1, row.fullText.split('\n').length);
  }

  function rowHeightAt(index) {
    return rowLineCount(rowCache.get(index)) * ROW_HEIGHT;
  }

  function rebuildLayout() {
    prefixOffsets = [0];
    for (let i = 0; i < matchCount; i++) {
      prefixOffsets.push(prefixOffsets[i] + rowHeightAt(i));
    }
    const total = prefixOffsets[matchCount] || 0;
    scrollContentEl.style.height = `${Math.max(total, listEl.clientHeight)}px`;
  }

  function updateGutterWidth() {
    const digits = String(maxLineNumber).length;
    const width = Math.max(48, digits * 9 + 28);
    document.documentElement.style.setProperty('--gutter-width', `${width}px`);
  }

  function findRowAtOffset(offset) {
    if (matchCount === 0) {
      return 0;
    }
    let lo = 0;
    let hi = matchCount - 1;
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

  function onScroll() {
    const scrollTop = listEl.scrollTop;
    if (lastScrollTop >= 0 && Math.abs(scrollTop - lastScrollTop) < 0.5) {
      return;
    }
    lastScrollTop = scrollTop;

    const start = Math.max(0, findRowAtOffset(scrollTop) - BUFFER);
    const viewEnd = scrollTop + listEl.clientHeight + BUFFER * ROW_HEIGHT;
    let end = start;
    while (end < matchCount && prefixOffsets[end] < viewEnd) {
      end++;
    }
    end = Math.min(matchCount, end + BUFFER);

    renderVisibleRows(false, start, end);
  }

  function renderVisibleRows(force, rangeStart, rangeEnd) {
    if (matchCount === 0) {
      rowsEl.replaceChildren();
      return;
    }

    const scrollTop = listEl.scrollTop;
    const scrollLeft = listEl.scrollLeft;
    const viewBottom = scrollTop + listEl.clientHeight;
    let start = rangeStart ?? Math.max(0, findRowAtOffset(Math.max(0, scrollTop - BUFFER * ROW_HEIGHT)) - BUFFER);
    let end = rangeEnd ?? start;

    if (rangeEnd === undefined) {
      while (end < matchCount && prefixOffsets[end] < viewBottom + BUFFER * ROW_HEIGHT) {
        end++;
      }
      end = Math.min(matchCount, end + 1);
    }

    ensureRows(start, end);

    if (!force && start === lastRenderedStart && end === lastRenderedEnd && rowsEl.childElementCount > 0) {
      return;
    }
    lastRenderedStart = start;
    lastRenderedEnd = end;

    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const id = i;
      const row = rowCache.get(id);

      const el = document.createElement('div');
      el.className = 'row' + (i === selectedIndex ? ' selected' : '');
      el.dataset.index = String(i);
      el.dataset.line = row ? String(row.lineNumber) : '';
      el.style.height = `${rowHeightAt(i)}px`;

      if (!row) {
        el.innerHTML =
          `<span class="gutter">…</span>` +
          `<pre class="line-text"></pre>`;
      } else {
        const lineNo = row.lineNumber + 1;
        const text = row.fullText || '';
        const showFilePrefix = selectedFileCount > 1 && row.fileName;
        const prefixHtml = showFilePrefix
          ? `<span class="file-prefix">${escapeHtml(row.fileName)}:</span>`
          : '';

        el.innerHTML =
          `<span class="gutter">${lineNo}</span>` +
          `<pre class="line-text">${prefixHtml}${highlightRowText(text, i)}</pre>`;

        el.addEventListener('click', () => selectIndex(i));
        el.addEventListener('dblclick', () => {
          selectIndex(i);
          goToSelected();
        });
      }

      fragment.appendChild(el);
    }

    rowsEl.style.transform = `translateY(${prefixOffsets[start]}px)`;
    rowsEl.replaceChildren(fragment);

    listEl.scrollTop = scrollTop;
    listEl.scrollLeft = scrollLeft;
  }

  function selectIndex(index) {
    selectedIndex = index;
    renderSelection();
    if (index >= 0 && index < matchCount) {
      vscode.postMessage({ type: 'selectEntry', id: index });
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
    const row = rowCache.get(selectedIndex);
    if (row) {
      vscode.postMessage({
        type: 'goToSource',
        line: row.lineNumber,
        sourceUri: row.sourceUri || primaryUri,
      });
      return;
    }
    pendingGoToIndex = selectedIndex;
    ensureRows(selectedIndex, selectedIndex + 1);
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

  function highlightRowText(text, rowIndex) {
    const ranges = collectQueryHighlightRanges(text);
    if (findActive && findQuery) {
      collectFindHighlightRanges(text, rowIndex, ranges);
    }
    return renderHighlightRanges(text, ranges);
  }

  function collectQueryHighlightRanges(text) {
    const ranges = [];
    if (!text || !highlightTerms.length) {
      return ranges;
    }

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
              ranges.push({ start: idx, end: idx + needle.length, className: 'match-hl' });
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
        ranges.push({ start: found, end: found + needle.length, className: 'match-hl' });
        idx = found + 1;
      }
    }
    return ranges;
  }

  function collectFindHighlightRanges(text, rowIndex, ranges) {
    const needle = findQuery.toLowerCase();
    const hay = text.toLowerCase();
    let idx = 0;
    while (idx < hay.length) {
      const found = hay.indexOf(needle, idx);
      if (found === -1) {
        break;
      }
      const current = findMatches[currentMatchIndex];
      const isCurrent =
        current &&
        current.rowIndex === rowIndex &&
        current.start === found &&
        current.end === found + needle.length;
      ranges.push({
        start: found,
        end: found + needle.length,
        className: isCurrent ? 'find-hl find-current' : 'find-hl',
      });
      idx = found + 1;
    }
  }

  function renderHighlightRanges(text, ranges) {
    if (!ranges.length) {
      return escapeHtml(text);
    }

    const points = new Set([0, text.length]);
    for (const r of ranges) {
      points.add(r.start);
      points.add(r.end);
    }
    const bounds = [...points].sort((a, b) => a - b);
    const classPriority = {
      'find-hl find-current': 3,
      'find-hl': 2,
      'match-hl': 1,
    };

    let html = '';
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i];
      const end = bounds[i + 1];
      if (start >= end) {
        continue;
      }
      let bestClass = '';
      let bestPriority = 0;
      for (const r of ranges) {
        if (r.start <= start && r.end >= end) {
          const priority = classPriority[r.className] || 0;
          if (priority > bestPriority) {
            bestPriority = priority;
            bestClass = r.className;
          }
        }
      }
      const chunk = escapeHtml(text.slice(start, end));
      html += bestClass ? `<mark class="${bestClass}">${chunk}</mark>` : chunk;
    }
    return html;
  }

  updateQuerySyntaxHighlight();
  vscode.postMessage({ type: 'ready' });
})();

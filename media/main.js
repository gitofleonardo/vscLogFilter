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
  const filterProgressEl = document.getElementById('filter-progress');
  const filterProgressFillEl = document.getElementById('filter-progress-fill');
  const filesBtnEl = document.getElementById('files-btn');
  const filesCountEl = document.getElementById('files-count');
  const filesMenuEl = document.getElementById('files-menu');
  const filesDropdownEl = document.getElementById('files-dropdown');
  const savedBtnEl = document.getElementById('saved-btn');
  const savedMenuEl = document.getElementById('saved-menu');
  const savedDropdownEl = document.getElementById('saved-dropdown');
  const savedSearchEl = document.getElementById('saved-search');
  const savedAddEl = document.getElementById('saved-add');
  const savedListEl = document.getElementById('saved-list');
  const cherryToggleEl = document.getElementById('cherry-toggle');
  const cherryResizerEl = document.getElementById('cherry-resizer');
  const cherryCountEl = document.getElementById('cherry-count');
  const cherryPaneEl = document.getElementById('cherry-pane');
  const cherryStatsEl = document.getElementById('cherry-stats');
  const cherryClearEl = document.getElementById('cherry-clear');
  const cherryListEl = document.getElementById('cherry-list');
  const cherryEmptyEl = document.getElementById('cherry-empty');
  const cherryRowsEl = document.getElementById('cherry-rows');
  const resultsSplitEl = document.getElementById('results-split');
  const contextMenuEl = document.getElementById('context-menu');

  const ROW_HEIGHT = 19;
  const BUFFER = 40;
  const CHERRY_PANE_MIN = 180;
  const CHERRY_MAIN_MIN = 240;
  const CHERRY_PANE_DEFAULT_RATIO = 0.38;

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
  let primaryUri = '';
  let selectedUris = [];
  let openFiles = [];
  let selectedFileCount = 1;
  let filesMenuOpen = false;
  let savedMenuOpen = false;
  let savedQueries = [];
  let savedActive = -1;
  let rowRequestId = 0;
  let pendingRowRequest = null;
  let filterEpoch = 0;
  let pendingGoToIndex = -1;
  let pickedKeys = new Set();
  let cherryCount = 0;
  let multiSelectedIndices = new Set();
  let selectionAnchor = -1;
  let contextMenuRowIndex = -1;
  let cherryExpanded = false;
  let cherryPaneWidth = null;
  let cherryItems = [];
  let cherrySelectedIndex = -1;
  let contextMenuKind = '';
  let mainFind;
  let cherryFind;
  const mainFindCallbacks = new Map();

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
    updateSavedAddEnabled();
    clearTimeout(queryDebounce);
    queryDebounce = setTimeout(() => {
      commitQuery();
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
      const cb = mainFindCallbacks.get(msg.requestId);
      if (cb) {
        mainFindCallbacks.delete(msg.requestId);
        cb({ matches: msg.matches || [], capped: !!msg.capped });
      }
    } else if (msg.type === 'filesState') {
      handleFilesState(msg);
    } else if (msg.type === 'savedQueriesState') {
      handleSavedQueriesState(msg);
    } else if (msg.type === 'filterProgress') {
      setFilterProgressPercent(msg.percent);
    } else if (msg.type === 'cherryUpdate') {
      handleCherryUpdate(msg);
    } else if (msg.type === 'showFind') {
      resolveFindController().show();
    } else if (msg.type === 'findNext') {
      resolveFindController().advance(1);
    } else if (msg.type === 'findPrevious') {
      resolveFindController().advance(-1);
    }
  });

  function setCherryExpanded(expanded, persist = true) {
    cherryExpanded = expanded;
    resultsSplitEl.classList.toggle('cherry-expanded', expanded);
    cherryPaneEl.classList.toggle('hidden', !expanded);
    cherryResizerEl.classList.toggle('hidden', !expanded);
    cherryPaneEl.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    cherryToggleEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    cherryToggleEl.querySelector('.cherry-toggle-icon').textContent = expanded ? '◀' : '▶';
    if (expanded) {
      const prev = vscode.getState() || {};
      applyCherryPaneWidth(prev.cherryPaneWidth ?? cherryPaneWidth ?? defaultCherryPaneWidth(), false);
    }
    if (persist) {
      const prev = vscode.getState() || {};
      vscode.setState({ ...prev, cherryExpanded: expanded, cherryPaneWidth: cherryPaneWidth ?? prev.cherryPaneWidth });
    }
  }

  function getCherryWidthLimits() {
    const total = resultsSplitEl.clientWidth;
    const chrome = cherryToggleEl.offsetWidth + cherryResizerEl.offsetWidth;
    const max = Math.max(CHERRY_PANE_MIN, total - chrome - CHERRY_MAIN_MIN);
    return { min: CHERRY_PANE_MIN, max };
  }

  function defaultCherryPaneWidth() {
    const total = resultsSplitEl.clientWidth;
    const chrome = cherryToggleEl.offsetWidth + cherryResizerEl.offsetWidth;
    return Math.round(Math.max(CHERRY_PANE_MIN, (total - chrome) * CHERRY_PANE_DEFAULT_RATIO));
  }

  function applyCherryPaneWidth(widthPx, persist = true) {
    if (!cherryExpanded) {
      return;
    }
    const { min, max } = getCherryWidthLimits();
    const w = Math.max(min, Math.min(Math.round(widthPx), max));
    cherryPaneWidth = w;
    cherryPaneEl.style.flex = '0 0 auto';
    cherryPaneEl.style.width = `${w}px`;
    if (persist) {
      const prev = vscode.getState() || {};
      vscode.setState({ ...prev, cherryPaneWidth: w });
    }
  }

  function startCherryResize(e) {
    if (!cherryExpanded) {
      return;
    }
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = cherryPaneEl.offsetWidth;
    document.body.classList.add('cherry-resizing');

    function onMove(ev) {
      const delta = startX - ev.clientX;
      applyCherryPaneWidth(startWidth + delta, false);
    }

    function onUp() {
      applyCherryPaneWidth(cherryPaneWidth ?? startWidth, true);
      document.body.classList.remove('cherry-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  cherryResizerEl.addEventListener('mousedown', startCherryResize);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (cherryExpanded && cherryPaneWidth != null) {
        applyCherryPaneWidth(cherryPaneWidth, false);
      }
    }).observe(resultsSplitEl);
  }

  function toggleCherryPane() {
    setCherryExpanded(!cherryExpanded);
  }

  function handleCherryUpdate(msg) {
    cherryCount = Number(msg.count) || 0;
    pickedKeys = new Set(Array.isArray(msg.pickedKeys) ? msg.pickedKeys : []);
    cherryItems = Array.isArray(msg.items) ? msg.items.slice() : [];
    cherryCountEl.textContent = String(cherryCount);
    cherryStatsEl.textContent = cherryCount === 1 ? '1 line' : `${cherryCount} lines`;
    cherryEmptyEl.classList.toggle('hidden', cherryItems.length > 0);
    if (cherrySelectedIndex >= cherryItems.length) {
      cherrySelectedIndex = cherryItems.length > 0 ? cherryItems.length - 1 : -1;
    }
    renderCherryRows();
    renderSelection();
    if (cherryFind) {
      cherryFind.onContentChanged();
    }
    if (msg.expand === true) {
      setCherryExpanded(true);
    }
  }

  function renderCherryRows() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < cherryItems.length; i++) {
      const item = cherryItems[i];
      const el = document.createElement('div');
      el.className = 'row' + (i === cherrySelectedIndex ? ' selected' : '');
      el.dataset.index = String(i);
      el.dataset.key = item.key;
      el.style.height = `${ROW_HEIGHT}px`;

      const lineNo = item.lineNumber + 1;
      const text = item.fullText || '';
      const prefixHtml = item.fileName ? filePrefixHtml(item.fileName) : '';

      el.innerHTML =
        `<span class="gutter">${lineNo}</span>` +
        `<pre class="line-text">${prefixHtml}${highlightCherryText(text, i, item)}</pre>`;

      el.addEventListener('click', () => selectCherryIndex(i));
      el.addEventListener('dblclick', () => goToCherryItem(item));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selectCherryIndex(i);
        showCherryContextMenu(e.clientX, e.clientY, item.key);
      });

      fragment.appendChild(el);
    }
    cherryRowsEl.replaceChildren(fragment);
  }

  function selectCherryIndex(index) {
    cherrySelectedIndex = index;
    const rows = cherryRowsEl.querySelectorAll('.row');
    rows.forEach((el) => {
      const idx = parseInt(el.dataset.index || '-1', 10);
      el.classList.toggle('selected', idx === cherrySelectedIndex);
    });
    if (index >= 0) {
      rows[index]?.scrollIntoView({ block: 'nearest' });
    }
  }

  function goToCherryItem(item) {
    vscode.postMessage({
      type: 'goToSource',
      line: item.lineNumber,
      sourceUri: item.sourceUri,
    });
  }

  function showCherryContextMenu(x, y, key) {
    contextMenuKind = 'cherry';
    contextMenuEl.replaceChildren();
    addContextMenuItem('Remove from Cherry', () => {
      vscode.postMessage({ type: 'cherryRemove', keys: [key] });
    });
    addContextMenuItem('Go to Source', () => {
      const item = cherryItems.find((it) => it.key === key);
      if (item) {
        goToCherryItem(item);
      }
    });
    addContextMenuItem('Copy Line', () => {
      const item = cherryItems.find((it) => it.key === key);
      if (item) {
        void copyCherryText(item.fullText);
      }
    });
    contextMenuEl.classList.remove('hidden');
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;
  }

  async function copyCherryText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      vscode.postMessage({ type: 'copyText', text });
    }
  }

  function highlightCherryText(text, rowIndex, row) {
    const ranges = [];
    if (cherryFind) {
      cherryFind.collectHighlightRanges(text, rowIndex, ranges);
    }
    if (text && highlightTerms.length) {
      const hl = globalThis.LogFilterHighlights;
      if (hl?.collectHighlightRanges) {
        for (const r of hl.collectHighlightRanges(text, highlightTerms, row ?? {})) {
          ranges.push({ ...r, className: 'match-hl' });
        }
      }
    }
    if (!ranges.length) {
      return escapeHtml(text);
    }
    return renderHighlightRanges(text, ranges);
  }

  function rowPickKey(row) {
    if (!row) {
      return '';
    }
    const uri = row.sourceUri || primaryUri;
    return `${uri}#${row.lineNumber}`;
  }

  function isRowPicked(index) {
    const row = rowCache.get(index);
    if (!row) {
      return false;
    }
    return pickedKeys.has(rowPickKey(row));
  }

  function clearMultiSelect() {
    multiSelectedIndices.clear();
    selectionAnchor = -1;
  }

  function setMultiSelect(indices) {
    multiSelectedIndices = new Set(indices);
    renderVisibleRows();
  }

  function handleRowClick(index, event) {
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;

    if (shift && selectionAnchor >= 0) {
      const lo = Math.min(selectionAnchor, index);
      const hi = Math.max(selectionAnchor, index);
      const next = new Set(multiSelectedIndices);
      for (let i = lo; i <= hi; i++) {
        next.add(i);
      }
      multiSelectedIndices = next;
      selectIndex(index);
      renderVisibleRows();
      return;
    }

    if (ctrlOrMeta) {
      const next = new Set(multiSelectedIndices);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      multiSelectedIndices = next;
      selectionAnchor = index;
      selectIndex(index);
      renderVisibleRows();
      return;
    }

    clearMultiSelect();
    selectionAnchor = index;
    selectIndex(index);
  }

  function pickIndices(indices) {
    const list = [...indices].filter((i) => i >= 0 && i < matchCount);
    if (!list.length) {
      return;
    }
    vscode.postMessage({ type: 'cherryPick', indices: list });
  }

  function unpickIndices(indices) {
    const keys = [];
    for (const index of indices) {
      const row = rowCache.get(index);
      if (row) {
        keys.push(rowPickKey(row));
        continue;
      }
      const el = rowsEl.querySelector(`.row[data-index="${index}"]`);
      if (el?.dataset.sourceUri && el.dataset.lineNumber !== undefined) {
        keys.push(`${el.dataset.sourceUri}#${el.dataset.lineNumber}`);
      }
    }
    if (keys.length) {
      vscode.postMessage({ type: 'cherryUnpick', keys });
    }
  }

  function hideContextMenu() {
    contextMenuEl.classList.add('hidden');
    contextMenuRowIndex = -1;
  }

  function addContextMenuItem(label, action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item';
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      action();
    });
    contextMenuEl.appendChild(btn);
  }

  function showResultsContextMenu(x, y, rowIndex) {
    contextMenuKind = 'results';
    contextMenuRowIndex = rowIndex;
    contextMenuEl.replaceChildren();

    const multiCount = multiSelectedIndices.size;
    const useMulti = multiCount > 1 && multiSelectedIndices.has(rowIndex);

    if (useMulti) {
      addContextMenuItem(`Pick ${multiCount} lines to Cherry View`, () => {
        pickIndices(multiSelectedIndices);
      });
    } else {
      const picked = isRowPicked(rowIndex);
      if (picked) {
        addContextMenuItem('Remove from Cherry View', () => {
          unpickIndices([rowIndex]);
        });
      } else {
        addContextMenuItem('Pick to Cherry View', () => {
          pickIndices([rowIndex]);
        });
      }
      addContextMenuItem('Go to Source', () => {
        selectIndex(rowIndex);
        goToSelected();
      });
    }

    contextMenuEl.classList.remove('hidden');
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;
  }

  function hideContextMenu() {
    contextMenuEl.classList.add('hidden');
    contextMenuRowIndex = -1;
    contextMenuKind = '';
  }

  cherryToggleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCherryPane();
  });

  cherryClearEl.addEventListener('click', () => {
    vscode.postMessage({ type: 'cherryClear' });
  });

  function setFilesMenuOpen(open) {
    filesMenuOpen = open;
    filesMenuEl.classList.toggle('hidden', !open);
    filesBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      setSavedMenuOpen(false);
    }
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
    if (filesMenuOpen && !filesDropdownEl.contains(e.target)) {
      setFilesMenuOpen(false);
    }
    if (savedMenuOpen && !savedDropdownEl.contains(e.target)) {
      setSavedMenuOpen(false);
    }
    hideContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') {
      return;
    }
    if (savedMenuOpen) {
      if (savedSearchEl.value) {
        savedSearchEl.value = '';
        savedActive = -1;
        renderSavedMenu();
      } else {
        setSavedMenuOpen(false);
      }
      e.preventDefault();
      return;
    }
    if (filesMenuOpen) {
      setFilesMenuOpen(false);
    }
  });

  function filterSavedQueryList(list, needle) {
    const n = String(needle || '').trim().toLowerCase();
    if (!n) {
      return list.slice();
    }
    return list.filter((item) => item.toLowerCase().includes(n));
  }

  function commitQuery() {
    clearTimeout(queryDebounce);
    vscode.postMessage({ type: 'queryChange', query: queryEl.value });
    const state = vscode.getState();
    if (state?.sourceUri) {
      vscode.setState({ ...state, query: queryEl.value });
    }
  }

  function setQueryValue(query) {
    queryEl.value = query;
    syncQueryOverlay();
    updateQuerySyntaxHighlight();
    updateEmptyStatePreview();
    updateSavedAddEnabled();
    hideSuggestions();
    queryEl.focus();
    commitQuery();
  }

  function visibleSavedQueries() {
    return filterSavedQueryList(savedQueries, savedSearchEl.value);
  }

  function updateSavedAddEnabled() {
    const current = queryEl.value.trim();
    savedAddEl.disabled = !current || savedQueries.includes(current);
  }

  function highlightSavedItems() {
    const items = savedListEl.querySelectorAll('.saved-item');
    items.forEach((el, idx) => {
      el.classList.toggle('active', idx === savedActive);
    });
    items[savedActive]?.scrollIntoView({ block: 'nearest' });
  }

  function applySavedQuery(query) {
    setSavedMenuOpen(false);
    setQueryValue(query);
  }

  function renderSavedMenu() {
    updateSavedAddEnabled();
    const filtered = visibleSavedQueries();
    const fragment = document.createDocumentFragment();

    if (savedQueries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'saved-empty';
      empty.textContent = 'No saved queries yet.';
      fragment.appendChild(empty);
    } else if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'saved-empty';
      empty.textContent = 'No matching saved queries.';
      fragment.appendChild(empty);
    } else {
      if (savedActive >= filtered.length) {
        savedActive = filtered.length - 1;
      }
      filtered.forEach((query, idx) => {
        const item = document.createElement('div');
        item.className = 'saved-item' + (idx === savedActive ? ' active' : '');
        item.setAttribute('role', 'option');
        item.title = query;

        const text = document.createElement('span');
        text.className = 'saved-item-text';
        text.textContent = query;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'saved-item-remove';
        remove.title = 'Remove saved query';
        remove.setAttribute('aria-label', 'Remove saved query');
        remove.textContent = '×';
        remove.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          vscode.postMessage({ type: 'removeSavedQuery', query });
          savedSearchEl.focus();
        });
        remove.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });

        item.addEventListener('click', () => {
          savedActive = idx;
          highlightSavedItems();
        });
        item.addEventListener('dblclick', (e) => {
          e.preventDefault();
          applySavedQuery(query);
        });

        item.appendChild(text);
        item.appendChild(remove);
        fragment.appendChild(item);
      });
    }

    savedListEl.replaceChildren(fragment);
  }

  function setSavedMenuOpen(open) {
    savedMenuOpen = open;
    savedMenuEl.classList.toggle('hidden', !open);
    savedBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      setFilesMenuOpen(false);
      hideSuggestions();
      savedSearchEl.value = '';
      savedActive = -1;
      renderSavedMenu();
      savedSearchEl.focus();
    } else {
      savedSearchEl.value = '';
      savedActive = -1;
    }
  }

  function handleSavedQueriesState(msg) {
    savedQueries = Array.isArray(msg.queries) ? msg.queries.map(String) : [];
    if (savedMenuOpen) {
      renderSavedMenu();
    } else {
      updateSavedAddEnabled();
    }
  }

  savedBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    setSavedMenuOpen(!savedMenuOpen);
  });

  savedAddEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const query = queryEl.value.trim();
    if (!query || savedQueries.includes(query)) {
      return;
    }
    vscode.postMessage({ type: 'addSavedQuery', query });
  });

  savedSearchEl.addEventListener('input', () => {
    savedActive = -1;
    renderSavedMenu();
  });

  savedSearchEl.addEventListener('keydown', (e) => {
    const filtered = visibleSavedQueries();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length === 0) {
        return;
      }
      savedActive = Math.min(savedActive + 1, filtered.length - 1);
      if (savedActive < 0) {
        savedActive = 0;
      }
      highlightSavedItems();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length === 0) {
        return;
      }
      savedActive = Math.max(savedActive - 1, 0);
      highlightSavedItems();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (savedActive >= 0 && filtered[savedActive]) {
        applySavedQuery(filtered[savedActive]);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      resolveFindController().show();
      return;
    }
    if (e.key === 'Escape') {
      const activeEl = document.activeElement;
      const mainBar = document.getElementById('main-find-bar');
      const cherryBar = document.getElementById('cherry-find-bar');
      if (cherryBar?.contains(activeEl)) {
        cherryFind?.hide();
      } else if (mainBar?.contains(activeEl)) {
        mainFind?.hide();
      } else if (cherryFind?.isActive() && cherryPaneEl.contains(activeEl)) {
        cherryFind.hide();
      } else if (mainFind?.isActive()) {
        mainFind.hide();
      }
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
    commitQuery();
  }

  function hideSuggestions() {
    suggestionsEl.classList.add('hidden');
    suggestionActive = -1;
  }

  function hideFilterProgress() {
    filterProgressEl.classList.add('hidden');
    filterProgressEl.setAttribute('aria-hidden', 'true');
    filterProgressEl.setAttribute('aria-valuenow', '0');
    filterProgressFillEl.style.width = '0%';
  }

  function setFilterProgressPercent(percent) {
    const n = Math.max(0, Math.min(99, Number(percent) || 0));
    filterProgressEl.classList.remove('hidden');
    filterProgressEl.setAttribute('aria-hidden', 'false');
    filterProgressEl.setAttribute('aria-valuenow', String(n));
    filterProgressFillEl.style.width = `${n}%`;
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
    const filtering = msg.parseState === 'filtering';
    const filteredKey = `${msg.query ?? ''}|${nextMatchCount}|${msg.parseState ?? ''}`;
    const filterChanged = !filtering && filteredKey !== lastFilteredKey;
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
      clearMultiSelect();
    }

    matchCount = nextMatchCount;
    knownTags = msg.tags || [];
    highlightTerms = msg.highlightTerms || [];
    maxLineNumber = msg.maxLineNumber || 1;
    if (!filtering) {
      selectedIndex = matchCount > 0 ? 0 : -1;
    }
    updateQuerySyntaxHighlight();
    updateSavedAddEnabled();

    const matched = msg.stats?.matched ?? 0;
    const total = msg.stats?.total ?? 0;
    const queryEmpty = !(msg.query ?? queryEl.value).trim();
    statsEl.textContent = queryEmpty ? `— / ${total}` : `${matched} / ${total}`;

    const parsing = msg.parseState === 'parsing';
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

    if (filtering) {
      setFilterProgressPercent(0);
    } else {
      hideFilterProgress();
    }

    if (msg.parseState === 'parsing') {
      progressEl.classList.remove('hidden');
      const scan = msg.scanStats;
      const percent = scan?.percent;
      if (typeof percent !== 'number' || percent <= 0) {
        progressFillEl.style.width = '0%';
      }
      if (typeof percent === 'number' && percent >= 0) {
        progressEl.classList.remove('indeterminate');
        progressFillEl.style.width = `${Math.min(100, percent)}%`;
      } else {
        progressEl.classList.add('indeterminate');
      }
      progressTextEl.textContent = scan ? formatScanStatus(scan) : 'Scanning…';
    } else {
      progressEl.classList.add('hidden');
      progressEl.classList.remove('indeterminate');
    }

    updateGutterWidth();
    if (!filtering) {
      rebuildLayout();
      if (!showEmpty) {
        renderVisibleRows(true);
      } else {
        rowsEl.replaceChildren();
      }
      renderSelection();
    }
    persistPanelState(msg);
    if (mainFind) {
      mainFind.onContentChanged();
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
    if (mainFind) {
      mainFind.afterRowsRendered();
    }
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

  function resolveFindController() {
    const el = document.activeElement;
    if (el) {
      const mainBar = document.getElementById('main-find-bar');
      const cherryBar = document.getElementById('cherry-find-bar');
      if (cherryBar?.contains(el) || cherryListEl.contains(el)) {
        return cherryFind;
      }
      if (mainBar?.contains(el) || listEl.contains(el)) {
        return mainFind;
      }
      if (cherryExpanded && cherryPaneEl.contains(el)) {
        return cherryFind;
      }
    }
    return mainFind;
  }

  function initFindControllers() {
    const fc = globalThis.LogFilterFindController;
    if (!fc?.createFindController) {
      return;
    }

    mainFind = fc.createFindController({
      barEl: document.getElementById('main-find-bar'),
      inputEl: document.getElementById('main-find-input'),
      statusEl: document.getElementById('main-find-status'),
      prevEl: document.getElementById('main-find-prev'),
      nextEl: document.getElementById('main-find-next'),
      closeEl: document.getElementById('main-find-close'),
      listEl,
      rowsEl,
      getSelectedIndex: () => selectedIndex,
      selectRow: (index, fromFind) => selectIndex(index, fromFind),
      refreshRows: () => renderVisibleRows(true),
      getScrollAnchorRow: () => findRowAtOffset(listEl.scrollTop),
      scrollRowIntoView: (rowIndex) => {
        const rowTop = prefixOffsets[rowIndex];
        const height = rowHeightAt(rowIndex);
        const viewTop = listEl.scrollTop;
        const viewBottom = viewTop + listEl.clientHeight;
        if (rowTop < viewTop || rowTop + height > viewBottom) {
          listEl.scrollTop = Math.max(0, rowTop - Math.floor(listEl.clientHeight / 3));
        }
      },
      requestMatches: (needle, requestId, cb) => {
        mainFindCallbacks.set(requestId, cb);
        vscode.postMessage({ type: 'findInResults', needle, requestId });
      },
    });

    cherryFind = fc.createFindController({
      barEl: document.getElementById('cherry-find-bar'),
      inputEl: document.getElementById('cherry-find-input'),
      statusEl: document.getElementById('cherry-find-status'),
      prevEl: document.getElementById('cherry-find-prev'),
      nextEl: document.getElementById('cherry-find-next'),
      closeEl: document.getElementById('cherry-find-close'),
      listEl: cherryListEl,
      rowsEl: cherryRowsEl,
      getSelectedIndex: () => cherrySelectedIndex,
      selectRow: (index) => selectCherryIndex(index),
      refreshRows: () => renderCherryRows(),
      getScrollAnchorRow: () => {
        if (cherryItems.length === 0) {
          return 0;
        }
        return Math.min(cherryItems.length - 1, Math.floor(cherryListEl.scrollTop / ROW_HEIGHT));
      },
      scrollRowIntoView: (rowIndex) => {
        const rowTop = rowIndex * ROW_HEIGHT;
        const viewTop = cherryListEl.scrollTop;
        const viewBottom = viewTop + cherryListEl.clientHeight;
        if (rowTop < viewTop || rowTop + ROW_HEIGHT > viewBottom) {
          cherryListEl.scrollTop = Math.max(0, rowTop - Math.floor(cherryListEl.clientHeight / 3));
        }
      },
      requestMatches: (needle, requestId, cb) => {
        void requestId;
        const result = fc.findInTextRows(cherryItems, needle);
        cb(result);
      },
    });
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
      let rowClass = 'row';
      if (i === selectedIndex) {
        rowClass += ' selected';
      }
      if (multiSelectedIndices.has(i)) {
        rowClass += ' multi-selected';
      }
      if (row && pickedKeys.has(rowPickKey(row))) {
        rowClass += ' picked';
      }
      el.className = rowClass;
      el.dataset.index = String(i);
      el.dataset.line = row ? String(row.lineNumber) : '';
      if (row) {
        el.dataset.sourceUri = row.sourceUri || primaryUri;
        el.dataset.lineNumber = String(row.lineNumber);
      }
      el.style.height = `${rowHeightAt(i)}px`;

      if (!row) {
        el.innerHTML =
          `<span class="gutter">…</span>` +
          `<pre class="line-text"></pre>`;
      } else {
        const lineNo = row.lineNumber + 1;
        const text = row.fullText || '';
        const showFilePrefix = selectedFileCount > 1 && row.fileName;
        const prefixHtml = showFilePrefix ? filePrefixHtml(row.fileName) : '';

        el.innerHTML =
          `<span class="gutter">${lineNo}</span>` +
          `<pre class="line-text">${prefixHtml}${highlightRowText(text, i, row)}</pre>`;

        el.addEventListener('click', (e) => handleRowClick(i, e));
        el.addEventListener('dblclick', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            selectIndex(i);
            pickIndices([i]);
            return;
          }
          selectIndex(i);
          goToSelected();
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (multiSelectedIndices.size <= 1 || !multiSelectedIndices.has(i)) {
            clearMultiSelect();
            selectionAnchor = i;
            selectIndex(i);
          } else {
            selectIndex(i);
          }
          showResultsContextMenu(e.clientX, e.clientY, i);
        });
      }

      fragment.appendChild(el);
    }

    rowsEl.style.transform = `translateY(${prefixOffsets[start]}px)`;
    rowsEl.replaceChildren(fragment);

    listEl.scrollTop = scrollTop;
    listEl.scrollLeft = scrollLeft;
  }

  function selectIndex(index, fromFindNav = false) {
    if (!fromFindNav) {
      findNavSynced = false;
    }
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
      el.classList.toggle('multi-selected', multiSelectedIndices.has(idx));
      const row = rowCache.get(idx);
      el.classList.toggle('picked', row ? pickedKeys.has(rowPickKey(row)) : false);
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

  function truncateDisplayFileName(name) {
    const s = String(name ?? '');
    const omitted = s.length - 6 - 6;
    if (omitted <= 3) {
      return s;
    }
    return s.slice(0, 6) + '...' + s.slice(-6);
  }

  function filePrefixHtml(fileName) {
    if (!fileName) {
      return '';
    }
    const display = truncateDisplayFileName(fileName);
    const titleAttr = display !== fileName ? ` title="${escapeHtml(fileName)}"` : '';
    return `<span class="file-prefix"${titleAttr}>${escapeHtml(display)}:</span>`;
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

  function highlightRowText(text, rowIndex, row) {
    const ranges = collectQueryHighlightRanges(text, row);
    if (mainFind) {
      mainFind.collectHighlightRanges(text, rowIndex, ranges);
    }
    return renderHighlightRanges(text, ranges);
  }

  function collectQueryHighlightRanges(text, row) {
    if (!text || !highlightTerms.length) {
      return [];
    }
    const hl = globalThis.LogFilterHighlights;
    if (!hl?.collectHighlightRanges) {
      return [];
    }
    return hl.collectHighlightRanges(text, highlightTerms, row ?? {}).map((r) => ({
      ...r,
      className: 'match-hl',
    }));
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

  initFindControllers();
  updateQuerySyntaxHighlight();
  const restored = vscode.getState();
  if (restored?.cherryPaneWidth) {
    cherryPaneWidth = restored.cherryPaneWidth;
  }
  if (restored?.cherryExpanded) {
    setCherryExpanded(true, false);
  }
  vscode.postMessage({ type: 'ready' });
})();

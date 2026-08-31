(function () {
  const MAX_FIND_MATCHES = 10000;

  function createFindController(config) {
    const {
      barEl,
      inputEl,
      statusEl,
      prevEl,
      nextEl,
      closeEl,
      listEl,
      rowsEl,
      getSelectedIndex,
      selectRow,
      refreshRows,
      requestMatches,
      scrollRowIntoView,
      getScrollAnchorRow,
    } = config;

    let active = false;
    let query = '';
    let matches = [];
    let currentMatchIndex = -1;
    let findNavSynced = false;
    let requestId = 0;
    let debounceTimer;
    let lastCapped = false;

    function isActive() {
      return active;
    }

    function containsFocus() {
      const activeEl = document.activeElement;
      return (
        barEl.contains(activeEl) ||
        listEl.contains(activeEl) ||
        (activeEl && activeEl.closest && listEl === activeEl.closest('#list, #cherry-list'))
      );
    }

    function updateStatus() {
      if (!query) {
        statusEl.textContent = '';
        return;
      }
      if (matches.length === 0) {
        statusEl.textContent = 'No results';
        return;
      }
      if (lastCapped) {
        statusEl.textContent = `${currentMatchIndex + 1} of ${matches.length}+`;
        return;
      }
      statusEl.textContent = `${currentMatchIndex + 1} of ${matches.length}`;
    }

    function show() {
      barEl.classList.remove('hidden');
      active = true;
      inputEl.focus();
      inputEl.select();
      if (query) {
        rebuildMatches();
      }
    }

    function hide() {
      barEl.classList.add('hidden');
      active = false;
      matches = [];
      currentMatchIndex = -1;
      findNavSynced = false;
      lastCapped = false;
      updateStatus();
      refreshRows();
    }

    function rebuildMatches() {
      matches = [];
      if (!query) {
        lastCapped = false;
        updateStatus();
        refreshRows();
        return;
      }
      statusEl.textContent = 'Searching…';
      const id = ++requestId;
      requestMatches(query, id, (result) => {
        if (id !== requestId) {
          return;
        }
        matches = result.matches || [];
        lastCapped = !!result.capped;
        if (matches.length === 0) {
          currentMatchIndex = -1;
          findNavSynced = false;
        } else if (currentMatchIndex < 0 || currentMatchIndex >= matches.length) {
          currentMatchIndex = 0;
          findNavSynced = false;
        }
        updateStatus();
        if (matches.length > 0) {
          scrollToCurrent();
        } else {
          refreshRows();
        }
      });
    }

    function getAnchor() {
      const nav = globalThis.LogFilterFindNav;
      const fallbackRow = getScrollAnchorRow ? getScrollAnchorRow() : 0;
      const rowIndex = getSelectedIndex() >= 0 ? getSelectedIndex() : fallbackRow;
      if (!nav?.resolveMatchFromAnchor || !matches.length) {
        return { rowIndex, offset: 0 };
      }
      return { rowIndex, offset: 0 };
    }

    function computeNext() {
      const nav = globalThis.LogFilterFindNav;
      if (!nav?.computeNextFindIndex) {
        return matches.length ? 0 : -1;
      }
      const current =
        currentMatchIndex >= 0 && currentMatchIndex < matches.length
          ? matches[currentMatchIndex]
          : null;
      return nav.computeNextFindIndex(
        matches,
        getAnchor(),
        current,
        getSelectedIndex(),
        findNavSynced,
      );
    }

    function computePrev() {
      const nav = globalThis.LogFilterFindNav;
      if (!nav?.computePrevFindIndex) {
        return matches.length - 1;
      }
      const current =
        currentMatchIndex >= 0 && currentMatchIndex < matches.length
          ? matches[currentMatchIndex]
          : null;
      return nav.computePrevFindIndex(
        matches,
        getAnchor(),
        current,
        getSelectedIndex(),
        findNavSynced,
      );
    }

    function advance(delta) {
      if (!active) {
        show();
        return;
      }
      if (!query) {
        inputEl.focus();
        return;
      }
      if (!matches.length) {
        rebuildMatches();
      }
      if (!matches.length) {
        return;
      }
      currentMatchIndex = delta > 0 ? computeNext() : computePrev();
      findNavSynced = true;
      updateStatus();
      scrollToCurrent();
    }

    function scrollToCurrent() {
      if (currentMatchIndex < 0 || !matches.length) {
        refreshRows();
        return;
      }
      const { rowIndex } = matches[currentMatchIndex];
      scrollRowIntoView(rowIndex);
      selectRow(rowIndex, true);
      findNavSynced = true;
      refreshRows();
      queueScrollHorizontal();
    }

    function queueScrollHorizontal() {
      requestAnimationFrame(() => {
        if (scrollMatchHorizontal()) {
          return;
        }
        requestAnimationFrame(() => scrollMatchHorizontal());
      });
    }

    function scrollMatchHorizontal() {
      if (currentMatchIndex < 0 || !matches.length) {
        return false;
      }
      const { rowIndex } = matches[currentMatchIndex];
      const rowEl = rowsEl.querySelector(`.row[data-index="${rowIndex}"]`);
      if (!rowEl) {
        return false;
      }
      const markEl = rowEl.querySelector('mark.find-current');
      if (!markEl) {
        return false;
      }
      const listRect = listEl.getBoundingClientRect();
      const markRect = markEl.getBoundingClientRect();
      const viewWidth = listEl.clientWidth;
      let delta = 0;
      if (markRect.width > viewWidth) {
        delta = markRect.left - listRect.left;
      } else if (markRect.left < listRect.left) {
        delta = markRect.left - listRect.left;
      } else if (markRect.right > listRect.right) {
        delta = markRect.right - listRect.right;
      }
      if (delta !== 0) {
        listEl.scrollLeft = Math.max(0, listEl.scrollLeft + delta);
      }
      return true;
    }

    function collectHighlightRanges(text, rowIndex, ranges) {
      if (!active || !query) {
        return;
      }
      const needle = query.toLowerCase();
      const hay = text.toLowerCase();
      let idx = 0;
      while (idx < hay.length) {
        const found = hay.indexOf(needle, idx);
        if (found === -1) {
          break;
        }
        const current = matches[currentMatchIndex];
        const isCurrent =
          current &&
          current.rowIndex === rowIndex &&
          current.start === found &&
          current.end === found + query.length;
        ranges.push({
          start: found,
          end: found + query.length,
          className: isCurrent ? 'find-hl find-current' : 'find-hl',
        });
        idx = found + 1;
      }
    }

    function onContentChanged() {
      if (active && query) {
        currentMatchIndex = -1;
        findNavSynced = false;
        rebuildMatches();
      }
    }

    function afterRowsRendered() {
      if (active && currentMatchIndex >= 0) {
        queueScrollHorizontal();
      }
    }

    inputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        query = inputEl.value;
        currentMatchIndex = -1;
        findNavSynced = false;
        rebuildMatches();
      }, 100);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        advance(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hide();
      }
    });

    prevEl.addEventListener('click', () => advance(-1));
    nextEl.addEventListener('click', () => advance(1));
    closeEl.addEventListener('click', () => hide());

    return {
      isActive,
      containsFocus,
      show,
      hide,
      advance,
      collectHighlightRanges,
      onContentChanged,
      afterRowsRendered,
    };
  }

  function findInTextRows(rows, needle) {
    if (!needle) {
      return { matches: [], capped: false };
    }
    const lower = needle.toLowerCase();
    const matches = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const hay = String(rows[rowIndex].fullText || '').toLowerCase();
      let idx = 0;
      while (idx < hay.length) {
        const found = hay.indexOf(lower, idx);
        if (found === -1) {
          break;
        }
        matches.push({ rowIndex, start: found, end: found + needle.length });
        if (matches.length >= MAX_FIND_MATCHES) {
          return { matches, capped: true };
        }
        idx = found + 1;
      }
    }
    return { matches, capped: false };
  }

  globalThis.LogFilterFindController = {
    createFindController,
    findInTextRows,
  };
})();

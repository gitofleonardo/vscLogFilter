import * as vscode from 'vscode';
import type { LogEntry, ParseResult } from '../types';
import { getLogFilterSettings } from '../config';
import { extractHighlightTerms } from '../query';
import { getWebviewHtml } from './webviewHtml';
import { WorkerParser, type IndexSource } from './workerParser';
import { inFlightFilterPercent } from '../worker/filterProgress';
import { LOG_FILTER_PANEL_VIEW_TYPE, type LogFilterPanelState } from './panelState';
import { CherryPickStore } from './CherryPickStore';
import { cherryPickItemFromRow } from './cherryPickTypes';
import { chooseParseSource } from './parseSource';
import { goToSourceLine } from './goToSourceLine';
import { listOpenTextTabs, type OpenTextTabInfo } from '../openTextTabs';
import { shortFileNameFromFsPath, shortFileNameFromUriString } from '../uriUtils';
import { logError, logInfo } from '../logChannel';
import { SavedQueriesStore, type SavedQueriesAccess } from './savedQueries';
import {
  arraysEqual,
  mergeFileOrder,
  normalizePreferredSelected,
  selectedUrisInFileOrder,
} from './fileOrder';
import {
  createSubPanel,
  initialSubPanels,
  newSubPanelId,
  tabLabel,
  toPersistedSubPanels,
  type SubPanelRuntime,
} from './subPanels';

export { LOG_FILTER_PANEL_VIEW_TYPE };

function shortFileName(uriString: string): string {
  try {
    const uri = vscode.Uri.parse(uriString);
    if (uri.scheme === 'file') {
      return shortFileNameFromFsPath(uri.fsPath);
    }
    return shortFileNameFromFsPath(uri.path) || shortFileNameFromUriString(uriString);
  } catch {
    return shortFileNameFromUriString(uriString);
  }
}

export class LogFilterSession {
  readonly uri: vscode.Uri;
  panel: vscode.WebviewPanel;
  sourceViewColumn: vscode.ViewColumn;
  subPanels: SubPanelRuntime[] = [];
  activeSubPanelId = '';
  /** Always includes primary `uri`; extras are optional open tabs. */
  selectedUris: string[] = [];
  /** User-defined order of all open files in the Files menu. */
  fileOrder: string[] = [];
  entries: LogEntry[] = [];
  filteredIds: number[] = [];
  parseState: 'idle' | 'parsing' | 'ready' | 'error' | 'filtering' = 'idle';
  matchedCount = 0;
  private filterMaxLineNumber = 1;
  private sourceWarnings: string[] = [];
  parseResult?: ParseResult;
  version = 0;
  warnings: string[] = [];
  private openFiles: OpenTextTabInfo[] = [];
  /** Persisted extras to re-apply when tabs finish restoring after reload. */
  private preferredSelectedUris: string[] = [];
  private preferSettleTimer?: ReturnType<typeof setTimeout>;
  private scanStats?: { linesProcessed: number; entryCount: number; percent?: number };
  private lastScanUiMs = 0;
  private cachedTags: string[] = [];
  private disposables: vscode.Disposable[] = [];
  private parseTimer?: ReturnType<typeof setTimeout>;
  private queryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private filteringSubPanelId?: string;
  private workerParser: WorkerParser;
  /** Suppress reparse from syncOpenFiles during construction / first paint. */
  private allowSyncReparse = false;
  readonly cherryStore = new CherryPickStore();

  constructor(
    uri: vscode.Uri,
    panel: vscode.WebviewPanel,
    sourceViewColumn: vscode.ViewColumn,
    private extensionUri: vscode.Uri,
    private context: vscode.ExtensionContext,
    private onPersist?: () => void,
    initialQuery = '',
    initialSelectedUris: string[] = [],
    initialFileOrder: string[] = [],
    persistedSubPanels?: import('./subPanels').SubPanelState[],
    persistedActiveSubPanelId?: string,
    private savedQueriesAccess?: SavedQueriesAccess,
    private onSavedQueriesChanged?: (queries: string[]) => void,
  ) {
    this.uri = uri;
    this.panel = panel;
    this.sourceViewColumn = sourceViewColumn;
    const restored = initialSubPanels(
      initialQuery,
      persistedSubPanels,
      persistedActiveSubPanelId,
    );
    this.subPanels = restored.panels;
    this.activeSubPanelId = restored.activeSubPanelId;
    const primary = uri.toString();
    this.selectedUris = [primary];
    this.fileOrder = initialFileOrder.slice();
    this.preferredSelectedUris = normalizePreferredSelected(primary, initialSelectedUris);
    this.workerParser = new WorkerParser(context.extensionPath);

    panel.webview.html = getWebviewHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.syncOpenFiles(listOpenTextTabs());
    this.allowSyncReparse = true;
    // After reload, tabs may appear slightly after panel revive — keep preferred
    // extras briefly so they can reattach when their tabs show up.
    this.preferSettleTimer = setTimeout(() => {
      this.preferredSelectedUris = [];
      this.syncOpenFiles(listOpenTextTabs());
    }, 2500);
    void this.startParsing();
  }

  private primaryUriString(): string {
    return this.uri.toString();
  }

  activeSubPanel(): SubPanelRuntime {
    const found = this.subPanels.find((p) => p.id === this.activeSubPanelId);
    if (found) {
      return found;
    }
    if (this.subPanels.length > 0) {
      return this.subPanels[0];
    }
    const fallback = createSubPanel('default', '');
    this.subPanels = [fallback];
    this.activeSubPanelId = fallback.id;
    return fallback;
  }

  subPanelById(id: string): SubPanelRuntime | undefined {
    return this.subPanels.find((p) => p.id === id);
  }

  get query(): string {
    return this.activeSubPanel().query;
  }

  includesUri(uri: vscode.Uri | string): boolean {
    const key = typeof uri === 'string' ? uri : uri.toString();
    return this.selectedUris.includes(key);
  }

  private async startParsing(): Promise<void> {
    void this.reparse();
  }

  private findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  }

  private async ensureDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
    const existing = this.findOpenDocument(uri);
    if (existing) {
      return existing;
    }
    return vscode.workspace.openTextDocument(uri);
  }

  updateSourceColumn(col: vscode.ViewColumn): void {
    this.sourceViewColumn = col;
    this.persist();
  }

  reveal(): void {
    this.panel.reveal(this.panel.viewColumn, true);
  }

  showFind(): void {
    void this.panel.webview.postMessage({ type: 'showFind' });
  }

  findNext(): void {
    void this.panel.webview.postMessage({ type: 'findNext' });
  }

  findPrevious(): void {
    void this.panel.webview.postMessage({ type: 'findPrevious' });
  }

  setSubPanelQuery(subPanelId: string, query: string): void {
    const panel = this.subPanelById(subPanelId);
    if (!panel) {
      return;
    }
    panel.query = query;
    this.scheduleFilter(subPanelId);
  }

  setQuery(query: string): void {
    this.setSubPanelQuery(this.activeSubPanelId, query);
  }

  clearQuery(): void {
    this.setSubPanelQuery(this.activeSubPanelId, '');
    void this.applyFilter(this.activeSubPanelId);
    this.postUpdate();
    this.persist();
  }

  addSubPanel(): string {
    const id = newSubPanelId();
    this.subPanels.push(createSubPanel(id, ''));
    this.activeSubPanelId = id;
    this.pushSubPanelsState();
    this.postUpdate();
    this.persist();
    return id;
  }

  closeSubPanel(subPanelId: string): void {
    if (this.subPanels.length <= 1) {
      return;
    }
    const idx = this.subPanels.findIndex((p) => p.id === subPanelId);
    if (idx < 0) {
      return;
    }
    this.subPanels.splice(idx, 1);
    this.workerParser.clearViewFilter(subPanelId);
    this.cherryStore.clearSubPanel(subPanelId);
    const timer = this.queryTimers.get(subPanelId);
    if (timer) {
      clearTimeout(timer);
      this.queryTimers.delete(subPanelId);
    }
    if (this.activeSubPanelId === subPanelId) {
      this.activeSubPanelId = this.subPanels[Math.max(0, idx - 1)].id;
      this.syncActivePanelFromCache();
    }
    this.pushSubPanelsState();
    this.postUpdate();
    this.persist();
  }

  activateSubPanel(subPanelId: string): void {
    if (!this.subPanelById(subPanelId)) {
      return;
    }
    this.activeSubPanelId = subPanelId;
    this.syncActivePanelFromCache();
    this.pushSubPanelsState();
    this.postUpdate();
    void this.prefetchActiveRows();
  }

  private syncActivePanelFromCache(): void {
    const active = this.activeSubPanel();
    this.matchedCount = active.matchedCount;
    this.filterMaxLineNumber = active.maxLineNumber;
  }

  private pushSubPanelsState(): void {
    void this.panel.webview.postMessage({
      type: 'subPanelsState',
      subPanels: this.subPanels.map((p, i) => ({
        id: p.id,
        query: p.query,
        matchedCount: p.matchedCount,
        label: tabLabel(p, i),
      })),
      activeSubPanelId: this.activeSubPanelId,
    });
  }

  /** Replace open-file dropdown options from currently open text tabs. */
  syncOpenFiles(openFiles: OpenTextTabInfo[]): void {
    try {
      const primary = this.primaryUriString();
      const byUri = new Map(openFiles.map((f) => [f.uri, f]));
      if (!byUri.has(primary)) {
        byUri.set(primary, { uri: primary, fileName: shortFileName(primary) });
      }

      const ordered: OpenTextTabInfo[] = [];
      const seen = new Set<string>();
      const push = (info: OpenTextTabInfo | undefined) => {
        if (!info || seen.has(info.uri)) {
          return;
        }
        seen.add(info.uri);
        ordered.push(info);
      };
      push(byUri.get(primary));
      for (const f of openFiles) {
        push(f);
      }
      this.openFiles = ordered;

      const openSet = new Set(ordered.map((f) => f.uri));
      const openUris = ordered.map((f) => f.uri);
      const nextFileOrder = mergeFileOrder(this.fileOrder, openUris, primary);
      const fileOrderChanged = !arraysEqual(nextFileOrder, this.fileOrder);
      this.fileOrder = nextFileOrder;

      const candidates = [...this.selectedUris, ...this.preferredSelectedUris];
      const next = selectedUrisInFileOrder(nextFileOrder, candidates, primary, openSet);

      const selectionChanged =
        next.length !== this.selectedUris.length ||
        next.some((u, i) => u !== this.selectedUris[i]);
      this.selectedUris = next;
      this.pushFilesState();
      if (selectionChanged || fileOrderChanged) {
        this.persist();
        if (selectionChanged && this.allowSyncReparse) {
          this.scheduleReparse();
        }
      }
    } catch (err) {
      logError('syncOpenFiles failed', err);
    }
  }

  setSelectedUris(uris: string[]): void {
    const primary = this.primaryUriString();
    const openSet = new Set(this.openFiles.map((f) => f.uri));
    const next = selectedUrisInFileOrder(this.fileOrder, uris, primary, openSet);
    this.preferredSelectedUris = next.filter((u) => u !== primary);
    const changed =
      next.length !== this.selectedUris.length ||
      next.some((u, i) => u !== this.selectedUris[i]);
    if (!changed) {
      this.pushFilesState();
      return;
    }
    this.selectedUris = next;
    this.pushFilesState();
    this.persist();
    this.scheduleReparse();
  }

  setFileOrder(order: string[]): void {
    const primary = this.primaryUriString();
    const openUris = this.openFiles.map((f) => f.uri);
    const openSet = new Set(openUris);
    const nextOrder = mergeFileOrder(order, openUris, primary);
    const selectedSet = new Set(this.selectedUris);
    selectedSet.add(primary);
    const nextSelected = selectedUrisInFileOrder(
      nextOrder,
      [...selectedSet],
      primary,
      openSet,
    );

    const orderChanged = !arraysEqual(nextOrder, this.fileOrder);
    const selectionOrderChanged = !arraysEqual(nextSelected, this.selectedUris);

    this.fileOrder = nextOrder;
    this.selectedUris = nextSelected;
    this.pushFilesState();

    if (orderChanged || selectionOrderChanged) {
      this.persist();
    }
    if (selectionOrderChanged) {
      this.scheduleReparse();
    }
  }

  /** Remove an extra selected URI (no-op for primary). Returns whether selection changed. */
  removeSelectedUri(uri: vscode.Uri | string, opts?: { reparse?: boolean }): boolean {
    const key = typeof uri === 'string' ? uri : uri.toString();
    if (key === this.primaryUriString()) {
      return false;
    }
    this.preferredSelectedUris = this.preferredSelectedUris.filter((u) => u !== key);
    const before = this.selectedUris.length;
    this.selectedUris = this.selectedUris.filter((u) => u !== key);
    if (this.selectedUris.length === before) {
      return false;
    }
    this.pushFilesState();
    this.persist();
    if (opts?.reparse !== false) {
      this.scheduleReparse();
    }
    return true;
  }

  /** Drop a selected extra when its file was deleted/renamed away. */
  onSourceGone(uri: vscode.Uri | string): boolean {
    return this.removeSelectedUri(uri);
  }

  private pushFilesState(): void {
    void this.panel.webview.postMessage({
      type: 'filesState',
      primaryUri: this.primaryUriString(),
      selectedUris: this.selectedUris,
      fileOrder: this.fileOrder,
      openFiles: this.openFiles,
    });
  }

  pushSavedQueries(queries?: string[]): void {
    const list = queries ?? this.savedQueriesAccess?.list() ?? [];
    void this.panel.webview.postMessage({
      type: 'savedQueriesState',
      queries: list,
    });
  }

  private onMessage(msg: { type: string; [k: string]: unknown }): void {
    switch (msg.type) {
      case 'ready':
        this.pushFilesState();
        this.pushSavedQueries();
        this.pushSubPanelsState();
        this.pushCherryView();
        break;
      case 'queryChange': {
        const subPanelId = String(msg.subPanelId ?? this.activeSubPanelId);
        this.setSubPanelQuery(subPanelId, String(msg.query ?? ''));
        this.persist();
        break;
      }
      case 'subPanelAdd':
        this.addSubPanel();
        break;
      case 'subPanelClose': {
        const id = String(msg.subPanelId ?? '');
        if (id) {
          this.closeSubPanel(id);
        }
        break;
      }
      case 'subPanelActivate': {
        const id = String(msg.subPanelId ?? '');
        if (id) {
          this.activateSubPanel(id);
        }
        break;
      }
      case 'addSavedQuery': {
        if (!this.savedQueriesAccess) {
          break;
        }
        const next = this.savedQueriesAccess.add(String(msg.query ?? ''));
        this.onSavedQueriesChanged?.(next);
        break;
      }
      case 'removeSavedQuery': {
        if (!this.savedQueriesAccess) {
          break;
        }
        const next = this.savedQueriesAccess.remove(String(msg.query ?? ''));
        this.onSavedQueriesChanged?.(next);
        break;
      }
      case 'filesSelectionChange': {
        const uris = Array.isArray(msg.uris) ? msg.uris.map(String) : [];
        this.setSelectedUris(uris);
        break;
      }
      case 'filesOrderChange': {
        const order = Array.isArray(msg.order) ? msg.order.map(String) : [];
        this.setFileOrder(order);
        break;
      }
      case 'goToSource':
        void this.goToSource(Number(msg.line), msg.sourceUri ? String(msg.sourceUri) : undefined);
        break;
      case 'requestRows':
        void this.handleRequestRows(
          Number(msg.start),
          Number(msg.end),
          Number(msg.requestId),
          msg.subPanelId ? String(msg.subPanelId) : this.activeSubPanelId,
        );
        break;
      case 'findInResults':
        void this.handleFindInResults(
          String(msg.needle ?? ''),
          Number(msg.requestId),
          msg.subPanelId ? String(msg.subPanelId) : this.activeSubPanelId,
        );
        break;
      case 'selectEntry':
        break;
      case 'cherryPick':
        void this.handleCherryPick(
          Array.isArray(msg.indices) ? msg.indices.map(Number).filter(Number.isFinite) : [],
        );
        break;
      case 'cherryUnpick':
      case 'cherryRemove': {
        const keys = Array.isArray(msg.keys) ? msg.keys.map(String) : [];
        this.handleCherryUnpick(keys);
        break;
      }
      case 'cherryClear':
        this.clearCherryPicks();
        break;
      case 'copyText':
        void vscode.env.clipboard.writeText(String(msg.text ?? ''));
        break;
    }
  }

  private pushCherryView(opts?: { expand?: boolean }): void {
    const subPanelId = this.activeSubPanelId;
    void this.panel.webview.postMessage({
      type: 'cherryUpdate',
      pickedKeys: this.cherryStore.pickedKeys(subPanelId),
      count: this.cherryStore.count(subPanelId),
      items: this.cherryStore.listSorted(subPanelId),
      highlightTerms: extractHighlightTerms(this.activeSubPanel().query),
      expand: opts?.expand === true,
    });
  }

  private async handleCherryPick(indices: number[]): Promise<void> {
    if (!indices.length || !this.workerParser.isIndexed) {
      return;
    }
    const unique = [...new Set(indices)].filter((i) => i >= 0).sort((a, b) => a - b);
    let added = 0;
    let duplicates = 0;
    const primary = this.primaryUriString();

    for (const idx of unique) {
      try {
        const rows = await this.workerParser.getRows(idx, idx + 1, this.activeSubPanelId);
        const row = rows[0];
        if (!row) {
          continue;
        }
        const item = cherryPickItemFromRow(row, primary);
        if (this.cherryStore.add(item, this.activeSubPanelId)) {
          added++;
        } else {
          duplicates++;
        }
      } catch (err) {
        logError('cherryPick getRows failed', err);
      }
    }

    if (added === 0 && duplicates > 0) {
      void vscode.window.showInformationMessage('Already in Cherry View.');
    }

    if (added > 0) {
      this.pushCherryView({ expand: true });
    } else {
      this.pushCherryView();
    }
  }

  private handleCherryUnpick(keys: string[]): void {
    if (!keys.length) {
      return;
    }
    this.cherryStore.removeMany(keys, this.activeSubPanelId);
    this.pushCherryView();
  }

  private clearCherryPicks(): void {
    if (this.cherryStore.count(this.activeSubPanelId) === 0) {
      return;
    }
    this.cherryStore.clearSubPanel(this.activeSubPanelId);
    this.pushCherryView();
  }

  private disposeCherry(): void {
    this.cherryStore.clear();
  }

  private scheduleFilter(subPanelId: string): void {
    const existing = this.queryTimers.get(subPanelId);
    if (existing) {
      clearTimeout(existing);
    }
    const { queryDebounceMs } = getLogFilterSettings();
    const timer = setTimeout(() => void this.applyFilter(subPanelId), queryDebounceMs);
    this.queryTimers.set(subPanelId, timer);
  }

  private async applyAllFilters(): Promise<void> {
    for (const panel of this.subPanels) {
      if (!panel.query.trim()) {
        panel.matchedCount = 0;
        panel.maxLineNumber = 1;
        await this.workerParser.filterQuery('', panel.id, ++panel.filterGeneration);
        continue;
      }
      await this.applyFilter(panel.id);
    }
    this.syncActivePanelFromCache();
    this.postUpdate();
    void this.prefetchActiveRows();
  }

  private async prefetchActiveRows(): Promise<void> {
    const active = this.activeSubPanel();
    if (!this.workerParser.isIndexed || active.matchedCount <= 0) {
      return;
    }
    try {
      const initialRows = await this.workerParser.getRows(
        0,
        Math.min(80, active.matchedCount),
        active.id,
      );
      if (initialRows.length > 0) {
        void this.panel.webview.postMessage({
          type: 'rows',
          requestId: -1,
          subPanelId: active.id,
          start: 0,
          end: initialRows.length,
          rows: initialRows,
        });
      }
    } catch (err) {
      logError('prefetch rows failed', err);
    }
  }

  scheduleReparse(): void {
    if (this.parseTimer) {
      clearTimeout(this.parseTimer);
    }
    this.workerParser.invalidate();
    const { parseDebounceMs } = getLogFilterSettings();
    this.parseTimer = setTimeout(() => void this.reparse(), parseDebounceMs);
  }

  private cacheKeyForSources(parts: Array<{ uri: string; mtimeMs: number }>): string {
    return parts.map((p) => `${p.uri}:${p.mtimeMs}`).join('|');
  }

  private metaToParseResult(meta: {
    totalEntries: number;
    fileMaxTime?: number;
    format: ParseResult['format'];
    tags: string[];
  }): ParseResult {
    return {
      entries: [],
      totalEntries: meta.totalEntries,
      fileMaxTime: meta.fileMaxTime,
      format: meta.format,
      tags: meta.tags,
    };
  }

  private async buildIndexSources(
    currentVersion: number,
  ): Promise<{ sources: IndexSource[]; cacheKey: string; totalBytes: number; skipped: string[] }> {
    const sources: IndexSource[] = [];
    const keyParts: Array<{ uri: string; mtimeMs: number }> = [];
    const skipped: string[] = [];
    let totalBytes = 0;
    const primary = this.primaryUriString();

    for (const uriString of [...this.selectedUris]) {
      const uri = vscode.Uri.parse(uriString);
      const openDoc = this.findOpenDocument(uri);

      let stat: vscode.FileStat | undefined;
      try {
        stat = await vscode.workspace.fs.stat(uri);
      } catch {
        // Open untitled/dirty docs can still be indexed without a disk file.
        if (!openDoc || openDoc.isClosed) {
          if (uriString === primary) {
            throw new Error(`Primary log file is missing: ${shortFileName(uriString)}`);
          }
          skipped.push(uriString);
          continue;
        }
      }

      if (currentVersion !== this.version) {
        throw new Error('Parse cancelled');
      }

      const fileSize = stat?.size ?? 0;
      const mtime = stat?.mtime ?? Date.now();
      totalBytes += fileSize;
      keyParts.push({ uri: uriString, mtimeMs: mtime });

      const source = chooseParseSource(uri.scheme, openDoc, fileSize);
      if (source === 'disk' && stat) {
        sources.push({
          kind: 'file',
          sourceUri: uriString,
          filePath: uri.fsPath,
          fileSize: stat.size,
          fileMtimeMs: stat.mtime,
        });
      } else {
        sources.push({
          kind: 'document',
          sourceUri: uriString,
          doc: openDoc ?? (await this.ensureDocument(uri)),
          fileMtimeMs: mtime,
        });
      }
    }

    for (const uriString of skipped) {
      this.removeSelectedUri(uriString, { reparse: false });
    }

    if (currentVersion !== this.version) {
      throw new Error('Parse cancelled');
    }

    if (sources.length === 0) {
      throw new Error('No readable log sources to index');
    }

    return { sources, cacheKey: this.cacheKeyForSources(keyParts), totalBytes, skipped };
  }

  private async reparse(): Promise<void> {
    this.version++;
    const currentVersion = this.version;
    this.parseState = 'parsing';
    this.scanStats = undefined;
    this.postUpdate();

    try {
      const { sources, cacheKey, totalBytes, skipped } = await this.buildIndexSources(currentVersion);
      this.sourceWarnings =
        skipped.length > 0
          ? [`Skipped missing file(s): ${skipped.map(shortFileName).join(', ')}`]
          : [];
      if (this.sourceWarnings.length > 0) {
        logInfo(this.sourceWarnings[0]);
      }

      const { confirmBeforeParseBytes } = getLogFilterSettings();
      if (confirmBeforeParseBytes > 0 && totalBytes >= confirmBeforeParseBytes) {
        const choice = await vscode.window.showWarningMessage(
          `Log files are large (${formatSize(totalBytes)}). Parsing may take a while.`,
          'Continue',
          'Cancel',
        );
        if (choice !== 'Continue') {
          this.parseState = 'error';
          this.postUpdate();
          return;
        }
      }

      if (this.workerParser.matchesCache(cacheKey)) {
        const meta = this.workerParser.getIndexMeta()!;
        this.parseResult = this.metaToParseResult(meta);
        this.cachedTags = meta.tags;
        this.parseState = 'ready';
        this.scanStats = undefined;
        logInfo(
          `Reused indexed log (${meta.totalEntries} entries) for ${this.selectedUris.length} file(s)`,
        );
        await this.applyAllFilters();
        return;
      }

      logInfo(`Indexing ${this.selectedUris.length} file(s) (${formatSize(totalBytes)})`);

      const onScan = (scan: { linesProcessed: number; entryCount: number; percent?: number }) => {
        if (currentVersion !== this.version) {
          return;
        }
        const now = Date.now();
        if (now - this.lastScanUiMs < 300) {
          return;
        }
        this.lastScanUiMs = now;
        this.scanStats = scan;
        this.postUpdate();
      };

      const meta = await this.workerParser.buildIndexFromSources(
        cacheKey,
        sources,
        currentVersion,
        onScan,
      );

      if (currentVersion !== this.version) {
        return;
      }

      this.parseResult = this.metaToParseResult(meta);
      this.cachedTags = meta.tags;
      this.entries = [];
      this.filteredIds = [];
      this.matchedCount = 0;
      this.filterMaxLineNumber = 1;
      this.parseState = 'ready';
      this.scanStats = undefined;
      logInfo(
        `Indexed ${meta.totalEntries} entries (${meta.format}) from ${this.selectedUris.length} file(s)`,
      );
      await this.applyAllFilters();
    } catch (err) {
      if (currentVersion !== this.version) {
        return;
      }
      const message = String(err);
      if (message.includes('Parse cancelled') || message.includes('Stale parse result')) {
        return;
      }
      this.parseState = 'error';
      this.warnings = [message];
      logError(`Parse failed for ${this.uri.fsPath}`, err);
      this.postUpdate();
    }
  }

  private async applyFilter(subPanelId: string): Promise<void> {
    if (
      (this.parseState !== 'ready' && this.parseState !== 'filtering') ||
      !this.workerParser.isIndexed
    ) {
      return;
    }

    const panel = this.subPanelById(subPanelId);
    if (!panel) {
      return;
    }

    if (!panel.query.trim()) {
      panel.matchedCount = 0;
      panel.maxLineNumber = 1;
      this.entries = [];
      this.filteredIds = [];
      if (subPanelId === this.activeSubPanelId) {
        this.matchedCount = 0;
        this.filterMaxLineNumber = 1;
        this.warnings = [...this.sourceWarnings];
        this.parseState = 'ready';
        this.filteringSubPanelId = undefined;
        this.postUpdate();
      }
      await this.workerParser.filterQuery('', subPanelId, ++panel.filterGeneration);
      return;
    }

    this.parseState = 'filtering';
    this.filteringSubPanelId = subPanelId;
    if (subPanelId === this.activeSubPanelId) {
      this.postUpdate();
    }
    const gen = ++panel.filterGeneration;
    const started = Date.now();
    try {
      const result = await this.workerParser.filterQuery(
        panel.query,
        subPanelId,
        gen,
        (processed, total) => {
          if (gen !== panel.filterGeneration) {
            return;
          }
          if (subPanelId !== this.activeSubPanelId) {
            return;
          }
          void this.panel.webview.postMessage({
            type: 'filterProgress',
            percent: inFlightFilterPercent(processed, total),
            subPanelId,
          });
        },
      );
      if (gen !== panel.filterGeneration) {
        return;
      }
      panel.matchedCount = result.matchedCount;
      panel.maxLineNumber = result.maxLineNumber || 1;
      this.entries = [];
      this.filteredIds = [];
      this.warnings = [...this.sourceWarnings, ...(result.filterWarnings ?? [])];
      this.parseState = 'ready';
      this.filteringSubPanelId = undefined;
      logInfo(
        `Filter [${subPanelId}] "${panel.query}" → ${panel.matchedCount} match(es)` +
          ` in ${Date.now() - started}ms across ${this.selectedUris.length} file(s)`,
      );

      if (subPanelId === this.activeSubPanelId) {
        this.matchedCount = panel.matchedCount;
        this.filterMaxLineNumber = panel.maxLineNumber;
        this.postUpdate();
        void this.prefetchActiveRows();
      } else {
        this.pushSubPanelsState();
      }
    } catch (err) {
      if (gen !== panel.filterGeneration) {
        return;
      }
      const message = String(err);
      if (message.includes('Parse cancelled') || message.includes('Filter superseded')) {
        return;
      }
      this.parseState = 'ready';
      this.filteringSubPanelId = undefined;
      this.warnings = [message];
      logError(`Filter failed for ${this.uri.fsPath}`, err);
      if (subPanelId === this.activeSubPanelId) {
        this.postUpdate();
      }
    }
  }

  private async handleRequestRows(
    start: number,
    end: number,
    requestId: number,
    subPanelId: string,
  ): Promise<void> {
    if (!this.workerParser.isIndexed || this.parseState === 'parsing') {
      return;
    }
    try {
      const rows = await this.workerParser.getRows(start, end, subPanelId);
      void this.panel.webview.postMessage({
        type: 'rows',
        requestId,
        subPanelId,
        start,
        end,
        rows,
      });
    } catch (err) {
      logError('requestRows failed', err);
    }
  }

  private async handleFindInResults(
    needle: string,
    requestId: number,
    subPanelId: string,
  ): Promise<void> {
    if (!this.workerParser.isIndexed) {
      void this.panel.webview.postMessage({
        type: 'findMatches',
        requestId,
        subPanelId,
        matches: [],
        capped: false,
      });
      return;
    }
    try {
      const result = await this.workerParser.findInResults(needle, subPanelId);
      void this.panel.webview.postMessage({
        type: 'findMatches',
        requestId,
        subPanelId,
        matches: result.matches,
        capped: result.capped,
      });
    } catch (err) {
      logError('findInResults failed', err);
      void this.panel.webview.postMessage({
        type: 'findMatches',
        requestId,
        subPanelId,
        matches: [],
        capped: false,
      });
    }
  }

  private totalEntryCount(): number {
    return this.parseResult?.totalEntries ?? 0;
  }

  private postUpdate(): void {
    const fileName = shortFileName(this.primaryUriString());
    const tags = this.cachedTags;
    const active = this.activeSubPanel();
    const highlightTerms = extractHighlightTerms(active.query);

    const scanning = this.parseState === 'parsing';
    const scan = this.scanStats;
    const total = scanning && scan ? scan.entryCount : this.totalEntryCount();
    const matched = scanning ? 0 : active.matchedCount;

    this.panel.webview.postMessage({
      type: 'update',
      sourceUri: this.uri.toString(),
      sourceViewColumn: this.sourceViewColumn,
      query: active.query,
      activeSubPanelId: this.activeSubPanelId,
      subPanels: this.subPanels.map((p, i) => ({
        id: p.id,
        query: p.query,
        matchedCount: p.matchedCount,
        label: tabLabel(p, i),
      })),
      matchCount: scanning ? 0 : active.matchedCount,
      selectedUris: this.selectedUris,
      stats: { total, matched },
      fileName,
      selectedFileCount: this.selectedUris.length,
      format: this.parseResult?.format ?? (scanning ? 'scanning' : 'unknown'),
      warnings: this.warnings,
      parseState: this.parseState,
      scanStats: scan,
      tags,
      highlightTerms,
      maxLineNumber: active.maxLineNumber,
    });
    this.pushCherryView();
  }

  private async goToSource(line: number, sourceUri?: string): Promise<void> {
    const targetUri = sourceUri ? vscode.Uri.parse(sourceUri) : this.uri;
    try {
      await goToSourceLine(targetUri, line, this.sourceViewColumn);
    } catch (err) {
      logError(`Go to source failed for ${targetUri.fsPath}:${line + 1}`, err);
      void vscode.window.showWarningMessage(
        `Could not jump to line ${line + 1} in ${shortFileName(targetUri.toString())}.`,
      );
    }
  }

  dispose(): void {
    if (this.preferSettleTimer) {
      clearTimeout(this.preferSettleTimer);
    }
    if (this.parseTimer) {
      clearTimeout(this.parseTimer);
    }
    for (const timer of this.queryTimers.values()) {
      clearTimeout(timer);
    }
    this.queryTimers.clear();
    this.workerParser.dispose();
    this.disposeCherry();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private persist(): void {
    this.onPersist?.();
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export class LogFilterSessionManager {
  private sessions = new Map<string, LogFilterSession>();
  private static readonly PANELS_KEY = 'logFilter.panels';
  private readonly savedQueries: SavedQueriesStore;

  constructor(
    private context: vscode.ExtensionContext,
    private extensionUri: vscode.Uri,
  ) {
    this.savedQueries = new SavedQueriesStore(context);
  }

  get(uri: vscode.Uri): LogFilterSession | undefined {
    return this.sessions.get(uri.toString());
  }

  async revivePanel(
    panel: vscode.WebviewPanel,
    webviewState: LogFilterPanelState | undefined,
  ): Promise<void> {
    try {
      // Must reset roots on deserialize (extension update changes install path).
      panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      };

      const stored =
        this.context.workspaceState.get<Record<string, LogFilterPanelState>>(
          LogFilterSessionManager.PANELS_KEY,
        ) ?? {};
      let state = webviewState;
      if (!state?.sourceUri) {
        state = this.resolveStateFromTitle(panel.title, stored);
      }
      if (!state?.sourceUri) {
        panel.dispose();
        return;
      }

      const uri = vscode.Uri.parse(state.sourceUri);
      const key = uri.toString();
      const existing = this.sessions.get(key);
      if (existing && existing.panel !== panel) {
        existing.panel.dispose();
      }

      const sourceCol = state.sourceViewColumn ?? vscode.ViewColumn.One;
      const storedForUri = stored[state.sourceUri] ?? stored[key];
      const selectedUris =
        state.selectedUris ?? storedForUri?.selectedUris ?? [state.sourceUri];
      const fileOrder =
        state.fileOrder ?? storedForUri?.fileOrder ?? [];
      const legacyQuery = state.query ?? storedForUri?.query ?? '';
      const subPanels = state.subPanels ?? storedForUri?.subPanels;
      const activeSubPanelId =
        state.activeSubPanelId ?? storedForUri?.activeSubPanelId;
      const session = this.createSession(
        uri,
        panel,
        sourceCol,
        legacyQuery,
        Array.isArray(selectedUris) ? selectedUris : [state.sourceUri],
        Array.isArray(fileOrder) ? fileOrder : [],
        subPanels,
        activeSubPanelId,
      );
      this.sessions.set(key, session);
      panel.onDidDispose(() => {
        this.sessions.delete(key);
        this.removePersisted(key);
      });
    } catch (err) {
      logError('Failed to revive Log Filter panel', err);
      try {
        panel.webview.html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:16px;color:var(--vscode-errorForeground,#f44)">
          <p>Failed to restore Log Filter panel.</p>
          <p>Close this tab and run <b>Log Filter: Open</b> again.</p>
          <pre style="white-space:pre-wrap">${String(err).replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!))}</pre>
        </body></html>`;
      } catch {
        try {
          panel.dispose();
        } catch {
          // ignore
        }
      }
    }
  }

  async open(
    uri: vscode.Uri,
    sourceViewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
  ): Promise<LogFilterSession | undefined> {
    const key = uri.toString();
    const existing = this.sessions.get(key);
    if (existing) {
      existing.updateSourceColumn(sourceViewColumn);
      existing.reveal();
      return existing;
    }

    const fileName = shortFileNameFromFsPath(uri.fsPath) || 'log';
    const panelOptions: vscode.WebviewPanelOptions & vscode.WebviewOptions = {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    const panel = vscode.window.createWebviewPanel(
      LOG_FILTER_PANEL_VIEW_TYPE,
      `Log Filter: ${fileName}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      panelOptions,
    );

    const session = this.createSession(uri, panel, sourceViewColumn);
    this.sessions.set(key, session);
    panel.onDidDispose(() => {
      this.sessions.delete(key);
      this.removePersisted(key);
    });

    return session;
  }

  private createSession(
    uri: vscode.Uri,
    panel: vscode.WebviewPanel,
    sourceCol: vscode.ViewColumn,
    initialQuery = '',
    initialSelectedUris: string[] = [],
    initialFileOrder: string[] = [],
    persistedSubPanels?: import('./subPanels').SubPanelState[],
    persistedActiveSubPanelId?: string,
  ): LogFilterSession {
    const savedQueriesAccess: SavedQueriesAccess = {
      list: () => this.savedQueries.list(),
      add: (query) => this.savedQueries.add(query),
      remove: (query) => this.savedQueries.remove(query),
    };
    let session!: LogFilterSession;
    session = new LogFilterSession(
      uri,
      panel,
      sourceCol,
      this.extensionUri,
      this.context,
      () => this.persistSession(session),
      initialQuery,
      initialSelectedUris,
      initialFileOrder,
      persistedSubPanels,
      persistedActiveSubPanelId,
      savedQueriesAccess,
      (queries) => this.broadcastSavedQueries(queries),
    );
    this.persistSession(session);
    return session;
  }

  private broadcastSavedQueries(queries: string[]): void {
    for (const session of this.sessions.values()) {
      session.pushSavedQueries(queries);
    }
  }

  private persistSession(session: LogFilterSession): void {
    const all =
      this.context.workspaceState.get<Record<string, LogFilterPanelState>>(
        LogFilterSessionManager.PANELS_KEY,
      ) ?? {};
    const active = session.activeSubPanel();
    all[session.uri.toString()] = {
      sourceUri: session.uri.toString(),
      sourceViewColumn: session.sourceViewColumn,
      query: active.query,
      selectedUris: session.selectedUris,
      fileOrder: session.fileOrder,
      subPanels: toPersistedSubPanels(session.subPanels),
      activeSubPanelId: session.activeSubPanelId,
    };
    void this.context.workspaceState.update(LogFilterSessionManager.PANELS_KEY, all);
  }

  private removePersisted(key: string): void {
    const all =
      this.context.workspaceState.get<Record<string, LogFilterPanelState>>(
        LogFilterSessionManager.PANELS_KEY,
      ) ?? {};
    if (!(key in all)) {
      return;
    }
    delete all[key];
    void this.context.workspaceState.update(LogFilterSessionManager.PANELS_KEY, all);
  }

  private resolveStateFromTitle(
    title: string,
    stored: Record<string, LogFilterPanelState>,
  ): LogFilterPanelState | undefined {
    const prefix = 'Log Filter: ';
    if (!title.startsWith(prefix)) {
      return undefined;
    }
    const fileName = title.slice(prefix.length);
    for (const state of Object.values(stored)) {
      const name = vscode.Uri.parse(state.sourceUri).path.split('/').pop();
      if (name === fileName) {
        return state;
      }
    }
    return undefined;
  }

  /** Close panel whose primary source is this URI (e.g. explicit close command). */
  closeForUri(uri: vscode.Uri): void {
    const session = this.sessions.get(uri.toString());
    session?.panel.dispose();
  }

  /**
   * Text tab/document closed: dispose session if it was the primary source and no
   * tabs remain; otherwise remove from other sessions' selections and refresh.
   */
  onTextTabClosed(uri: vscode.Uri): void {
    const key = uri.toString();
    const stillOpen = listOpenTextTabs().some((f) => f.uri === key);
    if (stillOpen) {
      return;
    }

    const primary = this.sessions.get(key);
    if (primary) {
      primary.panel.dispose();
    }
    for (const session of this.sessions.values()) {
      session.removeSelectedUri(uri);
    }
  }

  /** File deleted or renamed away — drop from multi-file selections. */
  onSourceGone(uri: vscode.Uri): void {
    const key = uri.toString();
    const primary = this.sessions.get(key);
    if (primary) {
      // Primary gone: close panel (same as closing its last tab).
      primary.panel.dispose();
    }
    for (const session of this.sessions.values()) {
      session.onSourceGone(uri);
    }
  }

  syncOpenFiles(): void {
    const openFiles = listOpenTextTabs();
    for (const session of this.sessions.values()) {
      session.syncOpenFiles(openFiles);
    }
  }

  revealForUri(uri: vscode.Uri): void {
    this.sessions.get(uri.toString())?.reveal();
  }

  onDocumentChanged(uri: vscode.Uri): void {
    for (const session of this.sessions.values()) {
      if (session.includesUri(uri)) {
        session.scheduleReparse();
      }
    }
  }

  private getActiveSession(): LogFilterSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.panel.active) {
        return session;
      }
    }
    return undefined;
  }

  showFind(): void {
    this.getActiveSession()?.showFind();
  }

  findNext(): void {
    this.getActiveSession()?.findNext();
  }

  findPrevious(): void {
    this.getActiveSession()?.findPrevious();
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.panel.dispose();
    }
    this.sessions.clear();
  }
}

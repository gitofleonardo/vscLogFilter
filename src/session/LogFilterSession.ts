import * as vscode from 'vscode';
import type { LogEntry, ParseResult } from '../types';
import { getLogFilterSettings } from '../config';
import { extractHighlightTerms } from '../query';
import { getWebviewHtml } from './webviewHtml';
import { WorkerParser, type IndexSource } from './workerParser';
import { LOG_FILTER_PANEL_VIEW_TYPE, type LogFilterPanelState } from './panelState';
import { chooseParseSource } from './parseSource';
import { goToSourceLine } from './goToSourceLine';
import { listOpenTextTabs, type OpenTextTabInfo } from '../openTextTabs';
import { shortFileNameFromFsPath, shortFileNameFromUriString } from '../uriUtils';
import { logError, logInfo } from '../logChannel';

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

function normalizeSelectedUris(primary: string, uris: unknown): string[] {
  const next = [primary];
  if (!Array.isArray(uris)) {
    return next;
  }
  for (const u of uris) {
    if (typeof u === 'string' && u && u !== primary && !next.includes(u)) {
      next.push(u);
    }
  }
  return next;
}

export class LogFilterSession {
  readonly uri: vscode.Uri;
  panel: vscode.WebviewPanel;
  sourceViewColumn: vscode.ViewColumn;
  query = '';
  /** Always includes primary `uri`; extras are optional open tabs. */
  selectedUris: string[] = [];
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
  private queryTimer?: ReturnType<typeof setTimeout>;
  private filterGeneration = 0;
  private workerParser: WorkerParser;
  /** Suppress reparse from syncOpenFiles during construction / first paint. */
  private allowSyncReparse = false;

  constructor(
    uri: vscode.Uri,
    panel: vscode.WebviewPanel,
    sourceViewColumn: vscode.ViewColumn,
    private extensionUri: vscode.Uri,
    private context: vscode.ExtensionContext,
    private onPersist?: () => void,
    initialQuery = '',
    initialSelectedUris: string[] = [],
  ) {
    this.uri = uri;
    this.panel = panel;
    this.sourceViewColumn = sourceViewColumn;
    this.query = initialQuery;
    const primary = uri.toString();
    this.selectedUris = [primary];
    this.preferredSelectedUris = normalizeSelectedUris(primary, initialSelectedUris);
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

  setQuery(query: string): void {
    this.query = query;
    this.scheduleFilter();
  }

  clearQuery(): void {
    this.query = '';
    this.scheduleFilter();
    this.postUpdate();
    this.persist();
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
      const candidates = new Set([...this.selectedUris, ...this.preferredSelectedUris]);
      const next = [primary];
      for (const u of candidates) {
        if (u !== primary && openSet.has(u) && !next.includes(u)) {
          next.push(u);
        }
      }

      const selectionChanged =
        next.length !== this.selectedUris.length ||
        next.some((u, i) => u !== this.selectedUris[i]);
      this.selectedUris = next;
      this.pushFilesState();
      if (selectionChanged) {
        this.persist();
        if (this.allowSyncReparse) {
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
    const next = [primary];
    for (const u of uris) {
      if (u === primary || next.includes(u)) {
        continue;
      }
      // Only open tabs can be added; closed/missing tabs are ignored.
      if (openSet.has(u)) {
        next.push(u);
      }
    }
    this.preferredSelectedUris = this.preferredSelectedUris.filter((u) => next.includes(u));
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
      openFiles: this.openFiles,
    });
  }

  private onMessage(msg: { type: string; [k: string]: unknown }): void {
    switch (msg.type) {
      case 'ready':
        this.pushFilesState();
        break;
      case 'queryChange':
        this.setQuery(String(msg.query ?? ''));
        this.persist();
        break;
      case 'filesSelectionChange': {
        const uris = Array.isArray(msg.uris) ? msg.uris.map(String) : [];
        this.setSelectedUris(uris);
        break;
      }
      case 'goToSource':
        void this.goToSource(Number(msg.line), msg.sourceUri ? String(msg.sourceUri) : undefined);
        break;
      case 'requestRows':
        void this.handleRequestRows(Number(msg.start), Number(msg.end), Number(msg.requestId));
        break;
      case 'findInResults':
        void this.handleFindInResults(String(msg.needle ?? ''), Number(msg.requestId));
        break;
      case 'selectEntry':
        break;
    }
  }

  private scheduleFilter(): void {
    if (this.queryTimer) {
      clearTimeout(this.queryTimer);
    }
    // Keep the toolbar quiet while filtering — avoid flashing the scan progress bar.
    const { queryDebounceMs } = getLogFilterSettings();
    this.queryTimer = setTimeout(() => void this.applyFilter(), queryDebounceMs);
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
        await this.applyFilter();
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
      await this.applyFilter();
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

  private async applyFilter(): Promise<void> {
    if (
      (this.parseState !== 'ready' && this.parseState !== 'filtering') ||
      !this.workerParser.isIndexed
    ) {
      return;
    }

    if (!this.query.trim()) {
      this.entries = [];
      this.filteredIds = [];
      this.matchedCount = 0;
      this.filterMaxLineNumber = 1;
      this.warnings = [...this.sourceWarnings];
      this.parseState = 'ready';
      this.postUpdate();
      return;
    }

    // Do not flip UI to "filtering" progress — that made the bar look like it
    // restarted at 0% after indexing finished.
    const gen = ++this.filterGeneration;
    const started = Date.now();
    try {
      const result = await this.workerParser.filterQuery(this.query, gen);
      if (gen !== this.filterGeneration) {
        return;
      }
      this.entries = [];
      this.matchedCount = result.matchedCount;
      this.filterMaxLineNumber = result.maxLineNumber || 1;
      this.filteredIds = [];
      this.warnings = [...this.sourceWarnings, ...(result.filterWarnings ?? [])];
      this.parseState = 'ready';
      logInfo(
        `Filter "${this.query}" → ${this.matchedCount} match(es)` +
          ` in ${Date.now() - started}ms across ${this.selectedUris.length} file(s)`,
      );

      let initialRows: Awaited<ReturnType<WorkerParser['getRows']>> | undefined;
      if (this.matchedCount > 0) {
        try {
          initialRows = await this.workerParser.getRows(0, Math.min(80, this.matchedCount));
        } catch (err) {
          logError('prefetch rows failed', err);
        }
      }
      if (gen !== this.filterGeneration) {
        return;
      }
      this.postUpdate();
      if (initialRows && initialRows.length > 0) {
        void this.panel.webview.postMessage({
          type: 'rows',
          requestId: -1,
          start: 0,
          end: initialRows.length,
          rows: initialRows,
        });
      }
    } catch (err) {
      if (gen !== this.filterGeneration) {
        return;
      }
      const message = String(err);
      if (message.includes('Parse cancelled') || message.includes('Filter superseded')) {
        return;
      }
      this.parseState = 'ready';
      this.warnings = [message];
      logError(`Filter failed for ${this.uri.fsPath}`, err);
      this.postUpdate();
    }
  }

  private async handleRequestRows(start: number, end: number, requestId: number): Promise<void> {
    if (!this.workerParser.isIndexed || this.parseState === 'parsing') {
      return;
    }
    try {
      const rows = await this.workerParser.getRows(start, end);
      void this.panel.webview.postMessage({
        type: 'rows',
        requestId,
        start,
        end,
        rows,
      });
    } catch (err) {
      logError('requestRows failed', err);
    }
  }

  private async handleFindInResults(needle: string, requestId: number): Promise<void> {
    if (!this.workerParser.isIndexed) {
      void this.panel.webview.postMessage({
        type: 'findMatches',
        requestId,
        matches: [],
        capped: false,
      });
      return;
    }
    try {
      const result = await this.workerParser.findInResults(needle);
      void this.panel.webview.postMessage({
        type: 'findMatches',
        requestId,
        matches: result.matches,
        capped: result.capped,
      });
    } catch (err) {
      logError('findInResults failed', err);
      void this.panel.webview.postMessage({
        type: 'findMatches',
        requestId,
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
    const highlightTerms = extractHighlightTerms(this.query);

    const scanning = this.parseState === 'parsing';
    const filtering = this.parseState === 'filtering';
    const scan = this.scanStats;
    const total = scanning && scan ? scan.entryCount : this.totalEntryCount();
    const matched = scanning || filtering ? 0 : this.matchedCount;

    this.panel.webview.postMessage({
      type: 'update',
      sourceUri: this.uri.toString(),
      sourceViewColumn: this.sourceViewColumn,
      query: this.query,
      matchCount: scanning || filtering ? 0 : this.matchedCount,
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
      maxLineNumber: this.filterMaxLineNumber,
    });
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
    if (this.queryTimer) {
      clearTimeout(this.queryTimer);
    }
    this.workerParser.dispose();
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

  constructor(
    private context: vscode.ExtensionContext,
    private extensionUri: vscode.Uri,
  ) {}

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
      const session = this.createSession(
        uri,
        panel,
        sourceCol,
        state.query ?? storedForUri?.query ?? '',
        Array.isArray(selectedUris) ? selectedUris : [state.sourceUri],
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
  ): LogFilterSession {
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
    );
    this.persistSession(session);
    return session;
  }

  private persistSession(session: LogFilterSession): void {
    const all =
      this.context.workspaceState.get<Record<string, LogFilterPanelState>>(
        LogFilterSessionManager.PANELS_KEY,
      ) ?? {};
    all[session.uri.toString()] = {
      sourceUri: session.uri.toString(),
      sourceViewColumn: session.sourceViewColumn,
      query: session.query,
      selectedUris: session.selectedUris,
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

import * as vscode from 'vscode';
import type { LogEntry, ParseResult, SerializedLogEntry } from '../types';
import { TAG_SUGGESTION_LIMIT } from '../constants';
import { getLogFilterSettings } from '../config';
import { extractHighlightTerms } from '../query';
import { getWebviewHtml } from './webviewHtml';
import { WorkerParser } from './workerParser';
import { LOG_FILTER_PANEL_VIEW_TYPE, type LogFilterPanelState } from './panelState';
import { chooseParseSource } from './parseSource';
import { goToSourceLine } from './goToSourceLine';
import { logError, logInfo } from '../logChannel';

export { LOG_FILTER_PANEL_VIEW_TYPE };

export class LogFilterSession {
  readonly uri: vscode.Uri;
  panel: vscode.WebviewPanel;
  sourceViewColumn: vscode.ViewColumn;
  query = '';
  entries: LogEntry[] = [];
  filteredIds: number[] = [];
  parseState: 'idle' | 'parsing' | 'ready' | 'error' = 'idle';
  parseResult?: ParseResult;
  version = 0;
  warnings: string[] = [];
  private scanStats?: { linesProcessed: number; entryCount: number };
  private lastScanUiMs = 0;
  private cachedTags: string[] = [];
  private disposables: vscode.Disposable[] = [];
  private parseTimer?: ReturnType<typeof setTimeout>;
  private queryTimer?: ReturnType<typeof setTimeout>;
  private filterGeneration = 0;
  private workerParser: WorkerParser;

  constructor(
    uri: vscode.Uri,
    panel: vscode.WebviewPanel,
    sourceViewColumn: vscode.ViewColumn,
    private extensionUri: vscode.Uri,
    private context: vscode.ExtensionContext,
    private onPersist?: () => void,
    initialQuery = '',
  ) {
    this.uri = uri;
    this.panel = panel;
    this.sourceViewColumn = sourceViewColumn;
    this.query = initialQuery;
    this.workerParser = new WorkerParser(context.extensionPath);

    panel.webview.html = getWebviewHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);

    void this.startParsing();
  }

  private async startParsing(): Promise<void> {
    void this.reparse();
  }

  private findOpenDocument(): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.uri.toString());
  }

  private async ensureDocument(): Promise<vscode.TextDocument> {
    const existing = this.findOpenDocument();
    if (existing) {
      return existing;
    }
    return vscode.workspace.openTextDocument(this.uri);
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

  private onMessage(msg: { type: string; [k: string]: unknown }): void {
    switch (msg.type) {
      case 'queryChange':
        this.setQuery(String(msg.query ?? ''));
        this.persist();
        break;
      case 'goToSource':
        void this.goToSource(Number(msg.line));
        break;
      case 'selectEntry':
        break;
    }
  }

  private scheduleFilter(): void {
    if (this.queryTimer) {
      clearTimeout(this.queryTimer);
    }
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

  private cacheKey(mtimeMs: number): string {
    return `${this.uri.fsPath}:${mtimeMs}`;
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

  private async reparse(): Promise<void> {
    this.version++;
    const currentVersion = this.version;
    this.parseState = 'parsing';
    this.scanStats = undefined;
    this.postUpdate();

    try {
      const stat = await vscode.workspace.fs.stat(this.uri);

      const { confirmBeforeParseBytes } = getLogFilterSettings();
      if (confirmBeforeParseBytes > 0 && stat.size >= confirmBeforeParseBytes) {
        const choice = await vscode.window.showWarningMessage(
          `Log file is large (${formatSize(stat.size)}). Parsing may take a while.`,
          'Continue',
          'Cancel',
        );
        if (choice !== 'Continue') {
          this.parseState = 'error';
          this.postUpdate();
          return;
        }
      }

      const cacheKey = this.cacheKey(stat.mtime);
      if (this.workerParser.matchesCache(cacheKey)) {
        const meta = this.workerParser.getIndexMeta()!;
        this.parseResult = this.metaToParseResult(meta);
        this.cachedTags = meta.tags;
        this.parseState = 'ready';
        this.scanStats = undefined;
        logInfo(`Reused indexed log (${meta.totalEntries} entries) for ${this.uri.fsPath}`);
        await this.applyFilter();
        return;
      }

      const openDoc = this.findOpenDocument();
      const source = chooseParseSource(this.uri.scheme, openDoc, stat.size);
      logInfo(`Indexing ${this.uri.fsPath} (${formatSize(stat.size)}, source=${source})`);

      const onScan = (scan: { linesProcessed: number; entryCount: number }) => {
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

      const meta =
        source === 'disk'
          ? await this.workerParser.buildIndexFromFile(
              cacheKey,
              this.uri.fsPath,
              stat.size,
              stat.mtime,
              currentVersion,
              onScan,
            )
          : await this.workerParser.buildIndexFromDocument(
              cacheKey,
              openDoc ?? (await this.ensureDocument()),
              stat.mtime,
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
      this.parseState = 'ready';
      this.scanStats = undefined;
      logInfo(`Indexed ${meta.totalEntries} entries (${meta.format}) from ${this.uri.fsPath}`);
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
    if (this.parseState !== 'ready' || !this.workerParser.isIndexed) {
      return;
    }

    if (!this.query.trim()) {
      this.entries = [];
      this.filteredIds = [];
      this.warnings = [];
      this.postUpdate();
      return;
    }

    const gen = ++this.filterGeneration;
    try {
      const result = await this.workerParser.filterQuery(this.query, gen);
      if (gen !== this.filterGeneration) {
        return;
      }
      this.entries = result.entries;
      this.filteredIds = result.entries.map((e) => e.id);
      this.warnings = result.filterWarnings ?? [];
      this.postUpdate(this.buildAllRows());
    } catch (err) {
      if (gen !== this.filterGeneration) {
        return;
      }
      const message = String(err);
      if (message.includes('Parse cancelled') || message.includes('Filter superseded')) {
        return;
      }
      this.warnings = [message];
      logError(`Filter failed for ${this.uri.fsPath}`, err);
      this.postUpdate();
    }
  }

  private totalEntryCount(): number {
    return this.parseResult?.totalEntries ?? this.entries.length;
  }

  private buildAllRows(): SerializedLogEntry[] {
    return this.entries.map((e) => ({
      id: e.id,
      fullText: e.fullText,
      lineNumber: e.lineNumber,
    }));
  }

  private postUpdate(rows?: SerializedLogEntry[]): void {
    const fileName = this.uri.path.split('/').pop() ?? this.uri.fsPath;
    const tags =
      this.cachedTags.length > 0
        ? this.cachedTags
        : [...new Set(this.entries.map((e) => e.tag).filter(Boolean) as string[])]
            .sort()
            .slice(0, TAG_SUGGESTION_LIMIT);
    this.cachedTags = tags;
    const highlightTerms = extractHighlightTerms(this.query);
    let maxLineNumber = 0;
    for (const e of this.entries) {
      maxLineNumber = Math.max(maxLineNumber, e.lineNumber + 1);
    }

    const scanning = this.parseState === 'parsing';
    const scan = this.scanStats;
    const total = scanning && scan ? scan.entryCount : this.totalEntryCount();
    const matched = scanning ? 0 : this.filteredIds.length;

    this.panel.webview.postMessage({
      type: 'update',
      sourceUri: this.uri.toString(),
      sourceViewColumn: this.sourceViewColumn,
      query: this.query,
      filteredIds: scanning ? [] : this.filteredIds,
      stats: { total, matched },
      fileName,
      format: this.parseResult?.format ?? (scanning ? 'scanning' : 'unknown'),
      warnings: this.warnings,
      parseState: this.parseState,
      scanStats: scan,
      tags,
      highlightTerms,
      maxLineNumber,
      rows,
    });
  }

  private async goToSource(line: number): Promise<void> {
    try {
      await goToSourceLine(this.uri, line, this.sourceViewColumn);
    } catch (err) {
      logError(`Go to source failed for ${this.uri.fsPath}:${line + 1}`, err);
      void vscode.window.showWarningMessage(
        `Could not jump to line ${line + 1} in ${this.uri.path.split('/').pop() ?? 'log file'}.`,
      );
    }
  }

  dispose(): void {
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
    const session = this.createSession(uri, panel, sourceCol, state.query ?? '');
    this.sessions.set(key, session);
    panel.onDidDispose(() => {
      this.sessions.delete(key);
      this.removePersisted(key);
    });
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

    const fileName = uri.path.split('/').pop() ?? 'log';
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

  closeForUri(uri: vscode.Uri): void {
    const session = this.sessions.get(uri.toString());
    session?.panel.dispose();
  }

  revealForUri(uri: vscode.Uri): void {
    this.sessions.get(uri.toString())?.reveal();
  }

  onDocumentChanged(uri: vscode.Uri): void {
    this.sessions.get(uri.toString())?.scheduleReparse();
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

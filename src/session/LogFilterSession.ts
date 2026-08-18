import * as vscode from 'vscode';
import type { LogEntry, ParseResult, SerializedLogEntry } from '../types';
import { parseLogDocument } from '../log/parser';
import { parseAndFilter, extractHighlightTerms } from '../query';
import { getWebviewHtml } from './webviewHtml';
import { WorkerParser } from './workerParser';
import { LOG_FILTER_PANEL_VIEW_TYPE, type LogFilterPanelState } from './panelState';

export { LOG_FILTER_PANEL_VIEW_TYPE };

const SMALL_FILE_BYTES = 10 * 1024 * 1024;
const LARGE_FILE_BYTES = 100 * 1024 * 1024;
const DEBOUNCE_MS = 200;
const QUERY_DEBOUNCE_MS = 300;

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
  private disposables: vscode.Disposable[] = [];
  private parseTimer?: ReturnType<typeof setTimeout>;
  private queryTimer?: ReturnType<typeof setTimeout>;
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
    let doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.uri.toString());
    if (!doc) {
      try {
        doc = await vscode.workspace.openTextDocument(this.uri);
      } catch {
        const waitForDoc = vscode.workspace.onDidOpenTextDocument((opened) => {
          if (opened.uri.toString() === this.uri.toString()) {
            waitForDoc.dispose();
            void this.reparse();
          }
        });
        this.disposables.push(waitForDoc);
        return;
      }
    }
    void this.reparse();
  }

  updateSourceColumn(col: vscode.ViewColumn): void {
    this.sourceViewColumn = col;
    this.persist();
  }

  reveal(): void {
    this.panel.reveal(this.panel.viewColumn, true);
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
        this.query = String(msg.query ?? '');
        this.scheduleFilter();
        this.persist();
        break;
      case 'goToSource':
        void this.goToSource(Number(msg.line));
        break;
      case 'requestWindow':
        this.sendWindow(Number(msg.start), Number(msg.end));
        break;
      case 'selectEntry':
        break;
    }
  }

  private scheduleFilter(): void {
    if (this.queryTimer) {
      clearTimeout(this.queryTimer);
    }
    this.queryTimer = setTimeout(() => this.applyFilter(), QUERY_DEBOUNCE_MS);
  }

  scheduleReparse(): void {
    if (this.parseTimer) {
      clearTimeout(this.parseTimer);
    }
    this.workerParser.cancel();
    this.parseTimer = setTimeout(() => void this.reparse(), DEBOUNCE_MS);
  }

  private async reparse(): Promise<void> {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.uri.toString());
    if (!doc) {
      return;
    }

    this.version++;
    const currentVersion = this.version;
    this.parseState = 'parsing';
    this.postUpdate();

    try {
      const stat = await vscode.workspace.fs.stat(this.uri);
      const useWorker = stat.size >= SMALL_FILE_BYTES;

      if (stat.size >= LARGE_FILE_BYTES) {
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

      let result: ParseResult;
      if (useWorker) {
        result = await this.workerParser.parseDocument(
          doc,
          currentVersion,
          stat.mtime,
          (progress) => {
            if (currentVersion === this.version) {
              this.postUpdate(progress);
            }
          },
        );
      } else {
        const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
        result = parseLogDocument(lines, stat.mtime);
      }

      if (currentVersion !== this.version) {
        return;
      }

      this.entries = result.entries;
      this.parseResult = result;
      this.parseState = 'ready';
      this.applyFilter();
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
      this.postUpdate();
    }
  }

  private applyFilter(): void {
    if (!this.query.trim()) {
      this.filteredIds = [];
      this.warnings = [];
      this.postUpdate();
      return;
    }
    const { matched, warnings } = parseAndFilter(
      this.query,
      this.entries,
      this.parseResult?.fileMaxTime,
    );
    this.filteredIds = matched.map((e) => e.id);
    this.warnings = warnings;
    this.postUpdate();
    this.sendWindow(0, Math.min(80, this.filteredIds.length));
  }

  private postUpdate(parseProgress?: number): void {
    const fileName = this.uri.path.split('/').pop() ?? this.uri.fsPath;
    const tagSet = new Set<string>();
    for (const e of this.entries) {
      if (e.tag) {
        tagSet.add(e.tag);
      }
    }
    const tags = [...tagSet].sort().slice(0, 100);
    const highlightTerms = extractHighlightTerms(this.query);
    let maxLineNumber = 0;
    for (const e of this.entries) {
      maxLineNumber = Math.max(maxLineNumber, e.lineNumber + 1);
    }
    this.panel.webview.postMessage({
      type: 'update',
      sourceUri: this.uri.toString(),
      sourceViewColumn: this.sourceViewColumn,
      query: this.query,
      filteredIds: this.filteredIds,
      stats: { total: this.entries.length, matched: this.filteredIds.length },
      fileName,
      format: this.parseResult?.format ?? 'unknown',
      warnings: this.warnings,
      parseState: this.parseState,
      parseProgress,
      tags,
      highlightTerms,
      maxLineNumber,
    });
  }

  private sendWindow(start: number, end: number): void {
    const slice = this.filteredIds.slice(start, end);
    const rows: SerializedLogEntry[] = slice.map((id) => {
      const e = this.entries[id];
      return {
        id: e.id,
        fullText: e.fullText,
        lineNumber: e.lineNumber,
      };
    });
    this.panel.webview.postMessage({ type: 'windowData', start, end, rows });
  }

  private async goToSource(line: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(this.uri);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: this.sourceViewColumn,
      preserveFocus: false,
    });
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
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

  async open(editor: vscode.TextEditor): Promise<LogFilterSession | undefined> {
    const uri = editor.document.uri;
    const key = uri.toString();
    const existing = this.sessions.get(key);
    if (existing) {
      existing.updateSourceColumn(editor.viewColumn ?? vscode.ViewColumn.One);
      existing.reveal();
      return existing;
    }

    const sourceCol = editor.viewColumn ?? vscode.ViewColumn.One;
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

    const session = this.createSession(uri, panel, sourceCol);
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

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.panel.dispose();
    }
    this.sessions.clear();
  }
}

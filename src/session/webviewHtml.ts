import * as vscode from 'vscode';
import {
  captureIconClearBuffer,
  captureIconNewFile,
  captureIconRecord,
  captureIconStop,
} from './captureBarIcons';

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
  const highlightScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'highlightRanges.js'),
  );
  const findNavScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'findNavigation.js'),
  );
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  const findControllerScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'findController.js'),
  );
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Log Filter</title>
</head>
<body>
  <div id="capture-bar" class="hidden" aria-label="Live log capture">
    <div class="capture-group capture-group-device">
      <span class="capture-group-label">Device</span>
      <select id="capture-device" aria-label="ADB device"></select>
      <button id="capture-refresh" class="capture-icon-btn capture-refresh-btn" type="button" title="Refresh adb devices" aria-label="Refresh adb devices">
        <span class="capture-glyph capture-glyph-refresh" aria-hidden="true"></span>
      </button>
    </div>
    <div class="capture-sep" aria-hidden="true"></div>
    <div class="capture-group capture-group-actions" role="group" aria-label="Capture actions">
      <button id="capture-new-file" class="capture-icon-btn" type="button" title="New capture file — discard current log" aria-label="New capture file">
        ${captureIconNewFile}
      </button>
      <button id="capture-clear-buffer" class="capture-icon-btn capture-option-btn" type="button" title="Clear device log buffer before start (adb logcat -c)" aria-label="Clear logcat buffer before start" aria-pressed="false">
        ${captureIconClearBuffer}
      </button>
      <button id="capture-toggle" class="capture-icon-btn capture-record-btn" type="button" title="Start adb logcat recording" aria-label="Start adb logcat recording">
        <span class="capture-record-icon capture-record-icon-play">${captureIconRecord}</span>
        <span class="capture-record-icon capture-record-icon-stop">${captureIconStop}</span>
      </button>
    </div>
    <span class="capture-spacer" aria-hidden="true"></span>
    <span id="capture-status" class="capture-status-text">Idle</span>
  </div>
  <p id="capture-query-hint" class="hidden capture-query-hint">Recording: filter query applies after you stop capture.</p>
  <div id="toolbar">
    <div id="files-dropdown">
      <button id="files-btn" type="button" aria-haspopup="listbox" aria-expanded="false" title="Search files">
        Files <span id="files-count">(1)</span>
      </button>
      <div id="files-menu" class="hidden" role="listbox" aria-label="Open text files"></div>
    </div>
    <div id="filters-dropdown">
      <button id="filters-btn" type="button" aria-haspopup="listbox" aria-expanded="false" title="Switch filter view">
        <span id="filters-btn-label">Filter</span>
        <span id="filters-btn-meta"></span>
        <span class="filters-btn-chevron" aria-hidden="true">▾</span>
      </button>
      <div id="filters-menu" class="hidden" role="listbox" aria-label="Filter views"></div>
    </div>
    <div id="query-wrap">
      <div id="query-field">
        <div id="query-editor">
          <div id="query-highlight" aria-hidden="true"></div>
          <input id="query" type="text" placeholder="Filter query (AS Logcat syntax)..." spellcheck="false" autocomplete="off" />
        </div>
        <div id="suggestions" class="hidden"></div>
      </div>
      <div id="saved-dropdown">
        <button id="saved-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Saved filter queries">
          Saved
        </button>
        <div id="saved-menu" class="hidden">
          <input id="saved-search" type="text" placeholder="Search saved queries…" spellcheck="false" autocomplete="off" aria-label="Search saved queries" />
          <button id="saved-add" type="button" disabled>Save current query</button>
          <div id="saved-list" role="listbox" aria-label="Saved filter queries"></div>
        </div>
      </div>
    </div>
    <span id="stats"></span>
  </div>
  <div id="progress" class="hidden">
    <div id="progress-track"><div id="progress-fill"></div></div>
    <span id="progress-text">Parsing…</span>
  </div>
  <div id="results-split">
    <div id="results-main">
      <div id="filter-progress" class="hidden" role="progressbar" aria-label="Filtering" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-hidden="true">
        <div id="filter-progress-fill"></div>
      </div>
      <div id="main-find-bar" class="find-bar hidden" role="search">
        <input id="main-find-input" class="find-input" type="text" placeholder="Find in results…" spellcheck="false" autocomplete="off" aria-label="Find in results" />
        <span id="main-find-status" class="find-status" aria-live="polite"></span>
        <button id="main-find-prev" class="find-prev" type="button" title="Previous match (Shift+F3)">↑</button>
        <button id="main-find-next" class="find-next" type="button" title="Next match (F3)">↓</button>
        <button id="main-find-close" class="find-close" type="button" title="Close (Escape)">×</button>
      </div>
      <div id="list" tabindex="0">
        <div id="empty-state">Enter a filter query to show matching log lines</div>
        <div id="scroll-content">
          <div id="rows"></div>
        </div>
      </div>
    </div>
    <button id="cherry-toggle" type="button" aria-expanded="false" aria-controls="cherry-pane" title="Toggle Cherry View">
      <span class="cherry-toggle-icon">◀</span>
      <span class="cherry-toggle-text">Cherry</span>
      <span id="cherry-count">0</span>
    </button>
    <div id="cherry-resizer" class="hidden" role="separator" aria-orientation="vertical" aria-label="Resize Cherry pane" title="Drag to resize"></div>
    <div id="cherry-pane" class="hidden" aria-hidden="true">
      <div id="cherry-pane-header">
        <span id="cherry-stats">0 lines</span>
        <button id="cherry-clear" type="button">Clear All</button>
      </div>
      <div id="cherry-find-bar" class="find-bar hidden" role="search">
        <input id="cherry-find-input" class="find-input" type="text" placeholder="Find in results…" spellcheck="false" autocomplete="off" aria-label="Find in cherry results" />
        <span id="cherry-find-status" class="find-status" aria-live="polite"></span>
        <button id="cherry-find-prev" class="find-prev" type="button" title="Previous match (Shift+F3)">↑</button>
        <button id="cherry-find-next" class="find-next" type="button" title="Next match (F3)">↓</button>
        <button id="cherry-find-close" class="find-close" type="button" title="Close (Escape)">×</button>
      </div>
      <div id="cherry-list" tabindex="0">
        <div id="cherry-empty">No picked lines yet</div>
        <div id="cherry-rows"></div>
      </div>
    </div>
  </div>
  <div id="statusbar">
    <span id="filename"></span>
    <span id="warnings"></span>
  </div>
  <div id="context-menu" class="context-menu hidden" role="menu"></div>
  <script nonce="${nonce}" src="${highlightScriptUri}"></script>
  <script nonce="${nonce}" src="${findNavScriptUri}"></script>
  <script nonce="${nonce}" src="${findControllerScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

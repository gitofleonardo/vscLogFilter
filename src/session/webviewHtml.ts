import * as vscode from 'vscode';

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
  const highlightScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'highlightRanges.js'),
  );
  const findNavScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'findNavigation.js'),
  );
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
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
  <div id="toolbar">
    <div id="files-dropdown">
      <button id="files-btn" type="button" aria-haspopup="listbox" aria-expanded="false" title="Search files">
        Files <span id="files-count">(1)</span>
      </button>
      <div id="files-menu" class="hidden" role="listbox" aria-label="Open text files"></div>
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
  <div id="find-bar" class="hidden" role="search">
    <input id="find-input" type="text" placeholder="Find in results…" spellcheck="false" autocomplete="off" aria-label="Find in results" />
    <span id="find-status" aria-live="polite"></span>
    <button id="find-prev" type="button" title="Previous match (Shift+F3)">↑</button>
    <button id="find-next" type="button" title="Next match (F3)">↓</button>
    <button id="find-close" type="button" title="Close (Escape)">×</button>
  </div>
  <div id="results-split">
    <div id="results-main">
      <div id="filter-progress" class="hidden" role="progressbar" aria-label="Filtering" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-hidden="true">
        <div id="filter-progress-fill"></div>
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

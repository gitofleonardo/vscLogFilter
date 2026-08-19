import * as vscode from 'vscode';

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
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
    <div id="query-wrap">
      <div id="query-editor">
        <div id="query-highlight" aria-hidden="true"></div>
        <input id="query" type="text" placeholder="Filter query (AS Logcat syntax)..." spellcheck="false" autocomplete="off" />
      </div>
      <div id="suggestions" class="hidden"></div>
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
  <div id="list" tabindex="0">
    <div id="empty-state">Enter a filter query to show matching log lines</div>
    <div id="scroll-content">
      <div id="rows"></div>
    </div>
  </div>
  <div id="statusbar">
    <span id="filename"></span>
    <span id="warnings"></span>
  </div>
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

import * as vscode from 'vscode';
import { uriMatches } from '../uriUtils';

export function findOpenTextTab(
  uri: vscode.Uri,
): { uri: vscode.Uri; viewColumn: vscode.ViewColumn } | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && uriMatches(tab.input.uri, uri)) {
        return { uri: tab.input.uri, viewColumn: group.viewColumn };
      }
    }
  }
  return undefined;
}

function findVisibleEditor(uri: vscode.Uri): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((editor) => uriMatches(editor.document.uri, uri));
}

/** Same shape VS Code search / peek / link navigation uses via the workbench opener. */
export function buildWorkbenchOpenRequest(
  uri: vscode.Uri,
  line: number,
  viewColumn: vscode.ViewColumn,
): { resource: vscode.Uri; options: vscode.TextDocumentShowOptions } {
  return {
    resource: uri.with({ fragment: '' }),
    options: {
      viewColumn,
      preserveFocus: false,
      selection: new vscode.Range(line, 0, line, 0),
    },
  };
}

/**
 * Jump to a source line. Uses `vscode.open` with selection so navigation stays in the
 * workbench (like built-in search) and works for large files that never sync to the
 * extension host — no openTextDocument, showTextDocument, or revealLine.
 */
export async function goToSourceLine(
  uri: vscode.Uri,
  line: number,
  fallbackViewColumn: vscode.ViewColumn,
): Promise<void> {
  if (!Number.isFinite(line) || line < 0) {
    return;
  }

  const tab = findOpenTextTab(uri);
  const visible = findVisibleEditor(uri);
  const viewColumn = visible?.viewColumn ?? tab?.viewColumn ?? fallbackViewColumn;
  const { resource, options } = buildWorkbenchOpenRequest(uri, line, viewColumn);

  await vscode.commands.executeCommand('vscode.open', resource, options);
}

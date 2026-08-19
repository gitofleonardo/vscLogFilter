import * as vscode from 'vscode';

export interface EditorTarget {
  uri: vscode.Uri;
  viewColumn: vscode.ViewColumn;
}

/** Resolve the active log file when VS Code omits activeTextEditor (e.g. large-file mode). */
export function resolveEditorTarget(resource?: vscode.Uri): EditorTarget | undefined {
  if (resource) {
    const editor = vscode.window.activeTextEditor;
    return {
      uri: resource,
      viewColumn: editor?.viewColumn ?? vscode.window.tabGroups.activeTabGroup.viewColumn,
    };
  }

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return {
      uri: editor.document.uri,
      viewColumn: editor.viewColumn ?? vscode.ViewColumn.One,
    };
  }

  const activeTab = vscode.window.tabGroups.activeTab;
  if (activeTab?.input instanceof vscode.TabInputText) {
    return {
      uri: activeTab.input.uri,
      viewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn,
    };
  }

  return undefined;
}

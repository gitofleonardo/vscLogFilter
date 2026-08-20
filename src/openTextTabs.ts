import * as vscode from 'vscode';

export interface OpenTextTabInfo {
  uri: string;
  fileName: string;
}

/** List unique open text editor tabs across all tab groups. */
export function listOpenTextTabs(): OpenTextTabInfo[] {
  const seen = new Set<string>();
  const result: OpenTextTabInfo[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputText)) {
        continue;
      }
      const uri = tab.input.uri.toString();
      if (seen.has(uri)) {
        continue;
      }
      seen.add(uri);
      const fileName = tab.input.uri.path.split('/').pop() ?? tab.input.uri.fsPath;
      result.push({ uri, fileName });
    }
  }
  return result;
}

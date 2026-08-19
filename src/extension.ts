import * as vscode from 'vscode';
import { LogFilterSessionManager } from './session/LogFilterSession';
import {
  LOG_FILTER_PANEL_VIEW_TYPE,
  type LogFilterPanelState,
} from './session/panelState';
import { resolveEditorTarget } from './editorTarget';
import { getLogChannel, logInfo } from './logChannel';

let manager: LogFilterSessionManager;
let lastActiveLogUri: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  manager = new LogFilterSessionManager(context, context.extensionUri);

  const syncActiveLogTab = (uri: string): void => {
    const parsed = vscode.Uri.parse(uri);
    const session = manager.get(parsed);
    if (!session) {
      lastActiveLogUri = undefined;
      return;
    }
    if (uri !== lastActiveLogUri) {
      session.reveal();
    }
    lastActiveLogUri = uri;
  };

  context.subscriptions.push(
    getLogChannel(),
    vscode.window.registerWebviewPanelSerializer(LOG_FILTER_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: async (panel, state) => {
        await manager.revivePanel(panel, state as LogFilterPanelState | undefined);
      },
    }),
    vscode.commands.registerCommand('logFilter.open', async (resource?: vscode.Uri) => {
      const target = resolveEditorTarget(resource);
      if (!target) {
        vscode.window.showInformationMessage('No active editor.');
        return;
      }
      await manager.open(target.uri, target.viewColumn);
      lastActiveLogUri = target.uri.toString();
    }),

    vscode.commands.registerCommand('logFilter.close', (resource?: vscode.Uri) => {
      const target = resolveEditorTarget(resource);
      if (target) {
        manager.closeForUri(target.uri);
      }
    }),

    vscode.commands.registerCommand('logFilter.clearQuery', (resource?: vscode.Uri) => {
      const target = resolveEditorTarget(resource);
      if (target) {
        manager.get(target.uri)?.clearQuery();
      }
    }),

    vscode.workspace.onDidChangeTextDocument((e) => {
      manager.onDocumentChanged(e.document.uri);
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      manager.closeForUri(doc.uri);
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        syncActiveLogTab(editor.document.uri.toString());
        return;
      }
      const tab = vscode.window.tabGroups.activeTab;
      if (tab?.input instanceof vscode.TabInputText) {
        syncActiveLogTab(tab.input.uri.toString());
      }
    }),

    vscode.window.tabGroups.onDidChangeTabs(() => {
      const tab = vscode.window.tabGroups.activeTab;
      if (tab?.input instanceof vscode.TabInputText) {
        syncActiveLogTab(tab.input.uri.toString());
      }
    }),

    vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const tab of e.closed) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) {
          manager.closeForUri(input.uri);
        }
      }
    }),
  );

  logInfo('Log Filter extension activated.');
}

export function deactivate(): void {
  manager?.disposeAll();
}

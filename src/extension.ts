import * as vscode from 'vscode';
import { LogFilterSessionManager } from './session/LogFilterSession';
import {
  LOG_FILTER_PANEL_VIEW_TYPE,
  type LogFilterPanelState,
} from './session/panelState';

let manager: LogFilterSessionManager;
let lastActiveLogUri: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  manager = new LogFilterSessionManager(context, context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(LOG_FILTER_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: async (panel, state) => {
        await manager.revivePanel(panel, state as LogFilterPanelState | undefined);
      },
    }),
    vscode.commands.registerCommand('logFilter.open', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor.');
        return;
      }
      await manager.open(editor);
      lastActiveLogUri = editor.document.uri.toString();
    }),

    vscode.commands.registerCommand('logFilter.close', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        manager.closeForUri(editor.document.uri);
      }
    }),

    vscode.commands.registerCommand('logFilter.clearQuery', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        manager.get(editor.document.uri)?.clearQuery();
      }
    }),

    vscode.workspace.onDidChangeTextDocument((e) => {
      manager.onDocumentChanged(e.document.uri);
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      manager.closeForUri(doc.uri);
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) {
        return;
      }
      const uri = editor.document.uri.toString();
      const session = manager.get(editor.document.uri);
      if (!session) {
        lastActiveLogUri = undefined;
        return;
      }
      if (uri !== lastActiveLogUri) {
        session.reveal();
      }
      lastActiveLogUri = uri;
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
}

export function deactivate(): void {
  manager?.disposeAll();
}
